/**
 * `page.route()` handlers standing in for an Audiobookshelf server.
 *
 * **Captured from `audiobookshelf` at commit `96d4021a3cd45f67bf374b65abafbe5d73e926b5`**, which is
 * tag `v2.36.0` (the tag object itself is `57d01f88`; a checkout resolves to the commit). A fixture
 * whose provenance is not written down is indistinguishable from one that was invented, so every
 * shape below names the file it came from.
 *
 * Capture against that tag specifically, not against a tracking checkout of the server repo, which
 * follows upstream and would make "what we captured against" a moving answer. From a clone of
 * `github.com/advplyr/audiobookshelf`:
 *
 *     git worktree add ../abs-2.36.0 v2.36.0
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

/**
 * Result shapes for the non-book shelves.
 *
 * Only the fields the cards actually read, which is the honest minimum: `LazySeriesCard` uses
 * `name`/`books`/`id`, `LazyCollectionCard` `name`/`books`/`id`, `LazyPlaylistCard`
 * `name`/`items`/`id`. Padding them out with fields nothing reads would suggest coverage that does
 * not exist.
 */
export const serverSeries = (id, name, bookCount = 3) => ({
  id,
  name,
  nameIgnorePrefix: name,
  libraryId: 'lib-1',
  books: Array.from({ length: bookCount }, (_, i) => serverBook(`${id}-b${i + 1}`, `${name} ${i + 1}`))
})

export const serverCollection = (id, name, bookCount = 2) => ({
  id,
  libraryId: 'lib-1',
  name,
  description: null,
  books: Array.from({ length: bookCount }, (_, i) => serverBook(`${id}-b${i + 1}`, `${name} ${i + 1}`))
})

export const serverPlaylist = (id, name, itemCount = 2) => ({
  id,
  libraryId: 'lib-1',
  userId: 'u1',
  name,
  description: null,
  items: Array.from({ length: itemCount }, (_, i) => ({ id: `${id}-i${i + 1}`, libraryItemId: `${id}-b${i + 1}`, libraryItem: serverBook(`${id}-b${i + 1}`, `${name} ${i + 1}`) }))
})

/**
 * `GET /api/libraries/:id?include=filterdata` - `LibraryController.js:220-233`.
 *
 * `libraries/fetch` reads `library`, `filterdata`, `issues` and `numUserPlaylists` and commits four
 * mutations from them, so a switch that answers the wrong shape half-updates the store.
 */
export const libraryDetailPayload = (library) => ({
  library,
  filterdata: { authors: [], genres: [], tags: [], series: [], narrators: [], languages: [], numIssues: 0 },
  issues: 0,
  numUserPlaylists: 0
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
export const DEFAULT_LIBRARIES = [
  { id: 'lib-1', name: 'Main', mediaType: 'book', icon: 'audiobookshelf', provider: 'google' },
  { id: 'lib-2', name: 'Second', mediaType: 'book', icon: 'books-1', provider: 'google' }
]

export async function installRouteFixtures(
  context,
  {
    libraryItems = [],
    /** Per-library item lists, so a switch can be shown to change what the shelf holds. */
    itemsByLibrary = null,
    series = [],
    collections = [],
    playlists = [],
    libraries = DEFAULT_LIBRARIES,
    user = { id: 'u1', username: 'jane', type: 'user' },
    /** Answer the first library-items request with this status instead, to drive the 401 path. */
    itemsFailFirstWith = null,
    /** Status for `POST <address>/auth/refresh`: 200 refreshes, 401 refuses, 5xx is transient. */
    refreshStatus = 200,
    isOffline = () => false
  } = {}
) {
  /**
   * Every API request the app made, in order, with its query already parsed.
   *
   * The app's *outgoing* request is the assertable half of anything query-driven - a filter or a
   * sort is a query string long before it is a different set of cards, and asserting only on the
   * rendered result cannot tell "asked for the wrong thing" from "rendered the wrong thing".
   */
  const requests = []
  /**
   * Route handlers run *before* the network stack, so `context.setOffline(true)` does not reach
   * them - a fulfilled request succeeds while the browser is offline. Without this check the app
   * authenticates and loads its library from a server it is supposed to be unable to see, and every
   * "offline" spec quietly tests the online path.
   *
   * `internetdisconnected` is the error a real unreachable server produces, so the app's failure
   * handling takes the same branch it takes on a device.
   */
  const whenReachable = (handler) => (route) => {
    const url = new URL(route.request().url())
    requests.push({ method: route.request().method(), path: url.pathname, query: Object.fromEntries(url.searchParams), offline: isOffline() })
    return isOffline() ? route.abort('internetdisconnected') : handler(route)
  }

  await context.route('**/socket.io/**', (route) => route.abort())

  /**
   * `GET <address>/ping` - the reachability check `ServerConnectForm.connectToServer` makes *before*
   * authenticating (`:532`, `:699`). Unanswered, the connect flow decides the server is unreachable
   * and never gets as far as `/api/authorize`, so every spec that walks through the connection
   * screen silently tests the failure path instead.
   *
   * Note the path: it is `/ping`, not `/api/ping`.
   */
  await context.route(
    '**/ping',
    whenReachable((route) => route.fulfill({ json: { success: true } }))
  )

  /** `GET <address>/status` - which auth methods the connection screen should offer. */
  await context.route(
    '**/status',
    whenReachable((route) => route.fulfill({ json: { app: 'audiobookshelf', isInit: true, language: 'en-us', authMethods: ['local'] } }))
  )

  /** Paginates [all] the way the server does, so the shelf's paging is exercised rather than bypassed. */
  const paged = (all, query) => {
    const limit = Number(query.limit || all.length)
    const start = Number(query.page || 0) * limit
    return libraryItemsPayload(all.slice(start, start + limit), all.length, query)
  }

  /** The library id out of `/api/libraries/<id>/...`. */
  const libraryIdOf = (path) => path.split('/')[3]

  let itemsFailuresLeft = itemsFailFirstWith ? 1 : 0

  await context.route(
    '**/api/libraries/*/items*',
    whenReachable((route) => {
      // Spent once, so the retry after a successful refresh gets a real answer - which is what
      // makes "recovered from a 401" distinguishable from "never recovered".
      if (itemsFailuresLeft > 0) {
        itemsFailuresLeft--
        return route.fulfill({ status: itemsFailFirstWith, json: { error: 'Unauthorized' } })
      }
      const url = new URL(route.request().url())
      const query = Object.fromEntries(url.searchParams)
      const forLibrary = itemsByLibrary?.[libraryIdOf(url.pathname)] ?? libraryItems
      route.fulfill({ json: paged(forLibrary, query) })
    })
  )

  /**
   * `POST <address>/auth/refresh` - `plugins/nativeHttp.js:159-166`.
   *
   * The status is the whole point: only **401** means the server refused the credential and the
   * session may be torn down. Anything else is a request that did not complete and says nothing
   * about whether the credential is still good - the distinction the transient-refresh logout
   * defect was about.
   */
  await context.route(
    '**/auth/refresh',
    whenReachable((route) => {
      if (refreshStatus !== 200) return route.fulfill({ status: refreshStatus, json: { error: 'refresh failed' } })
      route.fulfill({ json: { user: { ...user, accessToken: 'refreshed-access-token', refreshToken: 'refreshed-refresh-token' } } })
    })
  )

  // Same envelope as items - `LibraryController.js:748-758` and `:820-830` build it identically -
  // but a different `LazyBookshelf` entity path, card component and card geometry.
  for (const [entity, results] of [
    ['series', series],
    ['collections', collections],
    ['playlists', playlists]
  ]) {
    await context.route(
      `**/api/libraries/*/${entity}*`,
      whenReachable((route) => route.fulfill({ json: paged(results, Object.fromEntries(new URL(route.request().url()).searchParams)) }))
    )
  }

  await context.route(
    '**/api/libraries/*\\?include=filterdata',
    whenReachable((route) => {
      const id = libraryIdOf(new URL(route.request().url()).pathname)
      route.fulfill({ json: libraryDetailPayload(libraries.find((l) => l.id === id) || libraries[0]) })
    })
  )

  await context.route(
    '**/api/authorize',
    whenReachable((route) => route.fulfill({ json: authorizePayload(user) }))
  )

  await context.route(
    '**/api/libraries',
    whenReachable((route) => route.fulfill({ json: { libraries } }))
  )

  return { requests }
}

export { serverBook }
