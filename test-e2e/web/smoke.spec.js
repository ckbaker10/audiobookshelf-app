import { test, expect } from '../support/fixtures.js'

/**
 * The build serves, boots, and routes.
 *
 * This spec exists to isolate the tarpit. Everything else in this directory assumes a static build
 * that serves correctly, hydrates, and applies its own routing - and when that assumption is wrong
 * the symptom is a timeout inside whichever spec ran first, which is a bad place to start debugging.
 *
 * Nothing here asserts application behaviour. If it is red, no other spec in this directory means
 * anything.
 */

test.describe('the static build', () => {
  test('serves the client-side fallback for a deep link', async ({ page }) => {
    // `nuxt generate` emits 200.html for exactly this. Without it every deep-linked spec 404s.
    const response = await page.goto('/bookshelf/library')

    expect(response?.status()).toBe(200)
  })

  test('redirects the root at the connect screen when no server is configured', async ({ page }) => {
    // `pages/index.vue` redirects to /bookshelf in asyncData; with no session the app ends at
    // /connect. The chain is client-side, so this also proves the bundle loaded and Vue took over.
    await page.goto('/')

    await expect(page).toHaveURL(/\/connect/)
  })

  test('renders the connect screen rather than an empty shell', async ({ page }) => {
    await page.goto('/connect')

    // A blank page with a 200 is the failure mode a status-code assertion cannot see.
    await expect(page.locator('body')).not.toBeEmpty()
  })
})
