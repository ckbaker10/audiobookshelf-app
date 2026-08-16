import { test, expect, serverBook } from '../support/fixtures.mjs'

/**
 * The shelf's remaining layout modes and the events that force a re-measure.
 *
 * `offline-library-parity.spec.mjs` covers grid against row. There is a **third** mode - alt view -
 * and two things that make the shelf re-measure at runtime. All of it is `clientWidth`/`clientHeight`
 * arithmetic, which is the one thing happy-dom cannot supply, so none of it is reachable below this
 * tier.
 *
 * Alt view comes from device settings rather than user settings: `getAltViewEnabled` returns **true**
 * when `deviceSettings` is missing entirely and the stored `enableAltView` otherwise
 * (`store/index.js:74-77`). The seed writes an empty object by default, which is how every other
 * spec gets the ordinary layout.
 */

const ITEMS = Array.from({ length: 30 }, (_, i) => serverBook(`s-${i + 1}`, `Book ${String(i + 1).padStart(2, '0')}`))

const cardBox = (page) => page.locator('[id^="book-card-"]').first().evaluate((el) => el.getBoundingClientRect().toJSON())
const rowHeight = (page) => page.locator('[id^="shelf-"]').first().evaluate((el) => Math.round(el.getBoundingClientRect().height))

test.describe('alt view', () => {
  test('lays the shelf out differently than the standard view', async ({ library, page }) => {
    // `shelfHeight` adds `extraTitleSpace * sizeMultiplier` in alt view instead of a flat 40
    // (`LazyBookshelf.vue:185-188`), so the rows are a different height for the same cards.
    await library.open({ offline: false, connected: true, serverItems: ITEMS })
    const standard = await rowHeight(page)

    await library.open({ offline: false, connected: true, serverItems: ITEMS, deviceSettings: { enableAltView: true } })
    const alt = await rowHeight(page)

    expect(alt).not.toBe(standard)
  })

  test('drops the wooden shelf divider', async ({ library, page }) => {
    // The divider is `v-if="!showBookshelfListView && !altViewEnabled"`. Alt view draws titles under
    // the covers instead, and leaving the divider behind overlaps them.
    await library.open({ offline: false, connected: true, serverItems: ITEMS, deviceSettings: { enableAltView: true } })

    expect(await page.locator('.bookshelfDivider').count()).toBe(0)
  })

  test('keeps the divider in the standard view', async ({ library, page }) => {
    // The negative half, or the assertion above would pass against a shelf that never renders
    // dividers at all.
    await library.open({ offline: false, connected: true, serverItems: ITEMS })

    expect(await page.locator('.bookshelfDivider').count()).toBeGreaterThan(0)
  })

  test('still puts cards on screen', async ({ library, page }) => {
    await library.open({ offline: false, connected: true, serverItems: ITEMS, deviceSettings: { enableAltView: true } })

    await expect(page.locator('[id^="book-card-"]').first()).toBeVisible()
  })
})

test.describe('rotating the device', () => {
  test('re-measures the shelf for the new width', async ({ library, page }) => {
    // `screenOrientationChange` waits 50ms and calls `resetEntities`, which re-runs `initSizeData`.
    // A shelf that keeps portrait geometry in landscape leaves a wide empty margin, or clips.
    await library.open({ offline: false, connected: true, serverItems: ITEMS })
    const portrait = await cardBox(page)

    await page.setViewportSize({ width: 851, height: 393 })
    await page.waitForTimeout(600)

    // Cards per row is derived from the measured width, so the geometry must change.
    const landscape = await cardBox(page)
    expect(await page.locator('[id^="book-card-"]').count()).toBeGreaterThan(0)
    expect(landscape).not.toEqual(portrait)
  })

  test('still shows the same library after rotating', async ({ library, page }) => {
    // `resetEntities` re-fetches from page 0. Losing the contents on rotation would be a
    // spectacular defect and is exactly what a botched reset does.
    await library.open({ offline: false, connected: true, serverItems: ITEMS })

    await page.setViewportSize({ width: 851, height: 393 })
    await page.waitForTimeout(600)

    const total = Number((await page.locator('[data-testid="bookshelf-total"]').innerText()).trim().split(/\s+/)[0])
    expect(total).toBe(ITEMS.length)
    await expect(page.locator('[id^="book-card-"]').first()).toBeVisible()
  })
})
