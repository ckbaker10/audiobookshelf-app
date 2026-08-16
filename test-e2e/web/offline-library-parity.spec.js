import { test, expect, indexesReachableByScrolling, serverBook } from '../support/fixtures.js'

/**
 * Offline, the row (list) view shows fewer downloads than the catalogue (grid) view.
 *
 * The browser half of `test/bookshelf/offline-library-parity.spec.js`. The unit specs prove the shelf
 * asks for the right indexes given a geometry; only a browser can say whether the geometry itself is
 * right, because `initSizeData` measures `clientWidth`/`clientHeight` and happy-dom reports both as
 * zero. Here the measurement is real, the CSS is real, the scrolling is real, and
 * `context.setOffline` drives connectivity through `@capacitor/network`'s actual web implementation
 * rather than a store flag.
 *
 * The assertion is the reported symptom, stated so that it does not depend on either suspected
 * mechanism: **every downloaded book must be reachable by scrolling, and both views must reach the
 * same set.** It survives a change to the virtualisation and it still fails correctly if the cause
 * turns out to be something neither spec anticipated.
 *
 * Reachability is the union over a scroll sweep. Virtualisation removes cards that scroll out of
 * view, so counting what is on screen at the bottom measures the window, not the library.
 *
 * These are enabled failing specs. The fix belongs on `fix-offline-library-parity`.
 */

const DOWNLOADS = 24

/** Reads the count the toolbar is showing the user, independent of what is mounted. */
const publishedTotal = async (page) => {
  const text = await page.locator('[data-testid="bookshelf-total"]').innerText()
  return Number(text.trim().split(/\s+/)[0])
}

/** Clicks the toolbar's view toggle and waits for the shelf to re-lay out. */
async function switchToRowView(page) {
  const toggle = page.locator('[data-testid="bookshelf-view-toggle"]')
  await expect(toggle).toHaveAttribute('data-view', 'grid')
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-view', 'row')
  // `resetEntities` re-measures and re-mounts; the shelf is mid-flight for a frame or two.
  await page.waitForTimeout(300)
}

for (const session of [
  { name: 'no session to restore (fresh install, or logged out)', connected: false },
  { name: 'a saved session, no network', connected: true }
]) {
  test.describe(`offline Library tab, ${session.name}`, () => {
    test('reaches every downloaded book by scrolling, in grid view', async ({ library, page }) => {
      await library.open({ downloads: DOWNLOADS, connected: session.connected })

      expect(await indexesReachableByScrolling(page)).toHaveLength(DOWNLOADS)
    })

    test('reaches every downloaded book by scrolling, in row view', async ({ library, page }) => {
      await library.open({ downloads: DOWNLOADS, connected: session.connected })
      await switchToRowView(page)

      expect(await indexesReachableByScrolling(page)).toHaveLength(DOWNLOADS)
    })

    test('reaches the same books in row view as in grid view', async ({ library, page }) => {
      // The reported symptom, directly.
      await library.open({ downloads: DOWNLOADS, connected: session.connected })
      const inGrid = await indexesReachableByScrolling(page)

      await switchToRowView(page)
      const inRow = await indexesReachableByScrolling(page)

      expect(inRow).toEqual(inGrid)
    })

    test('tells the user it is showing downloads, in both views', async ({ library, page }) => {
      // Without it a library that silently shrinks to the downloads has no explanation on screen.
      await library.open({ downloads: DOWNLOADS, connected: session.connected })
      await expect(page.locator('[data-testid="offline-notice"]')).toBeVisible()

      await switchToRowView(page)
      await expect(page.locator('[data-testid="offline-notice"]')).toBeVisible()
    })

    test('reports the download count to the toolbar in both views', async ({ library, page }) => {
      await library.open({ downloads: DOWNLOADS, connected: session.connected })
      expect(await publishedTotal(page)).toBe(DOWNLOADS)

      await switchToRowView(page)
      expect(await publishedTotal(page)).toBe(DOWNLOADS)
    })
  })
}

test.describe('offline Library tab, geometry', () => {
  test('fits more books per row in grid view than in row view', async ({ library, page }) => {
    // Characterization, and the reason the two views can disagree at all: the same "two screens of
    // shelves" is a different number of books in each. The specs above are what says that
    // difference must not reach the user.
    await library.open({ downloads: DOWNLOADS })

    const cardsPerRow = async () => {
      const tops = await page.locator('[id^="book-card-"]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))
      return tops.filter((top) => top === tops[0]).length
    }

    const inGrid = await cardsPerRow()
    await switchToRowView(page)
    const inRow = await cardsPerRow()

    expect(inRow).toBe(1)
    expect(inGrid).toBeGreaterThan(1)
  })

  test('puts the cards where a user can see them', async ({ library, page }) => {
    // The assertion no data-layer test can make. `entities` and `totalEntities` were correct while
    // the offline shelf rendered nothing but a red notice, because mounting a card and putting it
    // on screen are separate steps.
    await library.open({ downloads: DOWNLOADS })

    await expect(page.locator('[id^="book-card-"]').first()).toBeVisible()
  })
})

test.describe('recovering the connection', () => {
  test('reloads the full library from the server once the network returns', async ({ library, page, context }) => {
    // The shelf defers its refetch by 4s, because the Home shelf records that fetching the moment
    // the network reports connected "will often fail on Android". Nothing below that timer can
    // observe this, which is why it is here rather than in the unit suite.
    const serverItems = Array.from({ length: 60 }, (_, i) => serverBook(`s-${i + 1}`, `Server Book ${i + 1}`))
    await library.open({ downloads: DOWNLOADS, connected: true, serverItems })

    expect(await publishedTotal(page)).toBe(DOWNLOADS)

    await context.setOffline(false)
    await expect(page.locator('[data-testid="bookshelf-total"]')).toHaveText(/60/, { timeout: 15_000 })
    await expect(page.locator('[data-testid="offline-notice"]')).toBeHidden()
  })
})
