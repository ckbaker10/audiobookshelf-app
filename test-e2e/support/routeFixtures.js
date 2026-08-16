/**
 * `page.route()` handlers standing in for an Audiobookshelf server.
 *
 * **Captured from `audiobookshelf` at commit `96d4021a3cd45f67bf374b65abafbe5d73e926b5`**, which is
 * tag `v2.36.0` (the tag object itself is `57d01f88`; a checkout resolves to the commit). A fixture
 * whose provenance is not written down is indistinguishable from one that was invented, so every
 * shape below names the file it came from.
 *
 * The pin is not the tracking checkout at `/home/lukas/repos/audiobookshelf`, which follows
 * upstream. Re-capture with:
 *
 *     git -C /home/lukas/repos/audiobookshelf worktree add /home/lukas/repos/abs-2.36.0 v2.36.0
 *
 * These are shapes, not recordings: field *names* and nesting are the server's, values are the
 * test's. That is the part the app breaks on - it reads `payload.results` and `payload.total`, and
 * a fixture that got the envelope wrong would pass while production could not parse a real answer.
 */

/** The version reported to the app. Must clear `layouts/default.vue`'s `$isValidVersion(…, '2.26.0')`
 *  gate, or the layout takes its pre-2.26 auth branch and the page under test is not the shipped one. */
export const SERVER_VERSION = '2.36.0'

const serverBook = (id, title) => ({
  id,
  ino: `${id}-ino`,
  libraryId: 'lib-1',
  mediaType: 'book',
  media: {
    id: `media-${id}`,
    metadata: { title, titleIgnorePrefix: title, authorName: 'Test Author', seriesName: '' },
    coverPath: null,
    numTracks: 1,
    duration: 3600,
    size: 1024
  },
  numFiles: 1,
  size: 1024
})

/**
 * `GET /api/libraries/:id/items` - `server/controllers/LibraryController.js:610-622`.
 *
 * The envelope carries `results`/`total` alongside an echo of the query. `LazyBookshelf` reads only
 * the first two, but the rest is what the server sends and leaving it out would quietly narrow what
 * the fixture proves.
 */
export const libraryItemsPayload = (results, total, query = {}) => ({
  results,
  total,
  limit: Number(query.limit || 0),
  page: Number(query.page || 0),
  sortBy: query.sort,
  sortDesc: query.desc === '1',
  filterBy: query.filter,
  mediaType: 'book',
  minified: query.minified === '1',
  collapseseries: query.collapseseries === '1',
  include: query.include || ''
})

/** `POST /api/authorize` - `server/Auth.js:96-105`, via `MiscController.authorize`. */
export const authorizePayload = (user) => ({
  user: { ...user, accessToken: 'test-access-token', refreshToken: null },
  userDefaultLibraryId: 'lib-1',
  serverSettings: { version: SERVER_VERSION, scannerFindCovers: false, sortingIgnorePrefix: false },
  ereaderDevices: [],
  Source: 'test'
})

/**
 * Installs the handlers on a context.
 *
 * `socket.io` is **aborted rather than faked**. There is no convincing way to intercept it, and a
 * half-working socket would let a spec assert against a connection state the app never really
 * reaches. Aborting states the boundary: these specs cover what the app does without a live socket.
 */
export async function installRouteFixtures(context, { libraryItems = [], user = { id: 'u1', username: 'jane', type: 'user' } } = {}) {
  await context.route('**/socket.io/**', (route) => route.abort())

  await context.route('**/api/libraries/*/items*', (route) => {
    const query = Object.fromEntries(new URL(route.request().url()).searchParams)
    const start = Number(query.page || 0) * Number(query.limit || libraryItems.length)
    const limit = Number(query.limit || libraryItems.length)
    const page = libraryItems.slice(start, start + limit)
    route.fulfill({ json: libraryItemsPayload(page, libraryItems.length, query) })
  })

  await context.route('**/api/authorize', (route) => route.fulfill({ json: authorizePayload(user) }))

  await context.route('**/api/libraries', (route) => route.fulfill({ json: { libraries: [{ id: 'lib-1', name: 'Main', mediaType: 'book' }] } }))
}

export { serverBook }
