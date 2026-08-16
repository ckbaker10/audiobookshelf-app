import { test as base, expect, devices } from '@playwright/test'
import { seedDevice, localBooks } from './seed.mjs'
import { installRouteFixtures, serverBook } from './routeFixtures.mjs'
import { contentTypeFor, resolveWithFallback } from './dist.mjs'

/**
 * Serves the app's own assets from disk, so they survive `context.setOffline(true)`.
 *
 * Without this every offline spec dies at `page.goto` with `ERR_INTERNET_DISCONNECTED`: Playwright's
 * offline mode blocks *all* network, localhost included, so the bundle cannot load and the app never
 * boots to be tested.
 *
 * Serving them from disk instead is not a workaround, it is the accurate model. On a device the web
 * assets ship inside the APK and Capacitor serves them from `http://localhost` - they are local and
 * always available. What is gone when a phone loses signal is the *server*, and that is exactly what
 * `setOffline` still takes away here, because the API lives on a different origin. Route handlers
 * run before the network stack, so a fulfilled request is served while the context is offline.
 */
async function serveAppFromDisk(context, baseURL) {
  await context.route(`${baseURL}/**`, async (route) => {
    const { pathname } = new URL(route.request().url())
    const file = await resolveWithFallback(pathname)
    if (!file) return route.abort()
    await route.fulfill({ path: file, headers: { 'content-type': contentTypeFor(file), 'cache-control': 'no-store' } })
  })
}

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
  library: async ({ context, page, baseURL }, use) => {
    // Read by the API handlers, which route interception would otherwise let through while the
    // browser is offline.
    const network = { offline: false }

    /** Waits for the app's own connectivity state, not the browser's, to reach [connected]. */
    const storeAgrees = (connected) => page.waitForFunction((want) => window.$nuxt?.$store?.state?.networkConnected === want, connected, { timeout: 10_000 })

    const goOffline = async () => {
      network.offline = true
      await context.setOffline(true)
      await storeAgrees(false)
    }

    const goOnline = async () => {
      network.offline = false
      await context.setOffline(false)
      await storeAgrees(true)
    }

    let api = { requests: [] }

    const open = async ({ downloads = 24, connected = true, offline = true, serverItems = [] } = {}) => {
      const books = localBooks(downloads)
      api = await installRouteFixtures(context, { libraryItems: serverItems, isOffline: () => network.offline })
      // Always, not only when offline: on a device the web assets ship in the APK and are served
      // locally, so they stay available when the network does not. Registered after the API
      // handlers, and scoped to the app's own origin, so the two never compete.
      await serveAppFromDisk(context, baseURL)
      await seedDevice(context, { downloads: books, connected })

      /**
       * The page is loaded **online, then taken offline** - not the other way round.
       *
       * Chromium does not carry offline emulation across a navigation: `setOffline(true)` followed
       * by `goto` lands on a page reporting `navigator.onLine === true`, and the app then behaves
       * as if connected. Verified, and it is why this reads in what looks like the wrong order.
       *
       * So this models **the connection dropping while the Library tab is open** - which is a real
       * scenario, and the one `LazyBookshelf`'s `networkConnected` watcher exists for. Cold-booting
       * the app offline is not reachable in a browser; the unit suite covers it, by calling `init()`
       * with `networkConnected: false`.
       */
      await page.goto('/bookshelf/library')
      await page.locator('#bookshelf').waitFor()
      await storeAgrees(true)

      if (offline) await goOffline()

      // The shelf re-measures and re-mounts on the connectivity change, two animation frames after
      // the layout settles.
      await page.waitForTimeout(400)

      return { books }
    }

    /** Library requests only, newest last - the shelf's own traffic, without auth or library-list noise. */
    const libraryRequests = () => api.requests.filter((r) => /\/api\/libraries\/[^/]+\/(items|series|collections|playlists)/.test(r.path))

    await use({ open, goOffline, goOnline, libraryRequests, api: () => api.requests, page, context })
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
