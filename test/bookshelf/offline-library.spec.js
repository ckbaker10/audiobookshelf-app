import { describe, it, expect } from 'vitest'
import LazyBookshelf from '@/components/bookshelf/LazyBookshelf.vue'
import { mountComponent, storeWith, fakeDb, fakeNativeHttp, flush, stubShelfGeometry } from '../support/harness'

/**
 * The Library tab is empty when the app is offline: it does not list downloaded books.
 *
 * Reproduce on a device: download a book, stop the server or disable networking, restart the app,
 * open the Library tab. The books are on disk and the Home shelf shows them, but Library is blank.
 *
 * There are **two independent paths** to that blank tab, and a fix for one does not fix the other:
 *
 * 1. **No user.** `init()` opens with
 *    `if (!this.user) { await this.resetEntities(); $eventBus.$emit('bookshelf-total-entities', 0); return }`
 *    (`LazyBookshelf.vue:348-353`), above a comment reading `// Offline support not available`.
 *    `user` is `$store.state.user.user`, and `layouts/default.vue` only commits `user/setUser`
 *    after a *successful* server connection, so offline it is null. The component empties itself
 *    and reports zero entities before it ever reads local storage. `resetEntities()` has the
 *    matching stub: an `else { // Local only }` branch that does nothing (`:308`).
 *
 * 2. **Cached user, dead network.** `fetchEntities()` does
 *    `.catch((error) => { console.error(...); return null })` and then `if (payload && payload.results)`
 *    (`:183-193`). The request fails, `payload` is null, the block is skipped, and nothing reaches
 *    the screen or the user. The failure is entirely silent.
 *
 * What already exists: `localLibraryItems` *is* loaded and used - but only to decorate server
 * entities through `setLocalLibraryItem()`. It is never a data source on its own.
 *
 * The contract asserted below is the one `pages/bookshelf/index.vue` (Home) already meets, via
 * `getLocalMediaItemCategories()`. Home showing downloads while Library shows nothing, in the same
 * offline session, is why this reads as a broken tab rather than a documented boundary - and is why
 * these specs assert Library's behaviour against Home's rather than inventing a new one.
 *
 * These are enabled failing specs. They state the contract; the fix belongs on its own branch.
 */

const localBook = (id, title) => ({
  id,
  libraryItemId: `server-${id}`,
  mediaType: 'book',
  media: {
    metadata: { title },
    episodes: []
  }
})

const serverBook = (id, title) => ({
  id,
  mediaType: 'book',
  media: { metadata: { title } }
})

/**
 * `initSizeData()` measures a real element (`clientWidth`/`clientHeight`), which happy-dom reports
 * as 0. Left alone, `entitiesPerShelf` collapses and no card is ever mounted, so a render-level
 * assertion would be vacuous - it would pass whether or not the data arrived.
 *
 * So these specs stub the measurement via `stubShelfGeometry` and assert on the **data layer**:
 * `entities`,
 * `totalEntities`, and the `bookshelf-total-entities` event the toolbar reads. That is the layer
 * the defect actually lives in, and the empty-state block below is driven by `entities.length`, so
 * nothing important is lost. Asserting mounted card components would be testing happy-dom's layout
 * engine, not this component - the same trap `android/.../TESTING.md` §6 documents for
 * `Handler`-bound bodies.
 */
function mountLibrary({ user = null, localLibraryItems = [], responses = null } = {}) {
  const store = storeWith({ user, networkConnected: !!responses, currentLibraryId: 'lib-1' })
  const db = fakeDb({ localLibraryItems })
  const nativeHttp = responses ? fakeNativeHttp({ responses }) : fakeNativeHttp()

  const mounted = mountComponent(LazyBookshelf, {
    store,
    db,
    nativeHttp,
    propsData: { page: 'books' }
  })

  stubShelfGeometry(mounted.wrapper.vm)

  return mounted
}

/** The titles the bookshelf is actually holding, ignoring unfilled virtual-scroll slots. */
const titlesIn = (vm) => vm.entities.filter(Boolean).map((e) => e.media.metadata.title)

describe('Library tab, offline', () => {
  describe('no user (never connected, or connected before and restarted offline)', () => {
    it('lists downloaded books instead of an empty shelf', async () => {
      const { wrapper } = mountLibrary({
        user: null,
        localLibraryItems: [localBook('local-1', 'Wizards First Rule'), localBook('local-2', 'Stone of Tears')]
      })

      await wrapper.vm.init()
      await flush()

      expect(titlesIn(wrapper.vm)).toEqual(['Wizards First Rule', 'Stone of Tears'])
    })

    it('reports the downloaded count to the toolbar rather than zero', async () => {
      const { wrapper, $eventBus } = mountLibrary({
        user: null,
        localLibraryItems: [localBook('local-1', 'Wizards First Rule')]
      })

      await wrapper.vm.init()
      await flush()

      const totals = $eventBus.emitted.filter((e) => e.event === 'bookshelf-total-entities')
      expect(totals.at(-1)?.args[0]).toBe(1)
    })

    it('reads local storage at all', async () => {
      // The narrowest statement of the bug: today the component returns before touching $db.
      const { wrapper, $db } = mountLibrary({ user: null, localLibraryItems: [localBook('local-1', 'A Book')] })

      await wrapper.vm.init()
      await flush()

      expect($db.calls.some((c) => c.method === 'getLocalLibraryItems')).toBe(true)
    })

    it('does not attempt a server request when there is no user', async () => {
      // The guard on the fix: "show local items offline" must not become "always hit the network".
      const { wrapper, $nativeHttp } = mountLibrary({ user: null, localLibraryItems: [localBook('local-1', 'A Book')] })

      await wrapper.vm.init()
      await flush()

      expect($nativeHttp.requests).toEqual([])
    })

    it('shows the empty state when there is genuinely nothing downloaded', async () => {
      const { wrapper } = mountLibrary({ user: null, localLibraryItems: [] })

      await wrapper.vm.init()
      await flush()

      expect(wrapper.vm.entities.filter(Boolean)).toEqual([])
      expect(wrapper.vm.initialized).toBe(true)
    })
  })

  describe('cached user, network down', () => {
    it('falls back to downloaded books when the request fails', async () => {
      const { wrapper } = mountLibrary({
        user: { id: 'u1', username: 'jane' },
        localLibraryItems: [localBook('local-1', 'Wizards First Rule')]
        // no responses: fakeNativeHttp rejects, which is the point
      })

      await wrapper.vm.init()
      await flush()

      expect(titlesIn(wrapper.vm)).toEqual(['Wizards First Rule'])
    })

    it('does not fail silently when the request fails and nothing is downloaded', async () => {
      // Today: payload is null, the `if` is skipped, nothing renders and nothing is reported.
      // A blank screen with no explanation is the worst of the available outcomes.
      const { wrapper } = mountLibrary({ user: { id: 'u1', username: 'jane' }, localLibraryItems: [] })

      await wrapper.vm.init()
      await flush()

      expect(wrapper.vm.initialized).toBe(true)
    })
  })

  describe('online (guards: the fix must not break the working path)', () => {
    it('still lists server items when the request succeeds', async () => {
      const { wrapper } = mountLibrary({
        user: { id: 'u1', username: 'jane' },
        responses: {
          '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'From The Server')], total: 1 }
        }
      })

      await wrapper.vm.init()
      await flush()

      expect(titlesIn(wrapper.vm)).toEqual(['From The Server'])
    })

    it('still decorates a server item that is also downloaded', async () => {
      const local = localBook('local-1', 'Wizards First Rule')
      local.libraryItemId = 's-1'
      const { wrapper } = mountLibrary({
        user: { id: 'u1', username: 'jane' },
        localLibraryItems: [local],
        responses: {
          '/api/libraries/lib-1/items': { results: [serverBook('s-1', 'Wizards First Rule')], total: 1 }
        }
      })

      await wrapper.vm.init()
      await flush()

      // The local record has to still be resolvable against the server entity, which is what
      // drives the "downloaded" indicator on the card.
      expect(wrapper.vm.localLibraryItems.find((lli) => lli.libraryItemId === 's-1')).toBeTruthy()
      expect(titlesIn(wrapper.vm)).toEqual(['Wizards First Rule'])
    })
  })
})
