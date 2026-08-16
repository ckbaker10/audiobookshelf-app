/**
 * Builders for the `localStorage` state `AbsDatabaseWeb` reads.
 *
 * The browser analogue of the unit suite's `storeWith`/`fakeDb`: it puts the device into a known
 * state before the bundle loads, so a spec does not pay for a full login and a download run to
 * reach the screen it is about.
 *
 * Two keys, both read by `plugins/capacitor/AbsDatabase.js`:
 *
 * - `device` - server connection configs and which one is current. Already localStorage-backed.
 * - `localLibraryItems` - the downloads. Answered by a single hardcoded book until this branch;
 *   see that file's comment for why it had to become seedable for any of this to be testable.
 */

const SERVER_ADDRESS = 'http://localhost:13378'

/** One downloaded book, shaped as `LocalLibraryItem` - `AbsDatabase.js`'s own web fixture. */
export function localBook(index, { serverAddress = SERVER_ADDRESS } = {}) {
  const id = `local_${index}`
  return {
    id,
    libraryItemId: `li_${index}`,
    serverAddress,
    serverUserId: 'u1',
    folderId: 'test1',
    absolutePath: `/audiobooks/book-${index}`,
    contentUrl: `content/book-${index}`,
    isInvalid: false,
    mediaType: 'book',
    media: {
      metadata: { title: `Book ${String(index).padStart(2, '0')}`, authorName: 'Test Author' },
      coverPath: null,
      tags: [],
      audioFiles: [],
      chapters: [],
      tracks: [
        {
          index: 1,
          startOffset: 0,
          duration: 1000,
          title: 'Track 1',
          contentUrl: `content/book-${index}/track-1`,
          mimeType: 'audio/mpeg',
          metadata: null,
          isLocal: true,
          localFileId: `lf_${index}_1`,
          audioProbeResult: {}
        }
      ]
    },
    localFiles: [{ id: `lf_${index}_1`, filename: 'track-1.mp3', contentUrl: `content/book-${index}/track-1`, absolutePath: `/audiobooks/book-${index}/track-1.mp3`, mimeType: 'audio/mpeg', size: 1024 }],
    coverContentUrl: null,
    coverAbsolutePath: null,
    isLocal: true
  }
}

/** [count] downloaded books, titled so their order is assertable. */
export const localBooks = (count) => Array.from({ length: count }, (_, i) => localBook(i + 1))

/**
 * Device data with a saved server connection.
 *
 * [connected] decides whether `lastServerConnectionConfigId` is set, which is what separates the
 * two offline states the Library tab behaves differently in: a device that has a session to restore
 * and one that does not. Both are ordinary - the second is a fresh install, or a logout.
 */
export function deviceData({ connected = true, serverAddress = SERVER_ADDRESS } = {}) {
  const config = {
    id: 'scc-1',
    index: 0,
    name: `${serverAddress} (jane)`,
    userId: 'u1',
    username: 'jane',
    address: serverAddress,
    token: 'test-access-token',
    version: '2.36.0',
    customHeaders: {}
  }
  return {
    serverConnectionConfigs: [config],
    lastServerConnectionConfigId: connected ? config.id : null,
    currentLocalPlaybackSession: null,
    deviceSettings: {}
  }
}

/**
 * Writes the seed before any page script runs.
 *
 * `addInitScript` rather than an `evaluate` after navigation: the layout reads device data on mount,
 * so a seed applied afterwards would be a page too late and the first assertion would race it.
 */
export async function seedDevice(context, { downloads = [], connected = true } = {}) {
  await context.addInitScript(
    ([device, items]) => {
      localStorage.setItem('device', device)
      localStorage.setItem('localLibraryItems', items)
    },
    [JSON.stringify(deviceData({ connected })), JSON.stringify(downloads)]
  )
}
