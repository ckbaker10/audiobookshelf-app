import { test, expect, serverBook } from '../support/fixtures.mjs'

/**
 * "Switch Server/User" from the side drawer — the #1335 journey.
 *
 * This is the regression the whole browser tier was argued for. It broke in two halves that live in
 * different components, which is exactly why both components' unit tests stayed green while the
 * feature did not work:
 *
 * - `SideDrawer.clickAction` stopped logging the user out (the #1335 fix) and pushed
 *   `/connect?switching=1`.
 * - `ServerConnectForm`, which that fix never touched, saw a still-valid `lastServerConnectionConfig`
 *   on arrival, auto-connected to the server the user was trying to leave, and replaced the screen
 *   with `/bookshelf`. The picker was never reachable.
 *
 * `navigation/switch-server-connection-screen.spec.js` covers the arrival side by hand-building the
 * state the connect screen would have been in. Here the app actually walks there, which is the only
 * way the seam between the two components is under test at all.
 *
 * **Reachable in a browser** despite the earlier plan saying otherwise: neither `pages/connect.vue`
 * nor `SideDrawer` reads `socketConnected`. Only the *logout* half of the drawer needs a socket,
 * because it lands on `pages/account.vue`. Switching does not.
 */

const ITEMS = Array.from({ length: 10 }, (_, i) => serverBook(`s-${i + 1}`, `Book ${i + 1}`))

async function openDrawer(page) {
  // The appbar trigger already carries a stable aria-label (convention 7).
  await page.locator('[aria-label="Toggle side drawer"]').click()
  await expect(page.locator('[data-testid="drawer-action"][data-action="switchServerUser"]')).toBeVisible()
}

test.describe('switching server or user', () => {
  test('lands on the connection screen with the switching flag', async ({ library, page }) => {
    await library.open({ offline: false, connected: true, serverItems: ITEMS })

    await openDrawer(page)
    await page.locator('[data-testid="drawer-action"][data-action="switchServerUser"]').click()

    await expect(page).toHaveURL(/\/connect\?switching=1/)
  })

  test('shows the server list instead of reconnecting to the server being left', async ({ library, page }) => {
    // The regression, stated directly. `ServerConnectForm.init` returns early on `switching`
    // precisely so this list renders rather than `connectToServer(lastServerConnectionConfig)`.
    await library.open({ offline: false, connected: true, serverItems: ITEMS })

    await openDrawer(page)
    await page.locator('[data-testid="drawer-action"][data-action="switchServerUser"]').click()

    await expect(page.locator('[data-testid="server-config"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="server-config"]').first()).toBeVisible()
  })

  test('stays on the connection screen rather than bouncing back to the shelf', async ({ library, page }) => {
    // The other half of the same defect: the auto-connect did not just re-authenticate, it
    // *navigated*, so the user was returned to the session they asked to change. A URL assertion
    // taken too early passes either way, so this one waits and then insists.
    await library.open({ offline: false, connected: true, serverItems: ITEMS })

    await openDrawer(page)
    await page.locator('[data-testid="drawer-action"][data-action="switchServerUser"]').click()
    await page.waitForTimeout(1500)

    await expect(page).toHaveURL(/\/connect/)
    expect(page.url()).not.toContain('/bookshelf')
  })

  test('keeps the session rather than logging the user out', async ({ library, page }) => {
    // The #1335 fix's own contract: switching is not leaving. Clearing the session here is what
    // the original defect did, and it is why the fix had to be careful.
    await library.open({ offline: false, connected: true, serverItems: ITEMS })

    await openDrawer(page)
    await page.locator('[data-testid="drawer-action"][data-action="switchServerUser"]').click()
    await page.waitForTimeout(1000)

    const device = await page.evaluate(() => JSON.parse(localStorage.getItem('device') || '{}'))
    expect(device.lastServerConnectionConfigId).toBeTruthy()
    expect(device.serverConnectionConfigs?.length).toBe(1)
  })

  test('does not re-authenticate on arrival', async ({ library, page }) => {
    // The mechanism, rather than its symptom: the auto-connect is an `/api/authorize` call. If one
    // happens after the switch, the screen has already begun rejoining the old session even if the
    // navigation has not landed yet.
    await library.open({ offline: false, connected: true, serverItems: ITEMS })

    await openDrawer(page)
    const before = library.api().filter((r) => r.path.endsWith('/api/authorize')).length
    await page.locator('[data-testid="drawer-action"][data-action="switchServerUser"]').click()
    await page.waitForTimeout(1500)

    expect(library.api().filter((r) => r.path.endsWith('/api/authorize')).length).toBe(before)
  })
})

test.describe('arriving at the connection screen normally', () => {
  test('auto-connects when there is a saved session and no switching flag', async ({ library, page }) => {
    // The guard on the fix. "Do not auto-connect while switching" must not become "never
    // auto-connect", or every ordinary launch strands the user on the picker.
    await library.open({ offline: false, connected: true, serverItems: ITEMS })

    await page.goto('/connect')

    await expect(page).toHaveURL(/\/bookshelf/, { timeout: 10_000 })
  })
})
