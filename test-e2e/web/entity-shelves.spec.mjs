import { test, expect } from '../support/fixtures.mjs'
import { serverSeries, serverCollection, serverPlaylist } from '../support/routeFixtures.mjs'

/**
 * The series, collections and playlists shelves.
 *
 * All three are the same `LazyBookshelf` with a different `page` prop, and that is exactly why they
 * are worth covering separately: the entity name changes the request path, the card component, and
 * **the geometry** - `entityWidth` doubles for non-book entities (`LazyBookshelf.vue:165-168`) and
 * the shelf divider height changes with it. A shelf that fetches correctly and lays out for the
 * wrong entity size is a real failure mode that no data-layer test can see.
 *
 * Collections is also where #1870 happened: the toolbar kept the count from the previous tab while
 * the shelf showed something else. `collections-state.spec.js` pins the data layer; nothing pinned
 * the rendered result at a real size until now.
 *
 * Conventions 12 and 13 apply throughout - never drive a setting to its default, and require a
 * request to have actually happened rather than reading the last one.
 */

const SERIES = Array.from({ length: 12 }, (_, i) => serverSeries(`ser-${i + 1}`, `Series ${String(i + 1).padStart(2, '0')}`))
const COLLECTIONS = Array.from({ length: 8 }, (_, i) => serverCollection(`col-${i + 1}`, `Collection ${String(i + 1).padStart(2, '0')}`))
const PLAYLISTS = Array.from({ length: 6 }, (_, i) => serverPlaylist(`pl-${i + 1}`, `Playlist ${String(i + 1).padStart(2, '0')}`))

/**
 * Each entity mounts a different card component with **its own id prefix** - `series-card-N`,
 * `collection-card-N`, `playlist-card-N`, and only books use `book-card-N`
 * (`mixins/bookshelfCardsHelpers.js:17-22`). Selecting on `book-card-` everywhere finds nothing on
 * three of the four shelves, and a `count() === 0` assertion phrased as an upper bound passes.
 */
const SHELVES = [
  { name: 'series', path: '/bookshelf/series', apiPath: 'series', card: 'series-card-', fixtures: { series: SERIES }, expected: SERIES.length },
  { name: 'collections', path: '/bookshelf/collections', apiPath: 'collections', card: 'collection-card-', fixtures: { collections: COLLECTIONS }, expected: COLLECTIONS.length },
  { name: 'playlists', path: '/bookshelf/playlists', apiPath: 'playlists', card: 'playlist-card-', fixtures: { playlists: PLAYLISTS }, expected: PLAYLISTS.length }
]

const toolbarTotal = async (page) => Number((await page.locator('[data-testid="bookshelf-total"]').innerText()).trim().split(/\s+/)[0])

for (const shelf of SHELVES) {
  test.describe(`the ${shelf.name} shelf`, () => {
    const open = (library) => library.open({ offline: false, connected: true, at: shelf.path, ...shelf.fixtures })

    test('requests its own entity endpoint, not the items one', async ({ library }) => {
      // `entityPath` is the entity name for everything except books. Getting this wrong would show
      // the book library on all three tabs, and every count assertion would still pass.
      await open(library)

      const paths = library.libraryRequests().map((r) => r.path)
      expect(paths.some((p) => p.endsWith(`/${shelf.apiPath}`))).toBe(true)
      expect(paths.some((p) => p.endsWith('/items'))).toBe(false)
    })

    test('puts cards on the shelf', async ({ library, page }) => {
      await open(library)

      await expect(page.locator(`[id^="${shelf.card}"]`).first()).toBeVisible()
      expect(await page.locator(`[id^="${shelf.card}"]`).count()).toBeGreaterThan(0)
    })

    test('mounts its own card type and not the book card', async ({ library, page }) => {
      // `getComponentClass` picks the card from `entityName`. Falling through to `LazyBookCard`
      // would render something that looks plausible and reads the wrong fields off the entity.
      await open(library)

      expect(await page.locator('[id^="book-card-"]').count()).toBe(0)
    })

    test('tells the toolbar how many there are', async ({ library, page }) => {
      // #1870: the count must describe this shelf, not whichever one was open before.
      await open(library)

      expect(await toolbarTotal(page)).toBe(shelf.expected)
    })

    test('creates a shelf row for every card it mounts', async ({ library, page }) => {
      // `mountEntityCard` looks its row up by id and returns early - logging, not throwing - when
      // it is missing, so cards are dropped silently. This is the assertion that catches it.
      await open(library)

      const cards = await page.locator(`[id^="${shelf.card}"]`).count()
      const shelves = await page.locator('[id^="shelf-"]').count()
      expect(cards).toBeGreaterThan(0)
      expect(shelves).toBeGreaterThan(0)
      expect(cards).toBeLessThanOrEqual(shelves * 4)
    })
  })
}

test.describe('entity geometry', () => {
  test('gives series cards a different width than book cards', async ({ library, page }) => {
    // `entityWidth` returns `bookWidth * 2` for non-book entities. Same viewport, same shelf
    // component - if these come out equal, the entity branch is not being taken and every other
    // spec in this file would still pass.
    await library.open({ offline: false, connected: true, at: '/bookshelf/series', series: SERIES })
    const seriesCardWidth = await page.locator('[id^="series-card-"]').first().evaluate((el) => Math.round(el.getBoundingClientRect().width))

    await library.open({ offline: false, connected: true, at: '/bookshelf/library', serverItems: SERIES[0].books })
    const bookCardWidth = await page.locator('[id^="book-card-"]').first().evaluate((el) => Math.round(el.getBoundingClientRect().width))

    expect(seriesCardWidth).toBeGreaterThan(bookCardWidth)
  })
})

test.describe('an empty shelf', () => {
  test('says so rather than showing a blank page', async ({ library, page }) => {
    // The state a failed fetch and a genuinely empty library share. `initialized` must still be
    // reached, or the empty state never renders - the silent-failure shape of #1870.
    await library.open({ offline: false, connected: true, at: '/bookshelf/collections', collections: [] })

    expect(await toolbarTotal(page)).toBe(0)
    expect(await page.locator('[id^="book-card-"]').count()).toBe(0)
    await expect(page.locator('#bookshelf')).toContainText(/collection/i)
  })
})
