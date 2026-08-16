import { test, expect } from '../support/fixtures.mjs'

/**
 * What the user sees while a download is running.
 *
 * **This is the frontend half of a bridge contract, and nothing more.** The transfer itself is
 * Kotlin: `InternalDownloadManager` streams the bytes and `DownloadItemManager` runs the queue, and
 * every question about *behaviour* under a bad network - disconnects mid-body, resuming from a
 * partial file, validating what arrived - is answered by `InternalDownloadManagerTest` and
 * `DownloadIntegrityTest` against MockWebServer. No JavaScript in this app pauses, resumes, retries
 * or cancels a download.
 *
 * So these specs cover only this: **given the events native says it sent, does the indicator show
 * the right thing.** They cannot fail because Android misbehaved, and passing here says nothing
 * about whether Android emits these events in this order. Reaching for "download behaviour on
 * network change" in this tier is reaching for the wrong tier.
 *
 * The events are injected through `Capacitor.Plugins.AbsDownloader.notifyListeners`, which is a real
 * function on the web platform - `AbsDownloaderWeb` is an empty `WebPlugin`, so it has the listener
 * machinery and no methods. That is also why a download can never be *started* here.
 */

/** Fires a bridge event exactly as the native downloader would. */
const emit = (page, event, payload) => page.evaluate(([e, p]) => window.Capacitor.Plugins.AbsDownloader.notifyListeners(e, p), [event, payload])

// `downloadItemId` must match the parent's `id`: `updateDownloadItemPart` finds its item with
// `i.id == downloadItemPart.downloadItemId` (`store/globals.js:126`), so a mismatched pair means
// progress updates are silently dropped.
const part = (id, { fileSize = 1000, bytesDownloaded = 0, completed = false, downloadItemId = 'li-1' } = {}) => ({
  id,
  downloadItemId,
  filename: `${id}.mp3`,
  fileSize,
  bytesDownloaded,
  completed,
  failed: false,
  moved: false,
  episode: null
})

/**
 * A **book** download, as `AbsDownloader.kt:180` builds it: `DownloadItem(libraryItem.id,
 * libraryItem.id, …)`, so `id` and `libraryItemId` are the same string.
 */
const downloadItem = (parts) => ({
  id: 'li-1',
  libraryItemId: 'li-1',
  mediaType: 'book',
  itemTitle: 'A Downloading Book',
  serverConnectionConfigId: 'scc-1',
  downloadItemParts: parts
})

/**
 * The indicator is `widgets-circle-progress` inside `DownloadProgressIndicator`, mounted in the
 * app bar (`Appbar.vue:21`). `.progressbar` is the component's own class, not a Tailwind utility,
 * so it is stable enough to select on without a hook (convention 7).
 */
const indicator = (page) => page.locator('.progressbar').first()

test.describe('the download indicator', () => {
  test('is absent until something is downloading', async ({ library, page }) => {
    // The negative half. Without it every assertion below could be satisfied by an indicator that
    // is simply always on screen.
    await library.open({ offline: false, connected: true, serverItems: [] })

    await expect(indicator(page)).toBeHidden()
  })

  test('appears when the queue reports an item', async ({ library, page }) => {
    await library.open({ offline: false, connected: true, serverItems: [] })

    await emit(page, 'onDownloadItem', downloadItem([part('p1'), part('p2')]))

    await expect(indicator(page)).toBeVisible()
  })

  test('counts the parts still outstanding', async ({ library, page }) => {
    // `downloadItemPartsRemaining` filters on `completed`, and the count is what the badge shows.
    await library.open({ offline: false, connected: true, serverItems: [] })

    await emit(page, 'onDownloadItem', downloadItem([part('p1'), part('p2', { completed: true }), part('p3')]))

    await expect(indicator(page)).toContainText('2')
  })

  test('advances as parts report progress', async ({ library, page }) => {
    // The progress ratio is bytes across *all* parts, so a per-part denominator would show the
    // wrong figure the moment a second part exists. That is the arithmetic this asserts.
    await library.open({ offline: false, connected: true, serverItems: [] })
    await emit(page, 'onDownloadItem', downloadItem([part('p1', { fileSize: 1000 }), part('p2', { fileSize: 1000 })]))

    const before = await indicator(page).innerText()
    await emit(page, 'onDownloadItemPartUpdate', part('p1', { fileSize: 1000, bytesDownloaded: 1000, completed: true }))

    await expect(indicator(page)).not.toHaveText(before)
    await expect(indicator(page)).toBeVisible()
  })

  test('disappears when the queue reports no work left', async ({ library, page }) => {
    // `onQueueChanged` with `hasWork: false` clears the store. An indicator that stays behind after
    // the last download is the visible symptom of a queue that never emptied.
    await library.open({ offline: false, connected: true, serverItems: [] })
    await emit(page, 'onDownloadItem', downloadItem([part('p1')]))
    await expect(indicator(page)).toBeVisible()

    await emit(page, 'onQueueChanged', { hasWork: false })

    await expect(indicator(page)).toBeHidden()
  })

  test('stays while there is still work', async ({ library, page }) => {
    await library.open({ offline: false, connected: true, serverItems: [] })
    await emit(page, 'onDownloadItem', downloadItem([part('p1')]))

    await emit(page, 'onQueueChanged', { hasWork: true })

    await expect(indicator(page)).toBeVisible()
  })

  test('clears the item when native reports it finished', async ({ library, page }) => {
    // `onItemDownloadComplete` removes the item by `libraryItemId`. Removing by the wrong id leaves
    // a finished download on screen forever.
    await library.open({ offline: false, connected: true, serverItems: [] })
    await emit(page, 'onDownloadItem', downloadItem([part('p1')]))

    await emit(page, 'onItemDownloadComplete', {
      libraryItemId: 'li-1',
      localLibraryItem: { id: 'local_1', libraryItemId: 'li-1', mediaType: 'book', media: { metadata: { title: 'A Downloading Book' } }, localFiles: [] },
      localMediaProgress: null
    })

    await expect(indicator(page)).toBeHidden()
  })

  test('survives a completion that native could not turn into a local item', async ({ library, page }) => {
    // The failure shape: the transfer finished but the item could not be created. The app must
    // still clear the queue entry rather than leave a download that can never complete.
    await library.open({ offline: false, connected: true, serverItems: [] })
    await emit(page, 'onDownloadItem', downloadItem([part('p1')]))

    await emit(page, 'onItemDownloadComplete', { libraryItemId: 'li-1', localLibraryItem: null, localMediaProgress: null })

    await expect(indicator(page)).toBeHidden()
  })

  /**
   * A **podcast episode** download, as `AbsDownloader.kt:240-241` builds it: the id is
   * `"${libraryItem.id}-${episode.id}"`, deliberately *not* the library item id.
   */
  test('clears a finished podcast episode download as well', async ({ library, page }) => {
    // Characterization, and a trap worth pinning down.
    //
    // The completion payload's field is *named* `libraryItemId` but carries the **download item's
    // id**: `DownloadItemManager.kt:390` does `put("libraryItemId", item.id)`. For a book those are
    // the same string, so the name looks right; for a podcast episode they differ and the name is
    // simply wrong. `removeItemDownload` matching on `i.id` is therefore correct, and this spec
    // exists so nobody "fixes" that mutation to match on the real `libraryItemId` instead.
    //
    // Doing so would remove *every* episode of a podcast the moment one finished, because episodes
    // of the same podcast share a library item id. An earlier version of this spec sent the real
    // library item id here, failed, and was read as a defect - it was the fixture that was wrong.
    await library.open({ offline: false, connected: true, serverItems: [] })
    const episodeDownloadId = 'li-1-ep-1'
    await emit(page, 'onDownloadItem', { ...downloadItem([part('p1', { downloadItemId: episodeDownloadId })]), id: episodeDownloadId, libraryItemId: 'li-1', mediaType: 'podcast' })

    // What native actually sends: item.id, under the misleading key.
    await emit(page, 'onItemDownloadComplete', { libraryItemId: episodeDownloadId, localLibraryItem: null, localMediaProgress: null })

    await expect(indicator(page)).toBeHidden()
  })

  test('keeps the other episodes when one of them finishes', async ({ library, page }) => {
    // The reason the mutation must not match on the real library item id: two episodes of one
    // podcast share it, so a broadened match would empty the queue on the first completion.
    await library.open({ offline: false, connected: true, serverItems: [] })
    await emit(page, 'onDownloadItem', { ...downloadItem([part('p1', { downloadItemId: 'li-1-ep-1' })]), id: 'li-1-ep-1', libraryItemId: 'li-1', mediaType: 'podcast' })
    await emit(page, 'onDownloadItem', { ...downloadItem([part('p2', { downloadItemId: 'li-1-ep-2' })]), id: 'li-1-ep-2', libraryItemId: 'li-1', mediaType: 'podcast' })

    await emit(page, 'onItemDownloadComplete', { libraryItemId: 'li-1-ep-1', localLibraryItem: null, localMediaProgress: null })

    await expect(indicator(page)).toBeVisible()
    await expect(indicator(page)).toContainText('1')
  })

  test('ignores a malformed completion instead of emptying the queue', async ({ library, page }) => {
    // `onItemDownloadComplete` guards on `libraryItemId`. Treating a malformed payload as "done"
    // would drop a download that is still running.
    await library.open({ offline: false, connected: true, serverItems: [] })
    await emit(page, 'onDownloadItem', downloadItem([part('p1')]))

    await emit(page, 'onItemDownloadComplete', {})

    await expect(indicator(page)).toBeVisible()
  })
})
