import { test, expect, serverBook } from '../support/fixtures.mjs'
import { serverCollection, serverPlaylist } from '../support/routeFixtures.mjs'

/**
 * The Home tab, search, and the collection and playlist detail pages.
 *
 * Fill-in coverage: none of these has a known defect history of its own, except the two detail pages,
 * which both appear in the ten-defects fix (`598ebec5`). They are here because they are the screens a
 * user actually spends time on and nothing browser-level touched them.
 *
 * **Detail pages are reached by clicking, never by `goto`.** Both redirect in `asyncData` when the
 * store has no user (`pages/collection/_id.vue:37-39`), and on a direct navigation `asyncData` runs
 * during route resolution - before the layout has authenticated. A deep link bounces to `/connect`
 * and the spec tests nothing. Arriving from the shelf is what a user does anyway.
 */

const BOOKS = Array.from({ length: 8 }, (_, i) => serverBook(`s-${i + 1}`, `Book ${String(i + 1).padStart(2, '0')}`))
const COLLECTION = serverCollection('col-1', 'Favourites', 3)
const PLAYLIST = serverPlaylist('pl-1', 'Bedtime', 2)

const PERSONALIZED = [
  { id: 'continue-listening', label: 'Continue Listening', labelStringKey: 'LabelContinueListening', type: 'book', entities: BOOKS.slice(0, 3) },
  { id: 'recently-added', label: 'Recently Added', labelStringKey: 'LabelRecentlyAdded', type: 'book', entities: BOOKS.slice(3, 8) }
]

test.describe('the Home tab', () => {
  const open = (library, personalized = PERSONALIZED) => library.open({ offline: false, connected: true, at: '/bookshelf', serverItems: BOOKS, personalized, waitFor: 'body' })

  test('asks for the personalized shelves', async ({ library }) => {
    await open(library)

    expect(library.api().some((r) => r.path.includes('/personalized'))).toBe(true)
  })

  test('renders a shelf for each category', async ({ library, page }) => {
    await open(library)

    await expect(page.locator('#bookshelf-wrapper')).toContainText('Continue Listening')
    await expect(page.locator('#bookshelf-wrapper')).toContainText('Recently Added')
  })

  test('puts cards on those shelves', async ({ library, page }) => {
    // The Home shelves are horizontally scrolling and separate from `LazyBookshelf`, so this is a
    // different rendering path from every other spec in this suite.
    await open(library)

    await expect(page.locator('[id^="book-card-"]').first()).toBeVisible()
  })

  test('falls back to downloads when the server has no categories', async ({ library, page }) => {
    // Not an empty screen: with nothing from the server the Home tab shows what is on the device,
    // which is the #542 contract the Library tab was eventually made to match.
    await library.open({ offline: false, connected: true, at: '/bookshelf', serverItems: BOOKS, personalized: [], downloads: 6, waitFor: 'body' })

    await expect(page.locator('[id^="book-card-"]').first()).toBeVisible()
  })

  test('shows an empty Home when there is nothing at all', async ({ library, page }) => {
    await library.open({ offline: false, connected: true, at: '/bookshelf', serverItems: [], personalized: [], downloads: 0, waitFor: 'body' })

    await expect(page.locator('[id^="book-card-"]')).toHaveCount(0)
    await expect(page.locator('body')).not.toBeEmpty()
  })
})

test.describe('search', () => {
  const search = async (page, term) => {
    await page.locator('a[href="/search"]').click()
    await page.locator('input').first().fill(term)
    // The input is debounced, so the request is not sent on the keystroke.
    await page.waitForTimeout(1200)
  }

  test('queries the server with what was typed', async ({ library, page }) => {
    await library.open({ offline: false, connected: true, serverItems: BOOKS })

    await search(page, 'Book 03')

    const query = library.api().find((r) => r.path.includes('/search'))
    expect(query).toBeTruthy()
    expect(decodeURIComponent(query.query.q || '')).toContain('Book 03')
  })

  test('shows what came back', async ({ library, page }) => {
    await library.open({ offline: false, connected: true, serverItems: BOOKS })

    await search(page, 'Book 03')

    await expect(page.locator('body')).toContainText('Book 03')
  })

  test('does not search on an empty box', async ({ library, page }) => {
    // A search for nothing returns the whole library and costs a round trip per keystroke.
    await library.open({ offline: false, connected: true, serverItems: BOOKS })

    await page.locator('a[href="/search"]').click()
    await page.waitForTimeout(1000)

    expect(library.api().some((r) => r.path.includes('/search'))).toBe(false)
  })
})

test.describe('the collection detail page', () => {
  test('opens from the collections shelf and lists its books', async ({ library, page }) => {
    await library.open({ offline: false, connected: true, at: '/bookshelf/collections', collections: [COLLECTION] })

    await page.locator('[id^="collection-card-"]').first().click()
    await page.waitForTimeout(800)

    await expect(page).toHaveURL(/\/collection\/col-1/)
    await expect(page.locator('body')).toContainText(COLLECTION.name)
    await expect(page.locator('body')).toContainText(COLLECTION.books[0].media.metadata.title)
  })
})

test.describe('the playlist detail page', () => {
  test('opens from the playlists shelf and lists its items', async ({ library, page }) => {
    await library.open({ offline: false, connected: true, at: '/bookshelf/playlists', playlists: [PLAYLIST] })

    await page.locator('[id^="playlist-card-"]').first().click()
    await page.waitForTimeout(800)

    await expect(page).toHaveURL(/\/playlist\/pl-1/)
    await expect(page.locator('body')).toContainText(PLAYLIST.name)
  })
})
