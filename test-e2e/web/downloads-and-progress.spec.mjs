import { test, expect, localProgress, localFolder } from '../support/fixtures.mjs'

/**
 * The downloads screens, and progress on shelf cards.
 *
 * Both were unreachable in a browser until `AbsDatabaseWeb.getLocalFolders` and
 * `getAllLocalMediaProgress` were made storage-backed - they answered one fixed folder and one fixed
 * progress record whatever was stored, so the downloads list was a constant and every progress
 * indicator showed the same thing. Same change, and same reasoning, as `localLibraryItems`.
 *
 * The progress bar is the interesting half. It is a `width` in pixels derived from the item's
 * progress against the card's measured width (`LazyBookCard.vue:62`), and its colour switches on
 * `isFinished`. That is geometry over real measurements: happy-dom reports the card as zero-sized,
 * so the bar is always zero wide there and any assertion about it is vacuous.
 *
 * These run **offline**, because downloads are what the shelf shows when there is no server - and
 * because it removes the server's own progress as a confounder.
 */

const DOWNLOADS = 12

/** Every progress bar on the shelf, as a fraction of its card's width. */
async function progressFractions(page) {
  return page.locator('.box-shadow-progressbar').evaluateAll((bars) =>
    bars.map((bar) => {
      const card = bar.closest('[id^="book-card-"]')
      const cardWidth = card?.getBoundingClientRect().width || 0
      return cardWidth ? bar.getBoundingClientRect().width / cardWidth : 0
    })
  )
}

test.describe('progress on shelf cards', () => {
  test('draws a bar proportional to how far through the book the user is', async ({ library, page }) => {
    // Half-read is half a card wide. The card is ~150px at this viewport, so a wrong denominator
    // or a percentage-vs-fraction mix-up is unmissable here and invisible at zero size.
    await library.open({ downloads: DOWNLOADS, mediaProgress: [localProgress(1, { progress: 0.5 })] })

    const fractions = await progressFractions(page)
    const drawn = fractions.filter((f) => f > 0)
    expect(drawn).toHaveLength(1)
    expect(drawn[0]).toBeGreaterThan(0.4)
    expect(drawn[0]).toBeLessThan(0.6)
  })

  test('draws nothing for a book that has not been started', async ({ library, page }) => {
    // The negative half: without it, "draws a bar" would pass on a shelf that always draws one.
    await library.open({ downloads: DOWNLOADS, mediaProgress: [] })

    expect((await progressFractions(page)).filter((f) => f > 0)).toHaveLength(0)
  })

  test('marks a finished book differently from one in progress', async ({ library, page }) => {
    // `itemIsFinished` swaps the bar to `bg-success`. Same element, same width - only the colour
    // separates "done" from "nearly done", which is exactly the kind of thing a data assertion
    // cannot see.
    await library.open({
      downloads: DOWNLOADS,
      mediaProgress: [localProgress(1, { progress: 1, isFinished: true }), localProgress(2, { progress: 0.5 })]
    })

    const classes = await page.locator('.box-shadow-progressbar').evaluateAll((bars) => bars.filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.className))
    expect(classes.some((c) => c.includes('bg-success'))).toBe(true)
    expect(classes.some((c) => c.includes('bg-yellow-400'))).toBe(true)
  })

  test('keeps the bar within the card', async ({ library, page }) => {
    // `width * userProgressPercent` with a progress above 1 - which a desynced server can produce -
    // would overflow the cover. `max-w-full` is the guard; this is what proves it holds.
    await library.open({ downloads: DOWNLOADS, mediaProgress: [localProgress(1, { progress: 1, isFinished: true })] })

    const overflow = await page.locator('.box-shadow-progressbar').evaluateAll((bars) =>
      bars.some((bar) => {
        const card = bar.closest('[id^="book-card-"]')
        if (!card) return false
        return bar.getBoundingClientRect().width > card.getBoundingClientRect().width + 1
      })
    )
    expect(overflow).toBe(false)
  })
})

test.describe('the downloads screen', () => {
  const open = (library, downloads = DOWNLOADS) => library.open({ downloads, at: '/downloads', waitFor: 'body' })

  test('lists every downloaded item', async ({ library, page }) => {
    await open(library)

    await expect(page.locator('a[href^="/localMedia/item/"]')).toHaveCount(DOWNLOADS)
  })

  test('counts them in the heading', async ({ library, page }) => {
    await open(library)

    await expect(page.locator('body')).toContainText(`(${DOWNLOADS})`)
  })

  test('links each one to its local item page', async ({ library, page }) => {
    // The links are how a user reaches a downloaded book offline; a wrong id is a dead end.
    await open(library)

    const hrefs = await page.locator('a[href^="/localMedia/item/"]').evaluateAll((els) => els.map((el) => el.getAttribute('href')))
    expect(hrefs[0]).toBe('/localMedia/item/local_1')
  })

  test('says nothing is downloaded when nothing is', async ({ library, page }) => {
    await open(library, 0)

    await expect(page.locator('a[href^="/localMedia/item/"]')).toHaveCount(0)
    await expect(page.locator('body')).toContainText('(0)')
  })
})

test.describe('the local folders screen', () => {
  test('lists the folders the device has', async ({ library, page }) => {
    await library.open({
      downloads: 4,
      at: '/localMedia/folders',
      waitFor: 'body',
      folders: [localFolder('f-1', { name: 'Audiobooks' }), localFolder('f-2', { name: 'Podcasts', mediaType: 'podcast' })]
    })

    await expect(page.locator('body')).toContainText('Audiobooks')
    await expect(page.locator('body')).toContainText('Podcasts')
  })
})
