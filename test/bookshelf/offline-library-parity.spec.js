import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import LazyBookshelf from '@/components/bookshelf/LazyBookshelf.vue'
import { mountComponent, storeWith, fakeDb, fakeNativeHttp, flush } from '../support/harness'

/**
 * Offline, the row (list) view shows fewer downloads than the catalogue (grid) view.
 *
 * Reproduce on a device: download a dozen books, go offline, open the Library tab, scroll to the
 * bottom in grid view and count. Switch to row view, scroll to the bottom, count again. The second
 * number is smaller, and neither reaches the number of books actually on disk.
 *
 * Two independent mechanisms produce that, and a fix for one does not fix the other:
 *
 * 1. **The first mount window is the whole list.** `setEntitiesFromLocal` mounts
 *    `shelvesPerPage * entitiesPerShelf` cards (`LazyBookshelf.vue:299`) and scrolling is what
 *    normally tops that up. Offline with no session it never does: `scroll()` returns early on
 *    `!this.user` (`:502`). Row view forces `entitiesPerShelf = 1` (`:433`), so its window is the
 *    smaller of the two and the gap between the views is visible without scrolling at all.
 *
 * 2. **Scrolling with a cached session fires a request that cannot succeed.** `pagesLoaded` is
 *    empty after `setEntitiesFromLocal`, so `handleScroll` calls `loadPage` (`:345-352`), the fetch
 *    fails, and the failure path calls `setEntitiesFromLocal` again (`:239`) - which re-mounts the
 *    first window on top of the scrolled one. Row view crosses shelf boundaries roughly three times
 *    as fast, so it triggers sooner.
 *
 * **Why the existing offline specs cannot see either.** They stub `initSizeData` because happy-dom
 * reports every element as zero-sized, and that stub used to hand both view modes the same
 * `entitiesPerShelf` - deleting the one variable this defect lives in. `stubShelfGeometry` now
 * keeps the list-view branch, but a stub still cannot answer whether the *measured* geometry is
 * right. So these specs do not stub the measurement at all: they define `clientWidth`/`clientHeight`
 * and `window.innerWidth` at phone dimensions and let the real `initSizeData` run. Everything
 * downstream - `entitiesPerShelf`, `shelfHeight`, which indexes each scroll position asks for - is
 * production arithmetic over real numbers.
 *
 * The assertion is deliberately written against the **symptom**, not against either mechanism: every
 * downloaded book must be reachable by scrolling, and the two views must reach the same set. That
 * stays true if the cause turns out to be a third thing, and it stays true as the virtualisation
 * changes underneath it.
 *
 * These are enabled failing specs. They state the contract; the fix belongs on its own branch.
 */

const localBook = (id, title) => ({
  id,
  libraryItemId: `server-${id}`,
  mediaType: 'book',
  isLocal: true,
  media: { metadata: { title }, episodes: [] },
  localFiles: []
})

/** Enough books that both views need several scrolls to cross the library. */
const DOWNLOADS = Array.from({ length: 24 }, (_, i) => localBook(`local-${i + 1}`, `Book ${i + 1}`))
const ALL_INDEXES = DOWNLOADS.map((_, i) => i)

// A Pixel-class portrait viewport. `bookWidth` reads `window.innerWidth` rather than the shelf's
// own width, so both have to be set or grid view sizes itself for a tablet while the shelf is a
// phone - which is its own way of getting the card count wrong.
const VIEWPORT = { width: 360, height: 640 }

let scrollWrapper
let mountTarget
const mounted = []

/**
 * A scroll container for one shelf, replacing any previous one.
 *
 * Two shelves cannot share it. `initListeners` binds to `#bookshelf-wrapper` by id, so a second
 * mount into the same container leaves both components listening to the same element - each then
 * reacts to the other's scroll positions against its own geometry, and a row-vs-grid comparison
 * measures the interference rather than the defect.
 */
function freshScrollContainer() {
  while (mounted.length) mounted.pop().destroy()
  document.body.innerHTML = ''

  scrollWrapper = document.createElement('div')
  scrollWrapper.id = 'bookshelf-wrapper'
  // The component mounts into a *child* of it, because `attachTo` replaces the element it is given
  // rather than appending to it - attaching directly to the wrapper consumes the id, and the
  // lookup in `initListeners` then finds nothing.
  mountTarget = document.createElement('div')
  scrollWrapper.appendChild(mountTarget)
  document.body.appendChild(scrollWrapper)
}

beforeEach(() => {
  freshScrollContainer()

  window.innerWidth = VIEWPORT.width

  // initSizeDataAfterLayout waits two animation frames for the route transition to settle. Running
  // them synchronously keeps that real ordering without making the specs wait on a real clock.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 0
  })
})

afterEach(() => {
  // attachTo leaves the tree on document.body and these assertions look shelf rows up by a
  // document-wide id, so a leftover row from a previous test would satisfy them.
  while (mounted.length) mounted.pop().destroy()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function mountLibrary({ user = null, listView = false, localLibraryItems = DOWNLOADS } = {}) {
  freshScrollContainer()
  const store = storeWith({ user, networkConnected: false, currentLibraryId: 'lib-1' })
  store.state.globals.bookshelfListView = listView

  const result = mountComponent(LazyBookshelf, {
    store,
    db: fakeDb({ localLibraryItems }),
    nativeHttp: fakeNativeHttp(),
    propsData: { page: 'books' },
    attachTo: mountTarget
  })
  mounted.push(result.wrapper)

  // The measurement the real initSizeData makes. happy-dom reports 0 for both.
  Object.defineProperty(result.wrapper.element, 'clientWidth', { configurable: true, get: () => VIEWPORT.width })
  Object.defineProperty(result.wrapper.element, 'clientHeight', { configurable: true, get: () => VIEWPORT.height })

  await flush()
  await flush()
  return result
}

/**
 * Mounts a shelf, reads what the spec needs from it, and lets the next mount replace it.
 *
 * Only one shelf can exist at a time (see [freshScrollContainer]), so a spec that compares the two
 * view modes has to take its measurement while each is still the live one rather than holding both
 * and reading them at the end.
 */
async function withLibrary(options, read) {
  return read(await mountLibrary(options))
}

/** Where the shelf can be scrolled to, given how tall its rows actually are. */
const maxScrollOf = (vm) => Math.max(0, vm.totalShelves * vm.shelfHeight - vm.bookshelfHeight)

/**
 * Scrolls the shelf from top to bottom and returns every entity index that was mounted along the
 * way, in order.
 *
 * The union, not the final state: virtualisation unmounts what scrolls out of view, so "how many
 * cards are on screen at the bottom" is a window size, not a library size. What the user is
 * complaining about is which books they can *get to*, and that is the union over a sweep.
 */
async function indexesReachableByScrolling(vm) {
  const seen = new Set(vm.entityIndexesMounted)
  const maxScroll = maxScrollOf(vm)
  const step = Math.max(1, Math.floor(vm.shelfHeight / 2))

  for (let scrollTop = 0; scrollTop <= maxScroll; scrollTop = Math.min(scrollTop + step, maxScroll)) {
    scrollWrapper.scrollTop = scrollTop
    scrollWrapper.dispatchEvent(new Event('scroll'))
    await flush()
    vm.entityIndexesMounted.forEach((i) => seen.add(i))
    if (scrollTop === maxScroll) break
  }

  return [...seen].sort((a, b) => a - b)
}

describe('offline Library tab, row view and grid view show the same library', () => {
  describe('geometry (the two views are genuinely different shapes)', () => {
    const shape = ({ wrapper }) => ({
      entitiesPerShelf: wrapper.vm.entitiesPerShelf,
      shelvesPerPage: wrapper.vm.shelvesPerPage,
      totalShelves: wrapper.vm.totalShelves,
      mountWindow: wrapper.vm.shelvesPerPage * wrapper.vm.entitiesPerShelf
    })

    it('puts one book on a row in row view and several in grid view', async () => {
      const grid = await withLibrary({ listView: false }, shape)
      const row = await withLibrary({ listView: true }, shape)

      expect(row.entitiesPerShelf).toBe(1)
      expect(grid.entitiesPerShelf).toBeGreaterThan(1)
      // Which is the whole reason the two views can disagree about how much they mounted: the same
      // "two screens' worth of shelves" is a different number of books in each. This is a
      // characterization - the windows are *allowed* to differ, and the specs below are what says
      // the difference must not reach the user.
      expect(row.mountWindow).not.toBe(grid.mountWindow)
    })

    it('gives both views a shelf for every downloaded book', async () => {
      const grid = await withLibrary({ listView: false }, shape)
      const row = await withLibrary({ listView: true }, shape)

      expect(row.totalShelves).toBe(DOWNLOADS.length)
      expect(grid.totalShelves).toBe(Math.ceil(DOWNLOADS.length / grid.entitiesPerShelf))
    })
  })

  // Mechanism 1 lives on the `user: null` side and mechanism 2 on the other, so every reachability
  // statement is made twice. A fix that only handles one session state passes half of these.
  for (const session of [
    { name: 'no user (never connected, or restarted offline)', user: null },
    { name: 'cached user, network down', user: { id: 'u1', username: 'jane' } }
  ]) {
    describe(session.name, () => {
      it('reaches every downloaded book by scrolling, in grid view', async () => {
        const { wrapper } = await mountLibrary({ user: session.user, listView: false })

        expect(await indexesReachableByScrolling(wrapper.vm)).toEqual(ALL_INDEXES)
      })

      it('reaches every downloaded book by scrolling, in row view', async () => {
        const { wrapper } = await mountLibrary({ user: session.user, listView: true })

        expect(await indexesReachableByScrolling(wrapper.vm)).toEqual(ALL_INDEXES)
      })

      it('reaches the same books in row view as in grid view', async () => {
        // The reported symptom, stated directly. It holds whatever the two windows are sized at,
        // so it survives any future change to the virtualisation.
        const inGrid = await withLibrary({ user: session.user, listView: false }, ({ wrapper }) => indexesReachableByScrolling(wrapper.vm))
        const inRow = await withLibrary({ user: session.user, listView: true }, ({ wrapper }) => indexesReachableByScrolling(wrapper.vm))

        expect(inRow).toEqual(inGrid)
      })

      it('reports the same count to the toolbar in either view', async () => {
        // The header must not describe a different library from the one on screen - the same
        // failure #1870 produced on the Collections tab.
        const publishedTotal = ({ $eventBus }) => $eventBus.emitted.filter((e) => e.event === 'bookshelf-total-entities').at(-1)?.args[0]
        const inGrid = await withLibrary({ user: session.user, listView: false }, publishedTotal)
        const inRow = await withLibrary({ user: session.user, listView: true }, publishedTotal)

        expect(inRow).toBe(DOWNLOADS.length)
        expect(inGrid).toBe(DOWNLOADS.length)
      })
    })
  }

  describe('scrolling offline stays offline', () => {
    it('issues no request while scrolling with a cached session', async () => {
      // Mechanism 2. `fakeNativeHttp` rejects by default, so the request is not merely wasted: its
      // failure re-enters the local fallback and re-mounts the first window over the scrolled one.
      const { wrapper, $nativeHttp } = await mountLibrary({ user: { id: 'u1' }, listView: true })

      await indexesReachableByScrolling(wrapper.vm)

      expect($nativeHttp.requests).toEqual([])
    })

    it('does not re-read local storage on every scroll', async () => {
      const { wrapper, $db } = await mountLibrary({ user: { id: 'u1' }, listView: true })
      const readsBefore = $db.calls.filter((c) => c.method === 'getLocalLibraryItems').length

      await indexesReachableByScrolling(wrapper.vm)

      expect($db.calls.filter((c) => c.method === 'getLocalLibraryItems').length).toBe(readsBefore)
    })

    it('keeps only the visible window mounted at the bottom of the shelf', async () => {
      // The damage mechanism 2 does, stated as the invariant virtualisation is supposed to hold:
      // the fallback mounts index 0 onwards again, so cards accumulate far above the viewport.
      const { wrapper } = await mountLibrary({ user: { id: 'u1' }, listView: true })
      const vm = wrapper.vm

      scrollWrapper.scrollTop = maxScrollOf(vm)
      scrollWrapper.dispatchEvent(new Event('scroll'))
      await flush()

      const firstVisible = Math.floor(scrollWrapper.scrollTop / vm.shelfHeight) * vm.entitiesPerShelf
      expect(Math.min(...vm.entityIndexesMounted)).toBeGreaterThanOrEqual(firstVisible)
    })
  })

  describe('switching view mode', () => {
    it('keeps the same library on the shelf', async () => {
      const { wrapper, $store } = await mountLibrary({ listView: false })

      $store.state.globals.bookshelfListView = true
      await flush()
      await flush()

      expect(wrapper.vm.totalEntities).toBe(DOWNLOADS.length)
      expect(wrapper.vm.entities.filter(Boolean)).toHaveLength(DOWNLOADS.length)
      expect(wrapper.vm.totalShelves).toBe(Math.ceil(DOWNLOADS.length / wrapper.vm.entitiesPerShelf))
    })

    it('still shows the downloads notice after switching', async () => {
      // `resetEntities` runs on the toggle and takes a different path back to the local items than
      // `init` does. Losing `showingLocalContent` there would leave the user with a silently
      // shortened library and nothing saying why.
      const { wrapper } = await mountLibrary({ listView: false })

      wrapper.vm.$store.state.globals.bookshelfListView = true
      await flush()
      await flush()

      expect(wrapper.vm.showingLocalContent).toBe(true)
    })
  })
})
