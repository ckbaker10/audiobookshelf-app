import { test, expect, serverBook } from '../support/fixtures.mjs'

/**
 * What the app does when its access token expires mid-session.
 *
 * `nativeHttp` catches a 401, refreshes against `<address>/auth/refresh`, and retries the original
 * request. The part worth testing is not the happy path but the **failure taxonomy**: only a 401
 * from the refresh endpoint means the server refused the credential and the session may be torn
 * down. A 500, a proxy error page, a gateway timeout - those are requests that did not complete and
 * say nothing about whether the credential is still good.
 *
 * Getting that wrong signs the user out because the network hiccuped once, and destroys the refresh
 * token that would have restored the session silently. It is the JavaScript twin of the Android
 * defect behind #1908/#1900/#1901, and `plugins/native-http.spec.js` covers the unit - not what the
 * app does with the outcome.
 *
 * The refresh token has to be seeded (`refresh_token_scc-1`), or a 401 is a rejected credential
 * before any refresh is attempted and none of this is reached.
 */

const ITEMS = Array.from({ length: 12 }, (_, i) => serverBook(`s-${i + 1}`, `Book ${i + 1}`))

const refreshCalls = (library) => library.api().filter((r) => r.path.endsWith('/auth/refresh')).length

/**
 * Whether the app tore the session down, read from **where it navigated** rather than from storage.
 *
 * `handleRefreshFailure` ends with `window.location.href = '/connect?error=refreshTokenFailed…'` -
 * a full page navigation, which re-runs `addInitScript` and re-seeds `device` and the refresh token.
 * So `localStorage` shows a healthy session moments after the app cleared it, and any assertion
 * about cleared storage passes against a teardown that did happen. The redirect is the one signal
 * re-seeding cannot forge. See E2E_TESTING.md convention 20.
 */
const wasSignedOut = (page) => /\/connect/.test(page.url())

test.describe('an expired access token', () => {
  test('is refreshed rather than surfaced to the user', async ({ library, page }) => {
    await library.open({ offline: false, connected: true, serverItems: ITEMS, itemsFailFirstWith: 401 })

    expect(refreshCalls(library)).toBeGreaterThan(0)
  })

  test('leaves the shelf showing the library once the retry succeeds', async ({ library, page }) => {
    // The retry is the point: a refresh that works but never re-issues the original request leaves
    // a blank shelf and a valid session, which looks like an empty library.
    await library.open({ offline: false, connected: true, serverItems: ITEMS, itemsFailFirstWith: 401 })

    await expect(page.locator('[id^="book-card-"]').first()).toBeVisible()
    const total = Number((await page.locator('[data-testid="bookshelf-total"]').innerText()).trim().split(/\s+/)[0])
    expect(total).toBe(ITEMS.length)
  })

  test('keeps the user signed in', async ({ library, page }) => {
    await library.open({ offline: false, connected: true, serverItems: ITEMS, itemsFailFirstWith: 401 })
    await page.waitForTimeout(1000)

    expect(wasSignedOut(page)).toBe(false)
    await expect(page).toHaveURL(/\/bookshelf/)
  })
})

test.describe('a refresh the server refuses', () => {
  test('signs the user out', async ({ library, page }) => {
    // A 401 from the refresh endpoint is the one case where ending the session is correct.
    await library.open({ offline: false, connected: true, serverItems: ITEMS, itemsFailFirstWith: 401, refreshStatus: 401 })
    await page.waitForTimeout(2000)

    expect(refreshCalls(library)).toBeGreaterThan(0)
    expect(wasSignedOut(page)).toBe(true)
  })

  test('says why, so the connection screen can explain itself', async ({ library, page }) => {
    // The query carries `error=refreshTokenFailed` and the config id, which is what turns a
    // sudden return to the login screen into something the user can read.
    await library.open({ offline: false, connected: true, serverItems: ITEMS, itemsFailFirstWith: 401, refreshStatus: 401 })
    await page.waitForTimeout(2000)

    expect(page.url()).toContain('error=refreshTokenFailed')
    expect(page.url()).toContain('serverConnectionConfigId=')
  })
})

test.describe('a refresh that did not complete', () => {
  test('does not sign the user out', async ({ library, page }) => {
    // The defect this taxonomy exists for. A 500 is transient; treating it as a refusal destroys a
    // session that was never actually rejected, along with the token that would have restored it.
    await library.open({ offline: false, connected: true, serverItems: ITEMS, itemsFailFirstWith: 401, refreshStatus: 500 })
    await page.waitForTimeout(2000)

    expect(refreshCalls(library)).toBeGreaterThan(0)
    expect(wasSignedOut(page)).toBe(false)
  })

  test('leaves the user where they were', async ({ library, page }) => {
    // One failed request must not move the user. The shelf may be empty until the next attempt -
    // that is a different question from being thrown back to the login screen.
    await library.open({ offline: false, connected: true, serverItems: ITEMS, itemsFailFirstWith: 401, refreshStatus: 500 })
    await page.waitForTimeout(2000)

    await expect(page).toHaveURL(/\/bookshelf/)
  })
})
