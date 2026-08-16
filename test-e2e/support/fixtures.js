import { test as base, expect, devices } from '@playwright/test'
import { seedDevice, localBooks } from './seed.js'
import { installRouteFixtures, serverBook } from './routeFixtures.js'

/**
 * The shared setup for the web specs: a phone-sized context, a seeded device, and a server that
 * answers from fixtures.
 *
 * Everything a spec needs to say is a parameter of `library`, so the specs themselves stay a
 * statement of behaviour rather than of setup.
 */
export const test = base.extend({
  /**
   * Opens the Library tab with [downloads] on the device.
   *
   * `offline` uses `context.setOffline`, which drives the app's real connectivity state:
   * `@capacitor/network`'s web implementation reads `navigator.onLine` and listens for the window
   * `online`/`offline` events, so nothing about connectivity is faked here.
   */
  library: async ({ context, page }, use) => {
    const open = async ({ downloads = 24, connected = true, offline = true, serverItems = [] } = {}) => {
      const books = localBooks(downloads)
      await installRouteFixtures(context, { libraryItems: serverItems })
      await seedDevice(context, { downloads: books, connected })

      if (offline) await context.setOffline(true)

      await page.goto('/bookshelf/library')
      // The shelf sizes itself two animation frames after the route settles, so waiting for the
      // container alone can measure it mid-transition.
      await page.locator('#bookshelf').waitFor()
      await page.waitForTimeout(250)

      return { books }
    }

    await use({ open, page, context })
  }
})

export { expect, devices, serverBook, localBooks }

/**
 * Every entity index that can be reached by scrolling the shelf from top to bottom.
 *
 * The union over a sweep, not the count at the bottom. Virtualisation unmounts what scrolls out of
 * view, so "cards on screen at the end" is a window size rather than a library size - and what the
 * bug report is about is which books the user can *get to*.
 */
export async function indexesReachableByScrolling(page) {
  const wrapper = page.locator('#bookshelf-wrapper')
  const seen = new Set()

  const collect = async () => {
    const ids = await page.locator('[id^="book-card-"]').evaluateAll((els) => els.map((el) => Number(el.id.replace('book-card-', ''))))
    ids.forEach((id) => seen.add(id))
  }

  const { scrollHeight, clientHeight } = await wrapper.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
  const step = Math.max(1, Math.floor(clientHeight / 2))

  await collect()
  for (let top = 0; top <= scrollHeight; top += step) {
    await wrapper.evaluate((el, y) => el.scrollTo(0, y), top)
    // A frame for the scroll handler to mount the new window, which it does synchronously.
    await page.waitForTimeout(120)
    await collect()
  }

  return [...seen].sort((a, b) => a - b)
}
