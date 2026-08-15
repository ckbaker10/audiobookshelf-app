import { describe, it, expect } from 'vitest'
import { getters, mutations } from '@/store/globals'

/**
 * The download-queue state in `store/globals.js`.
 *
 * This is the frontend half of downloading: the native side reports part progress over the
 * Capacitor bridge, and these mutations turn that into the percentage the downloading page and the
 * item cards render. The Android suite covers the transfer itself (`InternalDownloadManagerTest`,
 * `DownloadIntegrityTest`, `DownloadItemManagerTest`); none of that reaches this arithmetic, and
 * it had no coverage.
 *
 * Relevant to three earlier attempts at download fixes - see
 * `AI_Planning/audiobookshelf/download-branches-analysis.md`. Most of what those branches change is
 * Kotlin and belongs in the Android suite; this file is the slice a frontend test can honestly
 * own.
 */

const part = (over = {}) => ({
  id: 'part-1',
  downloadItemId: 'item-1',
  filename: 'track.mp3',
  fileSize: 1000,
  bytesDownloaded: 0,
  completed: false,
  failed: false,
  ...over
})

const item = (over = {}) => ({
  id: 'item-1',
  libraryItemId: 'li-1',
  episodeId: null,
  itemProgress: 0,
  downloadItemParts: [part()],
  ...over
})

describe('addUpdateItemDownload', () => {
  it('adds a new item to the queue', () => {
    const state = { itemDownloads: [] }

    mutations.addUpdateItemDownload(state, item())

    expect(state.itemDownloads).toHaveLength(1)
    expect(state.itemDownloads[0].id).toBe('item-1')
  })

  it('replaces an existing item in place rather than appending a duplicate', () => {
    const state = { itemDownloads: [item({ itemProgress: 0.2 })] }

    mutations.addUpdateItemDownload(state, item({ itemProgress: 0.9 }))

    expect(state.itemDownloads).toHaveLength(1)
    expect(state.itemDownloads[0].itemProgress).toBe(0.9)
  })

  it('keeps items with different ids side by side', () => {
    const state = { itemDownloads: [item()] }

    mutations.addUpdateItemDownload(state, item({ id: 'item-2', libraryItemId: 'li-2' }))

    expect(state.itemDownloads.map((i) => i.id)).toEqual(['item-1', 'item-2'])
  })

  /**
   * **Defect spec.** An item queued with parts that are *already* complete shows 0%.
   *
   * `addUpdateItemDownload` stores the item as given and never derives `itemProgress` from its
   * parts (`globals.js:102-109`). Progress is only ever computed in `updateDownloadItemPart`, which
   * runs when the native side reports a part *changing*.
   *
   * A part that was already on disk when the download was queued never changes, so it never
   * reports, so the percentage stays at zero for work that is already done. Restarting a download
   * that respects previously-downloaded files - which is what the native side does - therefore
   * shows a queue sitting at 0% and apparently stuck.
   *
   * Inputs: an item whose only part is `completed: true` with all its bytes downloaded.
   * Expected: 100%.
   * Observed: 0%.
   *
   * This is the "cached download frontend issues" that `origin/fix-download-issue` addresses in
   * `store/globals.js`. Left failing; the fix belongs on its own branch.
   */
  it('derives progress from parts that were already complete when queued', () => {
    const state = { itemDownloads: [] }

    mutations.addUpdateItemDownload(
      state,
      item({ downloadItemParts: [part({ completed: true, bytesDownloaded: 1000 })] })
    )

    expect(state.itemDownloads[0].itemProgress).toBe(1)
  })

  it('derives partial progress when only some parts were already complete', () => {
    const state = { itemDownloads: [] }

    mutations.addUpdateItemDownload(
      state,
      item({
        downloadItemParts: [
          part({ id: 'p1', completed: true, bytesDownloaded: 1000 }),
          part({ id: 'p2', fileSize: 1000, bytesDownloaded: 0 })
        ]
      })
    )

    expect(state.itemDownloads[0].itemProgress).toBe(0.5)
  })

  it('does not divide by zero for an item queued with no parts', () => {
    // The guard on the fix above: a parts-less item must not become NaN progress.
    const state = { itemDownloads: [] }

    mutations.addUpdateItemDownload(state, item({ downloadItemParts: [] }))

    expect(state.itemDownloads[0].itemProgress).toBe(0)
  })
})

describe('updateDownloadItemPart', () => {
  it('replaces the matching part and recomputes progress', () => {
    const state = { itemDownloads: [item()] }

    mutations.updateDownloadItemPart(state, part({ bytesDownloaded: 500 }))

    expect(state.itemDownloads[0].itemProgress).toBe(0.5)
    expect(state.itemDownloads[0].downloadItemParts[0].bytesDownloaded).toBe(500)
  })

  it('leaves other parts of the same item untouched', () => {
    const state = {
      itemDownloads: [item({ downloadItemParts: [part({ id: 'p1' }), part({ id: 'p2', fileSize: 1000 })] })]
    }

    mutations.updateDownloadItemPart(state, part({ id: 'p1', bytesDownloaded: 1000, completed: true }))

    const parts = state.itemDownloads[0].downloadItemParts
    expect(parts[1].bytesDownloaded).toBe(0)
    expect(state.itemDownloads[0].itemProgress).toBe(0.5)
  })

  it('reaches exactly 1 when every part is complete', () => {
    const state = {
      itemDownloads: [
        item({
          downloadItemParts: [
            part({ id: 'p1', completed: true, bytesDownloaded: 1000 }),
            part({ id: 'p2', fileSize: 1000 })
          ]
        })
      ]
    }

    mutations.updateDownloadItemPart(state, part({ id: 'p2', fileSize: 1000, bytesDownloaded: 1000, completed: true }))

    expect(state.itemDownloads[0].itemProgress).toBe(1)
  })

  it('clamps progress at 1 when a part reports more bytes than its declared size', () => {
    // Cover parts are created with fileSize 0 on the native side, so "downloaded more than
    // expected" is a real shape rather than a hypothetical.
    const state = { itemDownloads: [item()] }

    mutations.updateDownloadItemPart(state, part({ bytesDownloaded: 5000 }))

    expect(state.itemDownloads[0].itemProgress).toBe(1)
  })

  it('reports zero rather than NaN when every part has zero size', () => {
    const state = { itemDownloads: [item({ downloadItemParts: [part({ fileSize: 0 })] })] }

    mutations.updateDownloadItemPart(state, part({ fileSize: 0, bytesDownloaded: 0 }))

    expect(state.itemDownloads[0].itemProgress).toBe(0)
  })

  it('ignores an update for an item that is not in the queue', () => {
    const state = { itemDownloads: [item()] }

    mutations.updateDownloadItemPart(state, part({ downloadItemId: 'item-gone' }))

    expect(state.itemDownloads[0].itemProgress).toBe(0)
    expect(state.itemDownloads).toHaveLength(1)
  })

  it('coerces string byte counts, since the bridge sends them as strings', () => {
    // Capacitor serialises Kotlin Longs as strings on some paths; the mutation calls Number() for
    // exactly this reason, and the arithmetic would concatenate rather than add without it.
    const state = { itemDownloads: [item()] }

    mutations.updateDownloadItemPart(state, part({ fileSize: '1000', bytesDownloaded: '250' }))

    expect(state.itemDownloads[0].itemProgress).toBe(0.25)
  })

  /**
   * Characterization of the size-accounting rule, which is easy to misread.
   *
   * A **completed** part contributes its `bytesDownloaded` to the denominator; an in-flight part
   * contributes its declared `fileSize`. So the denominator moves as parts complete, and a part
   * that finishes smaller than declared *shrinks* the total rather than leaving the item short of
   * 100%.
   *
   * That is what makes a download reach exactly 1 even when the server's declared sizes were
   * wrong, which is the desirable outcome - but it also means `itemProgress` is not a stable
   * fraction of a fixed total, and can jump when a part completes.
   */
  it('uses actual bytes for completed parts and declared size for pending ones (characterization)', () => {
    const state = {
      itemDownloads: [
        item({
          downloadItemParts: [
            // Declared 1000, actually finished at 500.
            part({ id: 'p1', fileSize: 1000, completed: true, bytesDownloaded: 500 }),
            part({ id: 'p2', fileSize: 500, bytesDownloaded: 0 })
          ]
        })
      ]
    }

    mutations.updateDownloadItemPart(state, part({ id: 'p2', fileSize: 500, bytesDownloaded: 500, completed: true }))

    // Denominator is 500 + 500, not 1000 + 500.
    expect(state.itemDownloads[0].itemProgress).toBe(1)
  })
})

describe('removeItemDownload and clearItemDownloads', () => {
  it('removes only the matching item', () => {
    const state = { itemDownloads: [item(), item({ id: 'item-2' })] }

    mutations.removeItemDownload(state, 'item-1')

    expect(state.itemDownloads.map((i) => i.id)).toEqual(['item-2'])
  })

  it('is a no-op for an unknown id', () => {
    const state = { itemDownloads: [item()] }

    mutations.removeItemDownload(state, 'item-gone')

    expect(state.itemDownloads).toHaveLength(1)
  })

  it('clearItemDownloads empties the queue', () => {
    const state = { itemDownloads: [item(), item({ id: 'item-2' })] }

    mutations.clearItemDownloads(state)

    expect(state.itemDownloads).toEqual([])
  })
})

describe('getDownloadItem', () => {
  const state = {
    itemDownloads: [
      item({ id: 'item-1', libraryItemId: 'li-1', episodeId: null }),
      item({ id: 'item-2', libraryItemId: 'li-2', episodeId: 'ep-1' }),
      item({ id: 'item-3', libraryItemId: 'li-2', episodeId: 'ep-2' })
    ]
  }

  it('finds a book download by library item id', () => {
    expect(getters.getDownloadItem(state)('li-1').id).toBe('item-1')
  })

  it('finds a specific episode download', () => {
    expect(getters.getDownloadItem(state)('li-2', 'ep-2').id).toBe('item-3')
  })

  it('misses cleanly for an unknown item or episode', () => {
    expect(getters.getDownloadItem(state)('li-missing')).toBeUndefined()
    expect(getters.getDownloadItem(state)('li-2', 'ep-missing')).toBeUndefined()
  })

  /**
   * Characterization. Asking for a *book* download of a library item that only has episode
   * downloads queued returns the first episode, because the episode filter is skipped when no
   * `episodeId` is passed.
   *
   * Reachable from a podcast item card, which asks without an episode id to decide whether to show
   * a download indicator - so the indicator reflects "some episode is downloading" rather than
   * "this item is downloading". Defensible for that use, surprising for any other.
   */
  it('returns an episode download when asked without an episode id (characterization)', () => {
    expect(getters.getDownloadItem(state)('li-2').id).toBe('item-2')
  })
})
