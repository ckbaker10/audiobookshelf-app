import { test, expect, serverBook } from '../support/fixtures.mjs'
import { serverSeries } from '../support/routeFixtures.mjs'

/**
 * Two shelf behaviours that only exist in a browser.
 *
 * **The series-books shelf** is `LazyBookshelf`'s fifth entity path and the only one whose filter
 * comes from a route param rather than from settings: `page="series-books"` with a `seriesId` prop,
 * which `buildSearchParams` turns into `filter=series.<encoded id>` (`:529`). It takes its own branch
 * in five places and shares the books endpoint with the Library tab, so a wrong branch shows the
 * whole library under a series heading and every count assertion still passes.
 *
 * **Scroll position restore** is `init` reading `lastBookshelfScrollData[page]` and assigning
 * `bookshelf-wrapper.scrollTop`, against `beforeDestroy` writing it back keyed on `routeFullPath`
 * (`:496-503`, `:684-687`). It needs real scroll offsets and a real navigation away and back, so
 * nothing at any tier covers it today.
 */

const SERIES = serverSeries('ser-1', 'The Chronicles', 5)
const LIBRARY = Array.from({ length: 40 }, (_, i) => serverBook(`s-${i + 1}`, `Book ${String(i + 1).padStart(2, '0')}`))

const scrollTopOf = (page) => page.locator('#bookshelf-wrapper').evaluate((el) => Math.round(el.scrollTop))

test.describe('the series-books shelf', () => {
  const open = (library) =>
    library.open({
      offline: false,
      connected: true,
      at: `/bookshelf/series/${SERIES.id}`,
      serverItems: SERIES.books,
      series: [SERIES]
    })

  test('filters the books endpoint by the series it was opened for', async ({ library }) => {
    await open(library)

    const last = library.libraryRequests().at(-1)
    expect(last?.path).toContain('/items')
    expect(last?.query.filter).toMatch(/^series\./)
  })

  test('shows the books rather than the whole library', async ({ library, page }) => {
    await open(library)

    await expect(page.locator('[id^="book-card-"]').first()).toBeVisible()
    const total = Number((await page.locator('[data-testid="bookshelf-total"]').innerText()).trim().split(/\s+/)[0])
    expect(total).toBe(SERIES.books.length)
  })

  test('uses the book card, not the series card', async ({ library, page }) => {
    // `isBookEntity` is true for `series-books`, so this shelf mounts book cards even though it was
    // reached from the series tab. Getting that wrong renders group covers for single books.
    await open(library)

    expect(await page.locator('[id^="book-card-"]').count()).toBeGreaterThan(0)
    expect(await page.locator('[id^="series-card-"]').count()).toBe(0)
  })
})

test.describe('scroll position', () => {
  test('comes back where the user left it', async ({ library, page }) => {
    // Navigation must be client-side: a reload would rebuild the store and the saved position with
    // it, so the assertion would be about nothing.
    await library.open({ offline: false, connected: true, serverItems: LIBRARY })
    await page.locator('#bookshelf-wrapper').evaluate((el) => el.scrollTo(0, 900))
    await page.waitForTimeout(400)
    const left = await scrollTopOf(page)
    expect(left).toBeGreaterThan(0)

    await page.locator('a[href="/bookshelf/series"]').click()
    await page.waitForTimeout(600)
    await page.locator('a[href="/bookshelf/library"]').click()
    await page.waitForTimeout(900)

    expect(await scrollTopOf(page)).toBe(left)
  })

  test('starts at the top for a shelf that was never scrolled', async ({ library, page }) => {
    // The negative half. Without it, "restores the position" would pass on a shelf that always
    // renders at whatever offset it happens to have.
    await library.open({ offline: false, connected: true, serverItems: LIBRARY })

    expect(await scrollTopOf(page)).toBe(0)
  })
})
