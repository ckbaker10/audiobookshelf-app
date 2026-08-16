import { mount } from '@vue/test-utils'
import Vue from 'vue'
import Vuex from 'vuex'

Vue.use(Vuex)
Vue.config.productionTip = false
Vue.config.devtools = false

/**
 * Shared harness for component tests.
 *
 * The governing rule, taken from the Android suite: a stub that silently returns `undefined` is
 * worse than no stub at all, because a test written against it passes for the wrong reason. Every
 * fake here either returns something a test explicitly asked for, or throws. Nothing no-ops.
 *
 * That matters more than usual in this codebase. `$db` is a Capacitor bridge with no
 * implementation outside a device, and the defect these tests were first written for is a
 * *swallowed* failure - so a harness that quietly hands back `undefined` would reproduce the bug
 * inside the test framework itself.
 */

/** Marks a fake that has not been configured, so misuse fails loudly at the call site. */
const notStubbed = (name) => () => {
  throw new Error(
    `[harness] ${name} was called but not stubbed. Pass it to mountComponent({ ... }) ` +
      `explicitly - the harness will not invent a return value, because a silent undefined is ` +
      `how the bug under test hides.`
  )
}

/**
 * Stands in for `plugins/db.js` (the AbsDatabase Capacitor bridge).
 *
 * `localLibraryItems` defaults to an empty array rather than throwing: "no downloads" is a real,
 * common state that many tests need as a background condition, and forcing every test to declare
 * it would add noise without catching anything.
 */
export function fakeDb({ localLibraryItems = [], localMediaProgress = [] } = {}) {
  const calls = []
  return {
    calls,
    getLocalLibraryItems: async (mediaType) => {
      calls.push({ method: 'getLocalLibraryItems', mediaType })
      if (!mediaType) return localLibraryItems
      return localLibraryItems.filter((li) => li.mediaType === mediaType)
    },
    getAllLocalMediaProgress: async () => {
      calls.push({ method: 'getAllLocalMediaProgress' })
      return localMediaProgress
    },
    getLocalLibraryItem: async (id) => {
      calls.push({ method: 'getLocalLibraryItem', id })
      return localLibraryItems.find((li) => li.id === id) || null
    }
  }
}

/**
 * Stands in for `plugins/nativeHttp.js`.
 *
 * Defaults to **rejecting**. A test that forgets to queue a response therefore models the offline
 * case, which is the honest default here: an accidental success would silently turn an offline
 * test into an online one and it would still pass.
 *
 * `requests` is exposed so a test can assert whether a request was attempted at all - "did the
 * component even try to reach the server?" is a real contract, and is the difference between the
 * two paths that produce this bug.
 */
export function fakeNativeHttp({ responses = {}, rejectWith = new Error('offline') } = {}) {
  const requests = []
  // A queued array is consumed one entry per matching call, so a test can say "the first request
  // to this path succeeds and the second fails" - needed for two-library and retry flows.
  const queues = {}
  const respond = (method) => async (url, data, options) => {
    requests.push({ method, url, data, options })
    const match = Object.keys(responses).find((pattern) => url.includes(pattern))
    if (match === undefined) throw rejectWith
    let response = responses[match]
    if (Array.isArray(response)) {
      queues[match] = queues[match] ?? [...response]
      if (!queues[match].length) throw new Error(`[harness] no queued response left for ${url}`)
      response = queues[match].shift()
    }
    if (response instanceof Error) throw response
    return response
  }
  return {
    requests,
    get: respond('GET'),
    post: respond('POST'),
    patch: respond('PATCH'),
    delete: respond('DELETE')
  }
}

/**
 * A Vuex store with just enough of the real shape for the bookshelf components.
 *
 * The four inputs that decide every branch under test are [user], [networkConnected],
 * [currentLibraryId] and [localMediaProgress]; everything else is present so the component can
 * mount without exploding, and is not what any test is about.
 */
export function storeWith({
  user = null,
  networkConnected = false,
  currentLibraryId = 'lib-1',
  currentLibraryMediaType = 'book',
  localMediaProgress = [],
  userSettings = {},
  serverSettings = {},
  isPlayerOpen = false
} = {}) {
  const settings = {
    mobileOrderBy: 'media.metadata.title',
    mobileOrderDesc: false,
    mobileFilterBy: 'all',
    collapseSeries: false,
    collapseBookSeries: false,
    ...userSettings
  }

  return new Vuex.Store({
    state: {
      networkConnected,
      attemptingConnection: false,
      // Read directly by LazyBookshelf.init() to restore scroll position. Absent from the fake
      // store it throws inside init(), which would look like a defect in the component.
      lastBookshelfScrollData: {},
      showSideDrawer: false,
      processingBatch: null,
      isCasting: false,
      playerIsPlaying: false,
      playerIsStartingPlayback: false,
      playerStartingPlaybackMediaId: null,
      user: { user, settings, serverSettings: { version: '2.36.0', ...serverSettings }, serverConnectionConfig: null },
      libraries: { currentLibraryId, libraries: [] },
      globals: { localMediaProgress, bookshelfListView: false, isModalOpen: false }
    },
    getters: {
      getAltViewEnabled: () => false,
      getIsPlayerOpen: () => isPlayerOpen,
      getIsCurrentSessionLocal: () => false,
      getIsMediaStreaming: () => () => false,
      getServerSetting: () => (key) => serverSettings[key],
      'user/getUserSetting': () => (key) => settings[key],
      'user/getIsAdminOrUp': () => false,
      'user/getUserMediaProgress': () => () => null,
      'user/getUserCanDelete': () => false,
      'user/getUserCanDownload': () => false,
      'user/getUserCanUpdate': () => false,
      'libraries/getCurrentLibraryMediaType': () => currentLibraryMediaType,
      'libraries/getBookCoverAspectRatio': () => 1.6,
      'libraries/getCurrentLibraryName': () => 'Main',
      // Programmatically mounted book cards render once before setEntity supplies their item.
      // The real globals module always provides this getter, so keep the harness's store shape
      // honest enough for that initial render instead of relying on Vue to swallow the error.
      'globals/getLibraryItemCoverSrc': () => (_libraryItem, placeholderUrl) => placeholderUrl,
      'globals/getLocalMediaProgressById': (state) => (localLibraryItemId, episodeId) =>
        state.globals.localMediaProgress.find(
          (lmp) =>
            lmp.localLibraryItemId === localLibraryItemId &&
            (episodeId ? lmp.localEpisodeId === episodeId : !lmp.localEpisodeId)
        )
    },
    actions: {
      'user/updateUserSettings': () => Promise.resolve(),
      'globals/loadLocalMediaProgress': () => Promise.resolve()
    },
    mutations: {
      setShowSideDrawer: (state, val) => {
        state.showSideDrawer = val
      },
      setServerSettings: (state, settings) => {
        state.user.serverSettings = settings
      },
      // Committed by LazyBookshelf.beforeDestroy, but only when a `#bookshelf-wrapper` element
      // exists. Absent from the store, a spec that supplies that element - the one the shelf binds
      // its scroll listener to - dies on teardown with "unknown mutation type" instead of failing
      // on its own assertion. Performs the real store's write so a later read is honest.
      setLastBookshelfScrollData: (state, { scrollTop, path, name }) => {
        state.lastBookshelfScrollData[name] = { scrollTop, path }
      },
      'libraries/setCurrentLibrary': (state, id) => {
        state.libraries.currentLibraryId = id
      },
      'libraries/setEReaderDevices': (state, devices) => {
        state.libraries.ereaderDevices = devices
      },
      // The three a successful authentication commits. Present so a spec can follow a login all
      // the way to the redirect it ends with: Vuex rejects an unknown mutation type, so without
      // them the flow dies partway and a "did not navigate" assertion passes for the wrong reason.
      'user/setUser': (state, user) => {
        state.user.user = user
      },
      'user/setAccessToken': (state, token) => {
        state.user.accessToken = token
      },
      'user/setServerConnectionConfig': (state, config) => {
        state.user.serverConnectionConfig = config
      }
    }
  })
}

/**
 * Stands in for the socket.io client Nuxt injects as `$socket`.
 *
 * `LazyBookshelf.initListeners()` subscribes to `item_updated`/`item_added`/`item_removed` on it
 * unconditionally, including offline, so it has to exist for the component to mount at all.
 * Shares [fakeEventBus]'s implementation: a test can drive a server-push event through it, which
 * is the only way to exercise those handlers without a server.
 */
export function fakeSocket() {
  const bus = fakeEventBus()
  const connections = []
  // `connect` is what a successful authentication calls to open the session's socket. Recorded
  // rather than absent, so a spec can follow a login through to its end without the missing
  // method throwing halfway.
  return { ...bus, connections, connect: (address, token) => connections.push({ address, token }) }
}

/**
 * Records router navigation instead of performing it.
 *
 * Both methods are recorded rather than throwing, because "did not navigate" is as much a contract
 * here as "navigated to X" - #1335 is precisely a navigation that should *not* discard state, so a
 * throwing default would make the negative case unassertable.
 */
export function fakeRouter({ path = '/bookshelf/library', name = 'bookshelf-library', query = {} } = {}) {
  const navigations = []
  return {
    navigations,
    push: (to) => navigations.push({ method: 'push', to }),
    replace: (to) => navigations.push({ method: 'replace', to }),
    go: (n) => navigations.push({ method: 'go', to: n }),
    back: () => navigations.push({ method: 'back' }),
    currentRoute: { path, name, query }
  }
}

/**
 * Stands in for `plugins/localStore.js` (Capacitor Preferences).
 *
 * Backed by a real object so a write is observable by a later read, and every call is recorded -
 * "was the last library id cleared?" is the assertable half of a switch-server contract.
 */
export function fakeLocalStore({ lastLibraryId = null, userSettings = null, bookshelfListView = false } = {}) {
  const calls = []
  const store = { lastLibraryId, userSettings, bookshelfListView }
  return {
    calls,
    store,
    getLastLibraryId: async () => {
      calls.push({ method: 'getLastLibraryId' })
      return store.lastLibraryId
    },
    setLastLibraryId: async (id) => {
      calls.push({ method: 'setLastLibraryId', id })
      store.lastLibraryId = id
    },
    removeLastLibraryId: async () => {
      calls.push({ method: 'removeLastLibraryId' })
      store.lastLibraryId = null
    },
    getUserSettings: async () => {
      calls.push({ method: 'getUserSettings' })
      return store.userSettings
    },
    setUserSettings: async (settings) => {
      calls.push({ method: 'setUserSettings', settings })
      store.userSettings = { ...(store.userSettings || {}), ...settings }
    },
    getBookshelfListView: async () => {
      calls.push({ method: 'getBookshelfListView' })
      return store.bookshelfListView
    },
    setBookshelfListView: async (v) => {
      calls.push({ method: 'setBookshelfListView', v })
      store.bookshelfListView = v
    }
  }
}

/** A minimal event bus with the two methods the bookshelf components use, plus a record of emits. */
export function fakeEventBus() {
  const emitted = []
  const handlers = {}
  return {
    emitted,
    /**
     * Number of live subscribers for [event].
     *
     * Exists so "this component subscribes" and "this component cleans up" can be asserted
     * directly. Asserting them only through side effects is vacuous while the subscription does
     * not exist yet: a destroy test would pass because nothing happened either way.
     */
    listenerCount(event) {
      return (handlers[event] || []).length
    },
    $emit(event, ...args) {
      emitted.push({ event, args })
      ;(handlers[event] || []).forEach((h) => h(...args))
    },
    $on(event, handler) {
      handlers[event] = handlers[event] || []
      handlers[event].push(handler)
    },
    $off(event, handler) {
      if (!handlers[event]) return
      handlers[event] = handlers[event].filter((h) => h !== handler)
    }
  }
}

/**
 * Mounts [component] with the injected plugins Nuxt would normally provide.
 *
 * `$strings` returns the key itself rather than a translation. Tests assert on *which* string was
 * chosen, not on its English text - asserting the text would make every test a hostage of
 * `strings/en-us.json`.
 */
export function mountComponent(
  component,
  { store, db, nativeHttp, eventBus, socket, router, localStore, route, data, attachTo, propsData = {}, stubs = {}, platform = 'android' } = {}
) {
  const $store = store || storeWith()
  const $db = db || fakeDb()
  const $nativeHttp = nativeHttp || fakeNativeHttp()
  const $eventBus = eventBus || fakeEventBus()
  const $socket = socket || fakeSocket()
  const $router = router || fakeRouter()
  const $localStore = localStore || fakeLocalStore()
  const $route = route || { path: $router.currentRoute.path, name: $router.currentRoute.name, query: {}, fullPath: $router.currentRoute.path }
  const toasts = []

  // Nuxt pages get their initial state from asyncData, which @vue/test-utils does not run. `data`
  // lets a test supply that state directly, which is the only way to mount a detail page whose
  // subject (a collection, a playlist) normally arrives from the server before render.
  const componentUnderTest = data ? { ...component, data: () => ({ ...(component.data ? component.data() : {}), ...data }) } : component

  const wrapper = mount(componentUnderTest, {
    store: $store,
    // Off-document by default. Pass `attachTo: document.body` for a component that reaches the
    // real DOM - LazyBookshelf mounts its cards with document.getElementById('shelf-N'), and that
    // lookup silently returns null for a detached tree, so the card layer looks fine while
    // nothing renders.
    ...(attachTo ? { attachTo } : {}),
    propsData,
    stubs: {
      'ui-btn': true,
      'ui-loading-indicator': true,
      'widgets-loading-spinner': true,
      'bookshelf-shelf': true,
      ...stubs
    },
    mocks: {
      $db,
      $nativeHttp,
      $eventBus,
      $socket,
      $store,
      $platform: platform,
      $strings: new Proxy({}, { get: (_, key) => key }),
      $localStore,
      $router,
      $route,
      $showHideBookshelfToolbar: () => {},
      // Returns nothing in production too, so a no-op is faithful rather than an invented value.
      $setServerLanguageCode: () => {},
      $setBookshelfScrollPosition: () => {},
      $getBookshelfScrollPosition: () => 0,
      $hapticsImpact: async () => {},
      // Recorded rather than throwing: "the user was shown an error" is a contract several specs
      // assert, and a throwing default would turn that into an unhandled rejection instead.
      $toast: { error: (m) => toasts.push({ level: 'error', message: m }), success: (m) => toasts.push({ level: 'success', message: m }) },
      $config: { version: '0.0.0-test' },
      $formatNumber: (n) => String(n),
      $formatDate: (d) => String(d),
      // Mirrors plugins/i18n.js: returns the key so assertions stay independent of en-us.json,
      // and substitutes positionally when subs are supplied.
      $getString: (key, subs) => (Array.isArray(subs) && subs.length ? `${key}:${subs.join(',')}` : key),
      // Mirrors plugins/init.client.js's isValidVersion rather than answering a constant.
      // Components branch on it to decide whether a server speaks the new JWT auth, so a stub
      // pinned to true or false would pick those branches on the test's behalf.
      $isValidVersion: (currentVersion, minVersion) => {
        if (!currentVersion || !minVersion) return false
        const currentParts = currentVersion.split('.').map(Number)
        const minParts = minVersion.split('.').map(Number)
        for (let i = 0; i < minParts.length; i++) {
          if (currentParts[i] > minParts[i]) return true
          if (currentParts[i] < minParts[i]) return false
        }
        return true
      }
    }
  })

  return { wrapper, $store, $db, $nativeHttp, $eventBus, $socket, $router, $localStore, toasts }
}

/**
 * Replaces `LazyBookshelf.initSizeData()` with fixed dimensions.
 *
 * happy-dom reports every element as zero-sized, so the real measurement collapses `entitiesPerShelf`
 * to 1 and `shelvesPerPage` to 2 regardless of view mode - no card is ever asked to mount and a
 * render assertion passes whether or not the data arrived.
 *
 * **The one branch the stub must keep.** Production forces `entitiesPerShelf = 1` in list view
 * (`LazyBookshelf.vue:433`) and computes it from the measured width otherwise. Four specs previously
 * inlined this stub with a flat `entitiesPerShelf = 4`, which handed both view modes identical
 * geometry - deleting the only variable the row/grid parity defect lives in, while one of them set
 * `bookshelfListView = true` and then overrode the sizing that list view exists to change.
 *
 * A spec that is *about* geometry should not use this at all: define `clientWidth`/`clientHeight`
 * on the element and let the real method run. See `offline-library-parity.spec.js`.
 */
export function stubShelfGeometry(vm, { bookshelfWidth = 1000, bookshelfHeight = 800, entitiesPerShelf = 4, shelvesPerPage = 4 } = {}) {
  vm.initSizeData = function () {
    this.bookshelfWidth = bookshelfWidth
    this.bookshelfHeight = bookshelfHeight
    this.entitiesPerShelf = this.showBookshelfListView ? 1 : entitiesPerShelf
    this.shelvesPerPage = shelvesPerPage
    // Derived as production derives it, so a spec that changes the window size does not silently
    // keep fetching a page sized for the old one.
    this.booksPerFetch = Math.ceil((this.shelvesPerPage * this.entitiesPerShelf) / 20) * 20
    if (this.totalEntities) this.totalShelves = Math.ceil(this.totalEntities / this.entitiesPerShelf)
  }
  return vm
}

/** Flushes pending promise callbacks, then Vue's render queue. */
export async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Vue.nextTick()
}
