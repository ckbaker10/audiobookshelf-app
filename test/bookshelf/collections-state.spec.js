import { describe, it, expect } from 'vitest'
import LazyBookshelf from '@/components/bookshelf/LazyBookshelf.vue'
import { mountComponent, storeWith, fakeDb, fakeNativeHttp, flush, stubShelfGeometry } from '../support/harness'

/**
 * Issue #1870 - the Collections tab shows the previous tab's item count.
 *
 * Switching from Books to Collections leaves the toolbar reading the Books total. The number
 * belongs to a different tab and does not describe what is on screen.
 *
 * Production path: `LazyBookshelf` owns `entities`, `totalEntities` and the request, and
 * publishes the count with `$eventBus.$emit('bookshelf-total-entities', payload.total)` - but
 * only **inside** `if (payload && payload.results)` and only when `!this.initialized`
 * (`:193-200`). `components/home/BookshelfToolbar.vue` holds the last value it received
 * (`:34, :143, :156`) and has no reset of its own, so anything that stops a new total being
 * published leaves the old one on screen indefinitely.
 *
 * `fetchEntities` swallows a failed request with `.catch(() => null)` (`:183-186`), so a
 * collections fetch that fails publishes nothing at all - the Books count simply stays.
 *
 * **Scope.** The issue also reports a layout freeze on a foldable. That is geometry, needs real
 * measurements, and is not testable here - see FRONTEND_TESTING.md. Nothing below asserts card
 * positions, widths, scrolling, or the absence of a freeze. These specs cover only the count and
 * the failed-fetch state.
 *
 * The successful-response specs pass today; the failure paths are the defect.
 */

const collectionsResponse = (total, results = []) => ({ results, total })

const collection = (id, name) => ({ id, name, books: [], libraryId: 'lib-1' })

function mountCollections({ responses = {}, currentLibraryId = 'lib-1' } = {}) {
  const store = storeWith({
    user: { id: 'u1', username: 'jane' },
    networkConnected: true,
    currentLibraryId
  })
  const nativeHttp = fakeNativeHttp({ responses })

  const mounted = mountComponent(LazyBookshelf, {
    store,
    db: fakeDb(),
    nativeHttp,
    propsData: { page: 'collections' }
  })

  // See offline-library.spec.js: happy-dom reports zero-sized elements, so the real sizing method
  // collapses the shelf and makes any render assertion vacuous. These specs assert the data layer
  // and the published count, which is where the defect lives.
  stubShelfGeometry(mounted.wrapper.vm)

  return mounted
}

/** The last count published to the toolbar, or undefined if none was. */
const publishedTotal = ($eventBus) => $eventBus.emitted.filter((e) => e.event === 'bookshelf-total-entities').at(-1)?.args[0]

describe('#1870 Collections count and failure state', () => {
  it('requests the collections endpoint for the current library', async () => {
    const { wrapper, $nativeHttp } = mountCollections({
      responses: { '/api/libraries/lib-1/collections': collectionsResponse(2, [collection('c1', 'A'), collection('c2', 'B')]) }
    })

    await wrapper.vm.init()
    await flush()

    expect($nativeHttp.requests.some((r) => r.url.includes('/api/libraries/lib-1/collections'))).toBe(true)
  })

  it('publishes the collections total, replacing whatever the previous tab left', async () => {
    const { wrapper, $eventBus } = mountCollections({
      responses: { '/api/libraries/lib-1/collections': collectionsResponse(2, [collection('c1', 'A'), collection('c2', 'B')]) }
    })
    // The toolbar is already holding the Books tab's number when Collections mounts.
    $eventBus.$emit('bookshelf-total-entities', 137)

    await wrapper.vm.init()
    await flush()

    expect(publishedTotal($eventBus)).toBe(2)
  })

  it('publishes zero for a library that genuinely has no collections', async () => {
    const { wrapper, $eventBus } = mountCollections({
      responses: { '/api/libraries/lib-1/collections': collectionsResponse(0, []) }
    })
    $eventBus.$emit('bookshelf-total-entities', 137)

    await wrapper.vm.init()
    await flush()

    expect(publishedTotal($eventBus)).toBe(0)
  })

  it('marks itself initialized on an empty response so the "no collections" state can show', async () => {
    // The template gates that message on `!entities.length && initialized` (`:11`), so without
    // `initialized` the user gets a blank area rather than an explanation.
    const { wrapper } = mountCollections({
      responses: { '/api/libraries/lib-1/collections': collectionsResponse(0, []) }
    })

    await wrapper.vm.init()
    await flush()

    expect(wrapper.vm.initialized).toBe(true)
  })

  // --- The defect: a failed fetch leaves the previous tab's number on screen ------------------

  it('does not leave the previous tab count published when the collections fetch fails', async () => {
    const { wrapper, $eventBus } = mountCollections({ responses: {} }) // rejects
    $eventBus.$emit('bookshelf-total-entities', 137)

    await wrapper.vm.init()
    await flush()

    expect(publishedTotal($eventBus)).not.toBe(137)
  })

  it('reaches an initialized state after a failed fetch rather than staying blank', async () => {
    const { wrapper } = mountCollections({ responses: {} })

    await wrapper.vm.init()
    await flush()

    expect(wrapper.vm.initialized).toBe(true)
  })

  // --- Library change ---------------------------------------------------------------------------

  it('requests the new library collections when the library changes', async () => {
    const { wrapper, $nativeHttp, $store } = mountCollections({
      responses: {
        '/api/libraries/lib-1/collections': collectionsResponse(2, [collection('c1', 'A'), collection('c2', 'B')]),
        '/api/libraries/lib-2/collections': collectionsResponse(5, [collection('c3', 'C')])
      }
    })
    await wrapper.vm.init()
    await flush()

    $store.state.libraries.currentLibraryId = 'lib-2'
    await wrapper.vm.libraryChanged()
    await flush()

    expect($nativeHttp.requests.some((r) => r.url.includes('/api/libraries/lib-2/collections'))).toBe(true)
  })

  it('publishes the new library total after a library change', async () => {
    const { wrapper, $eventBus, $store } = mountCollections({
      responses: {
        '/api/libraries/lib-1/collections': collectionsResponse(2, [collection('c1', 'A'), collection('c2', 'B')]),
        '/api/libraries/lib-2/collections': collectionsResponse(5, [collection('c3', 'C')])
      }
    })
    await wrapper.vm.init()
    await flush()

    $store.state.libraries.currentLibraryId = 'lib-2'
    await wrapper.vm.libraryChanged()
    await flush()

    expect(publishedTotal($eventBus)).toBe(5)
  })
})
