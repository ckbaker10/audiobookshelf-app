import { test, expect, serverBook } from '../support/fixtures.mjs'

/**
 * Filtering and sorting the Library tab.
 *
 * Changing either runs the shelf's least-covered path: `user/updateUserSettings` saves locally and
 * emits `user-settings`, `LazyBookshelf.settingsUpdated` calls `checkUpdateSearchParams`, and a
 * *changed* query string triggers `resetEntities` - which destroys every mounted card, re-measures
 * the container and re-mounts from page 0. That is the same machinery the row/grid parity defect
 * lived in, on a path `test/` touches only through the harness and one detail-page spec.
 *
 * Each behaviour is asserted twice, on purpose: **what the app asked the server for**, and **what it
 * put on screen**. Neither alone is enough - a query-only assertion cannot see a shelf that fetched
 * correctly and rendered nothing (the offline Library tab did exactly that for three commits), and a
 * render-only assertion cannot tell "rendered the wrong thing" from "asked for the wrong thing".
 *
 * **Two traps, both hit while writing this file, both load-bearing:**
 *
 * 1. *Choosing a value that is already the default proves nothing.* `mobileOrderBy` defaults to
 *    `addedAt` (`store/user.js:10`), so a spec that sorts by `addedAt` asserts a query the app had
 *    already sent at page load, and passes with the whole settings pipeline disabled. Every value
 *    used below is deliberately **not** the default.
 * 2. *Asserting on the last request is not asserting that a request happened.* With no refetch, the
 *    last request is still the one from page load. So `chooseSort`/`chooseFilter` require the
 *    request count to grow, which is what makes these specs able to fail at all.
 *
 * These run **online**. A filter is a server query; there is no offline equivalent, and the shelf
 * skips paging entirely while showing downloads.
 */

const LIBRARY = Array.from({ length: 30 }, (_, i) => serverBook(`s-${i + 1}`, `Server Book ${String(i + 1).padStart(2, '0')}`))

// Defaults are `addedAt` / `all` (`store/user.js:10-12`). Both of these differ, or the assertions
// below would describe the state the app starts in.
const A_SORT = 'media.metadata.title'
const ANOTHER_SORT = 'size'
const A_FILTER = 'issues'

/** The query the shelf most recently asked the server for. */
const lastLibraryQuery = (library) => library.libraryRequests().at(-1)?.query

async function openLibrary(library) {
  await library.open({ offline: false, connected: true, serverItems: LIBRARY })
}

/** Waits until the shelf has issued a library request it had not issued before [before]. */
async function expectRefetch(library, before) {
  await expect.poll(() => library.libraryRequests().length, { timeout: 5000, message: 'expected the shelf to re-fetch after the settings change' }).toBeGreaterThan(before)
}

async function chooseSort(page, library, value) {
  const before = library.libraryRequests().length
  await page.locator('[data-testid="bookshelf-sort"]').click()
  await page.locator(`[data-testid="order-option"][data-value="${value}"]`).click()
  await expectRefetch(library, before)
}

async function chooseFilter(page, library, value) {
  const before = library.libraryRequests().length
  await page.locator('[data-testid="bookshelf-filter"]').click()
  await page.locator(`[data-testid="filter-option"][data-value="${value}"]`).click()
  await expectRefetch(library, before)
}

test.describe('sorting the library', () => {
  test('asks the server for the chosen sort', async ({ library, page }) => {
    await openLibrary(library)

    await chooseSort(page, library, A_SORT)

    expect(lastLibraryQuery(library)?.sort).toBe(A_SORT)
  })

  test('re-fetches from the first page rather than appending to the old order', async ({ library, page }) => {
    // `resetEntities` clears `pagesLoaded`, so the new order must be requested from page 0. Asking
    // for a later page would interleave two orderings on one shelf.
    await openLibrary(library)

    await chooseSort(page, library, A_SORT)

    expect(lastLibraryQuery(library)?.page).toBe('0')
  })

  test('still has a full shelf of cards afterwards', async ({ library, page }) => {
    // The half a query assertion cannot see: `resetEntities` destroys every mounted card and
    // re-mounts them, and a shelf that re-fetches correctly but re-mounts nothing looks identical
    // in the request log.
    await openLibrary(library)
    const before = await page.locator('[id^="book-card-"]').count()
    expect(before).toBeGreaterThan(0)

    await chooseSort(page, library, A_SORT)

    expect(await page.locator('[id^="book-card-"]').count()).toBe(before)
    await expect(page.locator('[id^="book-card-"]').first()).toBeVisible()
  })

  test('records the choice as selected when the modal is reopened', async ({ library, page }) => {
    await openLibrary(library)
    await chooseSort(page, library, A_SORT)

    await page.locator('[data-testid="bookshelf-sort"]').click()

    await expect(page.locator(`[data-testid="order-option"][data-value="${A_SORT}"]`)).toHaveAttribute('data-selected', 'true')
  })

  test('reverses the direction when the applied sort is chosen again', async ({ library, page }) => {
    // Picking the sort you are already on is not a no-op: `OrderModal.clickedOption` flips
    // `selectedDesc` (`components/modals/OrderModal.vue:179-181`), which is how direction is
    // changed at all - there is no separate asc/desc control. So it must re-fetch, with `desc`
    // flipped and the sort field untouched.
    await openLibrary(library)
    await chooseSort(page, library, A_SORT)
    const wasDesc = lastLibraryQuery(library)?.desc

    await chooseSort(page, library, A_SORT)

    expect(lastLibraryQuery(library)?.sort).toBe(A_SORT)
    expect(lastLibraryQuery(library)?.desc).not.toBe(wasDesc)
  })
})

test.describe('filtering the library', () => {
  test('asks the server for the chosen filter', async ({ library, page }) => {
    await openLibrary(library)

    await chooseFilter(page, library, A_FILTER)

    expect(lastLibraryQuery(library)?.filter).toBe(A_FILTER)
  })

  test('drops the filter from the query when cleared back to all', async ({ library, page }) => {
    // `buildSearchParams` omits the parameter entirely for 'all' rather than sending `filter=all`,
    // which the server would read as a filter named "all".
    await openLibrary(library)
    await chooseFilter(page, library, A_FILTER)

    await chooseFilter(page, library, 'all')

    expect(lastLibraryQuery(library)?.filter).toBeUndefined()
  })

  test('keeps the toolbar count and the shelf describing the same library', async ({ library, page }) => {
    // #1870's shape: the toolbar kept the count from the previous tab while the shelf showed
    // something else. Whatever the filter returns, the two must agree.
    await openLibrary(library)

    await chooseFilter(page, library, A_FILTER)

    const total = Number((await page.locator('[data-testid="bookshelf-total"]').innerText()).trim().split(/\s+/)[0])
    expect(total).toBe(LIBRARY.length)
    expect(await page.locator('[id^="shelf-"]').count()).toBeGreaterThan(0)
  })
})

test.describe('sort and filter together', () => {
  test('carries both in one query rather than losing the earlier one', async ({ library, page }) => {
    // They are written by the same `buildSearchParams` call, so setting one after the other is
    // where a rebuild that reads stale state would drop it.
    await openLibrary(library)

    await chooseFilter(page, library, A_FILTER)
    await chooseSort(page, library, A_SORT)

    const query = lastLibraryQuery(library)
    expect(query?.filter).toBe(A_FILTER)
    expect(query?.sort).toBe(A_SORT)
  })

  test('survives a view-mode switch', async ({ library, page }) => {
    // Toggling row/grid also calls `resetEntities`, by a different route than `settingsUpdated`.
    // The user's sort must not be a casualty of changing how the shelf looks.
    await openLibrary(library)
    await chooseSort(page, library, ANOTHER_SORT)
    const before = library.libraryRequests().length

    await page.locator('[data-testid="bookshelf-view-toggle"]').click()
    await expectRefetch(library, before)

    expect(lastLibraryQuery(library)?.sort).toBe(ANOTHER_SORT)
  })
})
