import { describe, it, expect, vi } from 'vitest'
import LazyBookshelf from '@/components/bookshelf/LazyBookshelf.vue'
import { mountComponent, storeWith, fakeDb, fakeNativeHttp, flush, stubShelfGeometry } from '../support/harness'

/**
 * The Library tab must stay useful when connectivity changes *while it is open*.
 *
 * `offline-library.spec.js` covers the decision the shelf makes when it initialises: no session,
 * or a failed first fetch, falls back to downloaded items (#542). That decision is made once.
 * This file covers what happens afterwards, which is a different contract:
 *
 * - the network drops while the user is browsing the library;
 * - the network comes back.
 *
 * Today nothing happens in either case. `LazyBookshelf` has no `networkConnected` watcher, while
 * `pages/bookshelf/index.vue` (the Home shelf) has had one all along - so losing signal leaves the
 * Library tab showing server entities whose covers cannot load and whose next page will never
 * arrive, and regaining it leaves the tab stuck on downloads until something else resets it.
 *
 * The second half also has to be stated, because "show downloads when offline" is easy to
 * implement in a way that never goes back.
 */

const localBook = (id, title) => ({
  id,
  libraryItemId: `server-${id}`,
  mediaType: 'book',
  media: { metadata: { title }, episodes: [] }
})

const serverBook = (id, title) => ({ id, mediaType: 'book', media: { metadata: { title } } })

const titlesIn = (vm) => vm.entities.filter(Boolean).map((e) => e.media.metadata.title)

function mountLibrary({ user = { id: 'u1' }, networkConnected = true, localLibraryItems = [], responses = {} } = {}) {
  const store = storeWith({ user, networkConnected, currentLibraryId: 'lib-1' })
  const mounted = mountComponent(LazyBookshelf, {
    store,
    db: fakeDb({ localLibraryItems }),
    nativeHttp: fakeNativeHttp({ responses }),
    propsData: { page: 'books' }
  })

  // See offline-library.spec.js: happy-dom reports zero-sized elements, so the real sizing method
  // collapses the shelf and any render assertion would be vacuous. Assertions here are on the data
  // layer and on the one piece of markup that does not depend on measurement.
  stubShelfGeometry(mounted.wrapper.vm)

  return mounted
}

/**
 * Runs [act], then lets the component's deferred reconnect timer fire.
 *
 * Fake timers are enabled only around the wait: `flush()` awaits a `setTimeout(0)`, so faking
 * timers for a whole test freezes the helper every other assertion depends on.
 */
async function withDeferredRetry(act) {
  vi.useFakeTimers()
  try {
    await act()
    await vi.advanceTimersByTimeAsync(4100)
  } finally {
    vi.useRealTimers()
  }
  await flush()
}

/** Flips the store's connectivity flag, which is what the device listener does in production. */
async function setNetwork($store, connected) {
  $store.state.networkConnected = connected
  await flush()
}

describe('Library tab reacts to the network dropping', () => {
  it('switches to downloaded items when the connection is lost while browsing', async () => {
    const { wrapper, $store } = mountLibrary({
      localLibraryItems: [localBook('local-1', 'Downloaded Book')],
      responses: { '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'From The Server')], total: 1 } }
    })
    await wrapper.vm.init()
    await flush()
    expect(titlesIn(wrapper.vm)).toEqual(['From The Server'])

    await setNetwork($store, false)

    expect(titlesIn(wrapper.vm)).toEqual(['Downloaded Book'])
    wrapper.destroy()
  })

  it('reports the downloaded count to the toolbar when it switches', async () => {
    const { wrapper, $store, $eventBus } = mountLibrary({
      localLibraryItems: [localBook('local-1', 'A'), localBook('local-2', 'B')],
      responses: { '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'X')], total: 1 } }
    })
    await wrapper.vm.init()
    await flush()

    await setNetwork($store, false)

    const totals = $eventBus.emitted.filter((e) => e.event === 'bookshelf-total-entities')
    expect(totals.at(-1)?.args[0]).toBe(2)
    wrapper.destroy()
  })

  it('does not keep showing unreachable server items when there are no downloads', async () => {
    // Leaving the server list on screen is worse than an empty shelf: every cover is broken and
    // tapping an item cannot start playback.
    const { wrapper, $store } = mountLibrary({
      localLibraryItems: [],
      responses: { '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'From The Server')], total: 1 } }
    })
    await wrapper.vm.init()
    await flush()

    await setNetwork($store, false)

    expect(titlesIn(wrapper.vm)).toEqual([])
    expect(wrapper.vm.initialized).toBe(true)
    wrapper.destroy()
  })

  it('does not issue a server request while disconnected', async () => {
    const { wrapper, $store, $nativeHttp } = mountLibrary({
      localLibraryItems: [localBook('local-1', 'A')],
      responses: { '/api/libraries/lib-1/items': { results: [], total: 0 } }
    })
    await wrapper.vm.init()
    await flush()
    const requestsAfterInit = $nativeHttp.requests.length

    await setNetwork($store, false)

    expect($nativeHttp.requests).toHaveLength(requestsAfterInit)
    wrapper.destroy()
  })
})

describe('Library tab recovers when the network returns', () => {
  it('reloads from the server once the connection is back', async () => {
    const { wrapper, $store } = mountLibrary({
      networkConnected: false,
      localLibraryItems: [localBook('local-1', 'Downloaded Book')],
      responses: { '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'From The Server')], total: 1 } }
    })
    await wrapper.vm.init()
    await flush()
    expect(titlesIn(wrapper.vm)).toEqual(['Downloaded Book'])

    // Production defers the refetch: the Home shelf documents that fetching the instant the
    // network reports connected "will often fail on Android".
    await withDeferredRetry(async () => {
      $store.state.networkConnected = true
    })

    expect(titlesIn(wrapper.vm)).toEqual(['From The Server'])
    wrapper.destroy()
  })

  it('stays on downloaded items when the network returns but there is no session', async () => {
    const { wrapper, $store, $nativeHttp } = mountLibrary({
      user: null,
      networkConnected: false,
      localLibraryItems: [localBook('local-1', 'Downloaded Book')]
    })
    await wrapper.vm.init()
    await flush()

    await withDeferredRetry(async () => {
      $store.state.networkConnected = true
    })

    expect(titlesIn(wrapper.vm)).toEqual(['Downloaded Book'])
    expect($nativeHttp.requests).toEqual([])
    wrapper.destroy()
  })

  it('does not refetch if the connection drops again before the retry fires', async () => {
    const { wrapper, $store, $nativeHttp } = mountLibrary({
      networkConnected: false,
      localLibraryItems: [localBook('local-1', 'A')],
      responses: { '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'X')], total: 1 } }
    })
    await wrapper.vm.init()
    await flush()
    const before = $nativeHttp.requests.length

    await withDeferredRetry(async () => {
      $store.state.networkConnected = true
      await Promise.resolve()
      $store.state.networkConnected = false
    })

    expect($nativeHttp.requests).toHaveLength(before)
    wrapper.destroy()
  })

  it('stops the pending retry when the component is destroyed', async () => {
    // A timer that fires into a destroyed component is how "cannot read property of undefined"
    // crashes get introduced by exactly this kind of change.
    const { wrapper, $store, $nativeHttp } = mountLibrary({
      networkConnected: false,
      responses: { '/api/libraries/lib-1/items': { results: [], total: 0 } }
    })
    await wrapper.vm.init()
    await flush()
    const before = $nativeHttp.requests.length

    await withDeferredRetry(async () => {
      $store.state.networkConnected = true
      await Promise.resolve()
      wrapper.destroy()
    })

    expect($nativeHttp.requests).toHaveLength(before)
  })
})

describe('the shelf says when it is showing downloads rather than the library', () => {
  it('shows the not-connected notice while presenting local content', async () => {
    const { wrapper } = mountLibrary({
      user: null,
      networkConnected: false,
      localLibraryItems: [localBook('local-1', 'Downloaded Book')]
    })

    await wrapper.vm.init()
    await flush()

    // Same string the Home shelf uses, so the two tabs describe the same condition identically.
    expect(wrapper.text()).toContain('MessageAudiobookshelfServerNotConnected')
    wrapper.destroy()
  })

  it('does not show the notice when the library came from the server', async () => {
    const { wrapper } = mountLibrary({
      responses: { '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'X')], total: 1 } }
    })

    await wrapper.vm.init()
    await flush()

    expect(wrapper.text()).not.toContain('MessageAudiobookshelfServerNotConnected')
    wrapper.destroy()
  })

  it('shows the notice after the connection drops mid-session', async () => {
    const { wrapper, $store } = mountLibrary({
      localLibraryItems: [localBook('local-1', 'A')],
      responses: { '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'X')], total: 1 } }
    })
    await wrapper.vm.init()
    await flush()
    expect(wrapper.text()).not.toContain('MessageAudiobookshelfServerNotConnected')

    await setNetwork($store, false)

    expect(wrapper.text()).toContain('MessageAudiobookshelfServerNotConnected')
    wrapper.destroy()
  })

  it('clears the notice once the server list is back', async () => {
    const { wrapper, $store } = mountLibrary({
      networkConnected: false,
      localLibraryItems: [localBook('local-1', 'A')],
      responses: { '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'X')], total: 1 } }
    })
    await wrapper.vm.init()
    await flush()
    expect(wrapper.text()).toContain('MessageAudiobookshelfServerNotConnected')

    await withDeferredRetry(async () => {
      $store.state.networkConnected = true
    })

    expect(wrapper.text()).not.toContain('MessageAudiobookshelfServerNotConnected')
    wrapper.destroy()
  })
})
