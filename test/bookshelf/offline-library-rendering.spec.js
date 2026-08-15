import { describe, it, expect, afterEach } from 'vitest'
import LazyBookshelf from '@/components/bookshelf/LazyBookshelf.vue'
import { mountComponent, storeWith, fakeDb, fakeNativeHttp, flush } from '../support/harness'

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
 * **What these cannot assert, and why.** The card's own rendering. `mountEntityCard` builds each
 * card with `new ComponentClass()`, outside the test-utils tree, and `LazyBookCard`'s `store`
 * computed is `this.$store || this.$nuxt.$store`. A standalone instance has neither here, so its
 * render throws and `$el` is not an element - in the app `$nuxt` is on the Vue prototype and it
 * renders normally. Asserting on card DOM would therefore be asserting the harness's limits, so
 * these stop at the boundary the bug actually lived on.
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
  // and no index would ever be asked to mount. These are the numbers a phone produces; everything
  // downstream - which shelf row an index lands on, and whether that row exists - is real.
  result.wrapper.vm.initSizeData = function () {
    this.bookshelfWidth = 1000
    this.bookshelfHeight = 800
    this.entitiesPerShelf = 4
    this.shelvesPerPage = 4
    this.booksPerFetch = 20
  }

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
    const { wrapper } = mountLibrary({
      localLibraryItems: [localBook('local-1', 'A'), localBook('local-2', 'B')]
    })

    await wrapper.vm.init()
    await flush()

    expect(Object.keys(wrapper.vm.entityComponentRefs)).toEqual(['0', '1'])
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
