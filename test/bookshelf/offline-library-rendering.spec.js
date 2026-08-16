import { describe, it, expect, afterEach, vi } from 'vitest'
import LazyBookshelf from '@/components/bookshelf/LazyBookshelf.vue'
import { mountComponent, storeWith, fakeDb, fakeNativeHttp, flush, stubShelfGeometry } from '../support/harness'

/**
 * Offline, the Library tab must actually put cards on the shelf.
 *
 * `offline-library.spec.js` and `offline-library-reactivity.spec.js` assert the *data* layer -
 * `entities`, `totalEntities`, the published count. All of that was correct while the tab still
 * rendered nothing but the "server not connected" notice, because putting a card on screen is a
 * separate step: `bookshelfCardsHelpers.mountEntityCard` looks the shelf row up with
 * `document.getElementById('shelf-N')` and returns early, logging, when it is not there.
 *
 * `setEntitiesFromLocal` set `totalShelves` and called `mountEntites` in the same tick, so the
 * `v-for` that creates those rows had not rendered yet and every card was dropped. The
 * server path never hit it because `await loadPage(0)` yields first, which is exactly why a
 * data-layer assertion could not tell the two apart.
 *
 * These tests therefore mount **attached to the document** and assert that the card layer got as
 * far as finding its shelf row. `entityIndexesMounted` is the honest proxy: `mountEntityCard`
 * records an index only after `getElementById` succeeded, so the assertion cannot pass while the
 * row is missing - which is exactly the bug.
 *
 * A card must also inherit the shelf's Vue/Vuex context. Offline storage resolves early enough that
 * the first cards can be constructed before Nuxt's global `$nuxt` fallback is available. A
 * standalone `new ComponentClass()` then has neither `$store` nor `$nuxt`, its render fails, and
 * toggling list/grid appears to fix it only because the replacement cards are created later.
 * These specs therefore assert the actual card DOM as well as the shelf-row boundary.
 */

const localBook = (id, title) => ({
  id,
  libraryItemId: `server-${id}`,
  mediaType: 'book',
  isLocal: true,
  media: { metadata: { title }, episodes: [] },
  localFiles: []
})

const serverBook = (id, title) => ({ id, mediaType: 'book', media: { metadata: { title } } })

const mounted = []
afterEach(() => {
  // attachTo leaves the tree on document.body, and these assertions look shelf rows up by a
  // document-wide id - so a leftover row from a previous test would satisfy them.
  while (mounted.length) mounted.pop().destroy()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function mountLibrary({ user = null, networkConnected = false, localLibraryItems = [], responses = {} } = {}) {
  const store = storeWith({ user, networkConnected, currentLibraryId: 'lib-1' })
  const result = mountComponent(LazyBookshelf, {
    store,
    db: fakeDb({ localLibraryItems }),
    nativeHttp: fakeNativeHttp({ responses }),
    propsData: { page: 'books' },
    attachTo: document.body
  })

  // happy-dom reports zero-sized elements, so the real measurement collapses the shelf to nothing
  // and no index would ever be asked to mount. Everything downstream - which shelf row an index
  // lands on, and whether that row exists - is real.
  stubShelfGeometry(result.wrapper.vm)

  mounted.push(result.wrapper)
  return result
}

describe('offline Library tab renders its downloads', () => {
  it('mounts a card for each downloaded item', async () => {
    const { wrapper } = mountLibrary({
      localLibraryItems: [localBook('local-1', 'Wizards First Rule'), localBook('local-2', 'Stone of Tears')]
    })

    await wrapper.vm.init()
    await flush()

    expect(wrapper.vm.entityIndexesMounted).toEqual([0, 1])
  })

  it('creates the shelf rows the cards are mounted into', async () => {
    const { wrapper } = mountLibrary({ localLibraryItems: [localBook('local-1', 'A')] })

    await wrapper.vm.init()
    await flush()

    expect(wrapper.vm.totalShelves).toBe(1)
    expect(document.getElementById('shelf-0')).not.toBeNull()
  })

  it('creates a card component for each downloaded item', async () => {
    const { wrapper, $store } = mountLibrary({
      localLibraryItems: [localBook('local-1', 'A'), localBook('local-2', 'B')]
    })

    await wrapper.vm.init()
    await flush()

    expect(Object.keys(wrapper.vm.entityComponentRefs)).toEqual(['0', '1'])
    expect(Object.values(wrapper.vm.entityComponentRefs).every((card) => card.$store === $store)).toBe(true)
    expect(document.querySelectorAll('[id^="book-card-"]')).toHaveLength(2)
  })

  it('waits for the initial route layout before sizing list view and mounts all visible downloads', async () => {
    let releaseLocalItems
    const localItemsReady = new Promise((resolve) => {
      releaseLocalItems = resolve
    })
    const books = Array.from({ length: 6 }, (_, index) => localBook(`local-${index + 1}`, `Book ${index + 1}`))
    const db = fakeDb({ localLibraryItems: books })
    const readLocalItems = db.getLocalLibraryItems
    db.getLocalLibraryItems = async (...args) => {
      await localItemsReady
      return readLocalItems(...args)
    }

    const store = storeWith({ user: null, networkConnected: false, currentLibraryId: 'lib-1' })
    store.state.globals.bookshelfListView = true

    let renderedFrames = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      renderedFrames++
      callback(renderedFrames)
      return renderedFrames
    })

    const result = mountComponent(LazyBookshelf, {
      store,
      db,
      propsData: { page: 'books' },
      attachTo: document.body
    })
    mounted.push(result.wrapper)

    // Models the route transition seen in the app: the component is mounted, but its h-full
    // container receives its usable dimensions on the following render frames. Measuring before
    // those frames gives list cards a negative width and mounts only the two-row overscan window.
    Object.defineProperty(result.wrapper.element, 'clientWidth', {
      configurable: true,
      get: () => (renderedFrames >= 2 ? 360 : 0)
    })
    Object.defineProperty(result.wrapper.element, 'clientHeight', {
      configurable: true,
      get: () => (renderedFrames >= 2 ? 640 : 0)
    })

    releaseLocalItems()
    await flush()
    await flush()

    expect(result.wrapper.vm.bookshelfWidth).toBe(360)
    expect(result.wrapper.vm.bookshelfHeight).toBe(640)
    expect(result.wrapper.vm.entityWidth).toBe(344)
    expect(result.wrapper.vm.entityIndexesMounted).toEqual([0, 1, 2, 3, 4, 5])
    expect(document.querySelectorAll('[id^="book-card-"]')).toHaveLength(6)
  })

  it('mounts the shelf row before mounting cards into it', async () => {
    // The ordering that was wrong. If mountEntites runs in the same tick as the totalShelves
    // assignment, getElementById finds nothing and every card is dropped with a console error.
    const { wrapper } = mountLibrary({ localLibraryItems: [localBook('local-1', 'A')] })
    const vm = wrapper.vm
    const shelvesAtMountTime = []
    const original = vm.cardsHelpers.mountEntityCard
    vm.cardsHelpers.mountEntityCard = function (index) {
      shelvesAtMountTime.push(!!document.getElementById(`shelf-${Math.floor(index / vm.entitiesPerShelf)}`))
      return original.call(this, index)
    }

    await wrapper.vm.init()
    await flush()

    expect(shelvesAtMountTime).toEqual([true])
  })

  it('finds the shelf row for downloads after the connection drops mid-session', async () => {
    const { wrapper, $store } = mountLibrary({
      user: { id: 'u1' },
      networkConnected: true,
      localLibraryItems: [localBook('local-1', 'Downloaded Book')],
      responses: { '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'From The Server')], total: 1 } }
    })
    await wrapper.vm.init()
    await flush()

    $store.state.networkConnected = false
    await flush()

    expect(wrapper.vm.entityIndexesMounted).toContain(0)
    expect(wrapper.vm.totalShelves).toBe(1)
  })

  it('mounts nothing and reports nothing when there are no downloads', async () => {
    const { wrapper } = mountLibrary({ localLibraryItems: [] })

    await wrapper.vm.init()
    await flush()

    expect(wrapper.vm.entityIndexesMounted).toEqual([])
    expect(wrapper.vm.totalShelves).toBe(0)
    expect(wrapper.vm.initialized).toBe(true)
  })

  it('still mounts cards on the server path', async () => {
    // The guard: the path that already worked must keep working.
    const { wrapper } = mountLibrary({
      user: { id: 'u1' },
      networkConnected: true,
      responses: { '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'From The Server')], total: 1 } }
    })

    await wrapper.vm.init()
    await flush()

    expect(wrapper.vm.entityIndexesMounted).toContain(0)
  })
})
