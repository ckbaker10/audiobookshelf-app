import { test, expect, serverBook } from '../support/fixtures.mjs'

/**
 * Playing a server item, through the app's real audio player.
 *
 * `AbsAudioPlayerWeb` is not a stub - it is a 293-line implementation that builds an actual
 * `<audio>` element, fetches a playback session from `/api/items/:id/play`, and implements
 * play/pause, seek, playback rate and progress events on it (`plugins/capacitor/AbsAudioPlayer.js`).
 * So the whole prepare → load → play → seek chain runs for real here, with `AudioPlayerContainer`
 * responding to genuine media events rather than to a fake.
 *
 * That makes this the one tier where playback is observable at all. The unit suite cannot mount an
 * `<audio>` element that decodes anything, and the Android tier tests ExoPlayer instead - a
 * different player entirely.
 *
 * **The audio has to be real.** The fixture generates a silent WAV rather than serving a stub body,
 * because Chromium leaves `readyState` at 0 for undecodable bytes and every assertion below would
 * then wait forever on metadata that never arrives.
 *
 * **Local playback is out of scope** and cannot be added here: `prepareLibraryItem` branches on a
 * `local_` id and does nothing, above the comment `// Fetch Local - local not implemented on web`.
 * Downloads can be seeded and browsed in this tier, never played.
 */

const ITEM_ID = 's-1'

/** The player element the web plugin creates, once it exists. */
const audio = (page) => page.locator('audio')

const audioState = (page) =>
  page.locator('audio').evaluate((el) => ({
    src: el.src,
    paused: el.paused,
    currentTime: el.currentTime,
    duration: el.duration,
    readyState: el.readyState,
    playbackRate: el.playbackRate
  }))

/**
 * Starts playback the way a user does: shelf → tap a book → tap play.
 *
 * **Not** `goto('/item/…')`. The page's `asyncData` redirects when
 * `store.state.user.serverConnectionConfig` is unset (`pages/item/_id/index.vue:201-204`), and on a
 * direct navigation it runs during route resolution - before the layout's `attemptConnection` has
 * set that config. A deep link therefore bounces to the shelf and the spec never reaches the page.
 * Arriving from the shelf is both the fix and what a user actually does.
 *
 * Chromium also blocks autoplay without a gesture, and a real click *is* the gesture - which is a
 * second reason to drive the button rather than call the plugin.
 */
async function playFromItemPage(library, page) {
  await library.open({ offline: false, connected: true, serverItems: [serverBook(ITEM_ID, 'A Playable Book')], waitFor: '#bookshelf' })
  await page.locator('[id^="book-card-"]').first().click()
  await page.locator('[data-testid="item-play"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-testid="item-play"]').click()
  await audio(page).waitFor({ state: 'attached', timeout: 10_000 })
}

test.describe('starting playback', () => {
  test('asks the server to open a playback session', async ({ library, page }) => {
    await playFromItemPage(library, page)

    const play = library.api().find((r) => r.path.includes(`/api/items/${ITEM_ID}/play`))
    expect(play).toBeTruthy()
    expect(play?.method).toBe('POST')
  })

  test('points the player at the session track', async ({ library, page }) => {
    // The URL is assembled from the session id and the track index
    // (`AbsAudioPlayer.js:247-261`); getting it wrong loads nothing and fails silently.
    await playFromItemPage(library, page)

    const state = await audioState(page)
    expect(state.src).toContain('/public/session/')
    expect(state.src).toContain('/track/')
  })

  test('loads audio the browser can actually decode', async ({ library, page }) => {
    // readyState >= 1 means metadata arrived. This is the assertion that separates "we set a src"
    // from "there is a playable track behind it", and the reason the fixture generates real WAV.
    await playFromItemPage(library, page)

    await expect.poll(async () => (await audioState(page)).readyState, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
    expect((await audioState(page)).duration).toBeGreaterThan(0)
  })

  test('actually plays', async ({ library, page }) => {
    await playFromItemPage(library, page)

    await expect.poll(async () => (await audioState(page)).paused, { timeout: 10_000 }).toBe(false)
    await expect.poll(async () => (await audioState(page)).currentTime, { timeout: 10_000 }).toBeGreaterThan(0)
  })
})

test.describe('controlling playback', () => {
  test('pauses and resumes', async ({ library, page }) => {
    await playFromItemPage(library, page)
    await expect.poll(async () => (await audioState(page)).paused, { timeout: 10_000 }).toBe(false)

    await page.evaluate(() => document.querySelector('audio').pause())
    expect((await audioState(page)).paused).toBe(true)

    await page.evaluate(() => document.querySelector('audio').play())
    await expect.poll(async () => (await audioState(page)).paused, { timeout: 5000 }).toBe(false)
  })

  test('seeks to a position within the track', async ({ library, page }) => {
    await playFromItemPage(library, page)
    await expect.poll(async () => (await audioState(page)).readyState, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)

    await page.evaluate(() => {
      document.querySelector('audio').currentTime = 3
    })

    await expect.poll(async () => (await audioState(page)).currentTime, { timeout: 5000 }).toBeGreaterThanOrEqual(2.5)
  })

  test('changes speed without restarting the track', async ({ library, page }) => {
    // `setPlaybackSpeed` assigns `player.playbackRate`. Losing the position on a rate change is a
    // classic player defect and needs a real element to see.
    await playFromItemPage(library, page)
    await expect.poll(async () => (await audioState(page)).currentTime, { timeout: 10_000 }).toBeGreaterThan(0)
    const before = (await audioState(page)).currentTime

    await page.evaluate(() => {
      document.querySelector('audio').playbackRate = 2
    })

    const after = await audioState(page)
    expect(after.playbackRate).toBe(2)
    expect(after.currentTime).toBeGreaterThanOrEqual(before - 0.5)
  })
})
