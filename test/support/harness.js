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
  const respond = (method) => async (url) => {
    requests.push({ method, url })
    const match = Object.keys(responses).find((pattern) => url.includes(pattern))
    if (match === undefined) throw rejectWith
    const response = responses[match]
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
  serverSettings = {}
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
      user: { user, settings },
      libraries: { currentLibraryId, libraries: [] },
      globals: { localMediaProgress, bookshelfListView: false, isModalOpen: false }
    },
    getters: {
      getAltViewEnabled: () => false,
      getServerSetting: () => (key) => serverSettings[key],
      'user/getUserSetting': () => (key) => settings[key],
      'user/getIsAdminOrUp': () => false,
      'libraries/getCurrentLibraryMediaType': () => currentLibraryMediaType,
      'libraries/getBookCoverAspectRatio': () => 1.6,
      'libraries/getCurrentLibraryName': () => 'Main',
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
      'libraries/setCurrentLibrary': (state, id) => {
        state.libraries.currentLibraryId = id
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
  return fakeEventBus()
}

/** A minimal event bus with the two methods the bookshelf components use, plus a record of emits. */
export function fakeEventBus() {
  const emitted = []
  const handlers = {}
  return {
    emitted,
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
export function mountComponent(component, { store, db, nativeHttp, eventBus, socket, propsData = {}, stubs = {}, platform = 'android' } = {}) {
  const $store = store || storeWith()
  const $db = db || fakeDb()
  const $nativeHttp = nativeHttp || fakeNativeHttp()
  const $eventBus = eventBus || fakeEventBus()
  const $socket = socket || fakeSocket()

  const wrapper = mount(component, {
    store: $store,
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
      $localStore: {
        getLastLibraryId: notStubbed('$localStore.getLastLibraryId'),
        setUserSettings: async () => {}
      },
      $showHideBookshelfToolbar: () => {},
      $setBookshelfScrollPosition: () => {},
      $getBookshelfScrollPosition: () => 0,
      $toast: { error: notStubbed('$toast.error'), success: notStubbed('$toast.success') },
      $router: { push: notStubbed('$router.push') },
      $route: { query: {}, fullPath: '/bookshelf/library' }
    }
  })

  return { wrapper, $store, $db, $nativeHttp, $eventBus, $socket }
}

/** Flushes pending promise callbacks, then Vue's render queue. */
export async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Vue.nextTick()
}
