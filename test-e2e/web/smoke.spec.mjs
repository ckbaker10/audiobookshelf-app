import { test, expect } from '../support/fixtures.mjs'

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

  test('redirects the root at the bookshelf', async ({ page }) => {
    // `pages/index.vue` redirects to /bookshelf in asyncData, and that is where it stops. It was
    // written here as `/` -> `/bookshelf` -> `/connect`, which is wrong: nothing sends an
    // unauthenticated visitor to the connect screen, because `middleware/authenticated.js` is
    // referenced by no page and never runs. The bookshelf without a session is a real state - it is
    // what shows downloads offline - so this asserts it rather than the guard that does not exist.
    //
    // The redirect is client-side, so this also proves the bundle loaded and Vue took over.
    await page.goto('/')

    await expect(page).toHaveURL(/\/bookshelf/)
  })

  test('renders the connect screen rather than an empty shell', async ({ page }) => {
    await page.goto('/connect')

    // A blank page with a 200 is the failure mode a status-code assertion cannot see.
    await expect(page.locator('body')).not.toBeEmpty()
  })
})
