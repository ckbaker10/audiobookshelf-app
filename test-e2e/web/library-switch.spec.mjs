import { test, expect, serverBook } from '../support/fixtures.mjs'
import { DEFAULT_LIBRARIES } from '../support/routeFixtures.mjs'

/**
 * Switching libraries from the app bar.
 *
 * `LibrariesModal.clickedOption` does four things in order: dispatches `libraries/fetch`, emits
 * `library-changed`, and persists the choice. `LazyBookshelf.libraryChanged` then runs
 * `resetEntities` - the same destroy-and-remount path filter and sort use, reached by a different
 * route, and the one `library-switch-detail-pages.spec.js` covers only for detail pages.
 *
 * The failure this guards against is a shelf that keeps the previous library's contents, or a
 * toolbar count that describes a library the user has left. Both are #1870's shape.
 *
 * The two libraries hold **different numbers of items on purpose**: a switch that silently does
 * nothing is invisible when both sides look the same, which is convention 12 applied to fixtures
 * rather than to settings.
 */

const MAIN_ITEMS = Array.from({ length: 20 }, (_, i) => serverBook(`m-${i + 1}`, `Main Book ${String(i + 1).padStart(2, '0')}`))
const SECOND_ITEMS = Array.from({ length: 7 }, (_, i) => serverBook(`s-${i + 1}`, `Second Book ${String(i + 1).padStart(2, '0')}`))

const [MAIN, SECOND] = DEFAULT_LIBRARIES

const toolbarTotal = async (page) => Number((await page.locator('[data-testid="bookshelf-total"]').innerText()).trim().split(/\s+/)[0])

async function openLibrary(library) {
  await library.open({
    offline: false,
    connected: true,
    itemsByLibrary: { [MAIN.id]: MAIN_ITEMS, [SECOND.id]: SECOND_ITEMS }
  })
}

/** Opens the app-bar library modal and picks [libraryId], waiting for the shelf to re-fetch. */
async function switchTo(page, library, libraryId) {
  const before = library.libraryRequests().length
  // The trigger already carries a stable aria-label, so it needs no test hook (convention 7).
  await page.locator('[aria-label="Show library modal"]').click()
  await page.locator(`[data-testid="library-option"][data-value="${libraryId}"]`).click()
  await expect.poll(() => library.libraryRequests().length, { timeout: 5000, message: 'expected the shelf to re-fetch for the new library' }).toBeGreaterThan(before)
}

test.describe('switching library', () => {
  test('fetches the newly chosen library', async ({ library, page }) => {
    await openLibrary(library)

    await switchTo(page, library, SECOND.id)

    expect(library.libraryRequests().at(-1)?.path).toContain(`/api/libraries/${SECOND.id}/`)
  })

  test('shows the new library on the shelf, not the old one', async ({ library, page }) => {
    // The assertion that actually distinguishes a switch from a no-op: the counts differ.
    await openLibrary(library)
    expect(await toolbarTotal(page)).toBe(MAIN_ITEMS.length)

    await switchTo(page, library, SECOND.id)

    await expect.poll(() => toolbarTotal(page), { timeout: 5000 }).toBe(SECOND_ITEMS.length)
  })

  test('re-mounts cards for the new library', async ({ library, page }) => {
    // `resetEntities` destroys every mounted card. A shelf that re-fetched but never re-mounted
    // shows an empty grid with a correct count - which is exactly what the offline tab did.
    await openLibrary(library)

    await switchTo(page, library, SECOND.id)

    await expect(page.locator('[id^="book-card-"]').first()).toBeVisible()
    expect(await page.locator('[id^="book-card-"]').count()).toBeGreaterThan(0)
  })

  test('asks for the new library from page zero', async ({ library, page }) => {
    // Carrying the old page offset into a smaller library asks for a page that does not exist.
    await openLibrary(library)

    await switchTo(page, library, SECOND.id)

    expect(library.libraryRequests().at(-1)?.query.page).toBe('0')
  })

  test('marks the new library as current when the modal is reopened', async ({ library, page }) => {
    await openLibrary(library)
    await switchTo(page, library, SECOND.id)

    await page.locator('[aria-label="Show library modal"]').click()

    await expect(page.locator(`[data-testid="library-option"][data-value="${SECOND.id}"]`)).toHaveAttribute('data-selected', 'true')
    await expect(page.locator(`[data-testid="library-option"][data-value="${MAIN.id}"]`)).toHaveAttribute('data-selected', 'false')
  })

  test('remembers the choice for the next launch', async ({ library, page }) => {
    // `setLastLibraryId` is what makes the app reopen where the user left it. It is written to
    // Capacitor Preferences, which is localStorage on web.
    await openLibrary(library)

    await switchTo(page, library, SECOND.id)

    const stored = await page.evaluate(() => JSON.stringify(window.localStorage))
    expect(stored).toContain(SECOND.id)
  })

  test('does nothing when the current library is chosen again', async ({ library, page }) => {
    // `clickedOption` returns early on the current library. Re-fetching would discard the user's
    // scroll position and re-mount the shelf for no change at all.
    await openLibrary(library)
    const settled = library.libraryRequests().length

    await page.locator('[aria-label="Show library modal"]').click()
    await page.locator(`[data-testid="library-option"][data-value="${MAIN.id}"]`).click()
    await page.waitForTimeout(800)

    expect(library.libraryRequests().length).toBe(settled)
  })
})
