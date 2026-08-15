import { describe, it, expect, beforeAll } from 'vitest'
import { loadInitPluginHelpers } from '../support/initPlugin'
import { getters as libraryGetters } from '@/store/libraries'
import { getters as globalGetters } from '@/store/globals'

/**
 * Pure getters from `store/libraries.js` and `store/globals.js`.
 *
 * Called directly rather than through a mounted store: they are plain functions of `(state,
 * getters)`, and invoking them that way makes each branch reachable without building a component
 * around it. Everything here decides what the shelf shows, which cover URL is requested, and which
 * progress record a card displays.
 *
 * `isValidVersion` is included because it gates feature availability against the server version
 * and has no coverage.
 */

const library = (over = {}) => ({
  id: 'lib-1',
  name: 'Main',
  mediaType: 'book',
  settings: { coverAspectRatio: 1, audiobooksOnly: false },
  ...over
})

/** Resolves the getter chain the way Vuex does, so dependent getters see each other. */
function resolve(state) {
  const g = {}
  Object.keys(libraryGetters).forEach((key) => {
    Object.defineProperty(g, key, { get: () => libraryGetters[key](state, g), enumerable: true })
  })
  return g
}

describe('store/libraries getters', () => {
  it('resolves the current library by id', () => {
    const g = resolve({ libraries: [library(), library({ id: 'lib-2', name: 'Podcasts' })], currentLibraryId: 'lib-2' })

    expect(g.getCurrentLibrary.name).toBe('Podcasts')
    expect(g.getCurrentLibraryName).toBe('Podcasts')
  })

  it('reports null rather than throwing when the current library id matches nothing', () => {
    // The offline/just-logged-out shape: an id is remembered but the list has not loaded.
    const g = resolve({ libraries: [], currentLibraryId: 'lib-1' })

    expect(g.getCurrentLibrary).toBeUndefined()
    expect(g.getCurrentLibraryName).toBeNull()
    expect(g.getCurrentLibraryMediaType).toBeNull()
    expect(g.getCurrentLibrarySettings).toBeNull()
  })

  it('reports null when no library is selected at all', () => {
    const g = resolve({ libraries: [library()], currentLibraryId: null })

    expect(g.getCurrentLibraryName).toBeNull()
  })

  describe('getBookCoverAspectRatio', () => {
    it('is 1.6 for the standard ratio and 1 for square', () => {
      // The enum reads STANDARD: 0, SQUARE: 1 - the setting is a *mode*, not the ratio itself, so
      // the numbers are the opposite way round from what the returned values suggest.
      expect(resolve({ libraries: [library({ settings: { coverAspectRatio: 0 } })], currentLibraryId: 'lib-1' }).getBookCoverAspectRatio).toBe(1.6)
      expect(resolve({ libraries: [library({ settings: { coverAspectRatio: 1 } })], currentLibraryId: 'lib-1' }).getBookCoverAspectRatio).toBe(1)
    })

    it('falls back to 1 when there is no library, no settings, or a non-numeric ratio', () => {
      expect(resolve({ libraries: [], currentLibraryId: 'lib-1' }).getBookCoverAspectRatio).toBe(1)
      expect(resolve({ libraries: [library({ settings: null })], currentLibraryId: 'lib-1' }).getBookCoverAspectRatio).toBe(1)
      expect(resolve({ libraries: [library({ settings: { coverAspectRatio: 'wide' } })], currentLibraryId: 'lib-1' }).getBookCoverAspectRatio).toBe(1)
    })

    /**
     * Characterization. `isNaN(undefined)` is true, so a missing ratio falls back to square (1)
     * rather than to standard (1.6). Worth knowing because STANDARD is the enum's zero value and
     * the default for a fresh server library, so the fallback is the *less* likely shape - it is
     * reached whenever settings arrive without that key.
     */
    it('falls back to square, not standard, when the ratio key is absent (characterization)', () => {
      const g = resolve({ libraries: [library({ settings: {} })], currentLibraryId: 'lib-1' })

      expect(g.getBookCoverAspectRatio).toBe(1)
    })
  })

  it('getLibraryIsAudiobooksOnly is a boolean even when settings are missing', () => {
    expect(resolve({ libraries: [library({ settings: { audiobooksOnly: true } })], currentLibraryId: 'lib-1' }).getLibraryIsAudiobooksOnly).toBe(true)
    expect(resolve({ libraries: [], currentLibraryId: 'lib-1' }).getLibraryIsAudiobooksOnly).toBe(false)
    expect(resolve({ libraries: [library({ settings: null })], currentLibraryId: 'lib-1' }).getLibraryIsAudiobooksOnly).toBe(false)
  })
})

describe('store/globals getLocalMediaProgressById', () => {
  const state = {
    localMediaProgress: [
      { id: 'p1', localLibraryItemId: 'local-1', localEpisodeId: null, progress: 0.25 },
      { id: 'p2', localLibraryItemId: 'local-1', localEpisodeId: 'ep-1', progress: 0.5 },
      { id: 'p3', localLibraryItemId: 'local-1', localEpisodeId: 'ep-2', progress: 0.75 }
    ]
  }

  it('finds a book record by item id', () => {
    expect(globalGetters.getLocalMediaProgressById(state)('local-1').progress).toBe(0.25)
  })

  it('finds an episode record by item and episode id', () => {
    expect(globalGetters.getLocalMediaProgressById(state)('local-1', 'ep-2').progress).toBe(0.75)
  })

  it('does not return an episode record when asked for the book', () => {
    // The distinction that keeps one podcast episode from showing another's position.
    expect(globalGetters.getLocalMediaProgressById(state)('local-1').localEpisodeId).toBeNull()
  })

  it('misses cleanly for an unknown item or episode', () => {
    expect(globalGetters.getLocalMediaProgressById(state)('local-missing')).toBeUndefined()
    expect(globalGetters.getLocalMediaProgressById(state)('local-1', 'ep-missing')).toBeUndefined()
  })

  it('misses cleanly when nothing is stored', () => {
    expect(globalGetters.getLocalMediaProgressById({ localMediaProgress: [] })('local-1')).toBeUndefined()
  })
})

describe('isValidVersion', () => {
  let isValidVersion
  beforeAll(async () => {
    const helpers = await loadInitPluginHelpers()
    // Injected by the plugin's default export rather than hung on the prototype, so it is read
    // back through the same injection Nuxt performs.
    const injected = {}
    const plugin = (await import('@/plugins/init.client.js')).default
    plugin({ store: { commit() {}, state: {} }, app: {} }, (name, value) => {
      injected[name] = value
    })
    isValidVersion = injected.isValidVersion
    expect(typeof isValidVersion).toBe('function')
    void helpers
  })

  it('accepts an equal version', () => {
    expect(isValidVersion('2.17.0', '2.17.0')).toBe(true)
  })

  it('accepts a greater major, minor or patch', () => {
    expect(isValidVersion('3.0.0', '2.17.0')).toBe(true)
    expect(isValidVersion('2.18.0', '2.17.0')).toBe(true)
    expect(isValidVersion('2.17.1', '2.17.0')).toBe(true)
  })

  it('rejects a lesser major, minor or patch', () => {
    expect(isValidVersion('1.99.99', '2.0.0')).toBe(false)
    expect(isValidVersion('2.16.9', '2.17.0')).toBe(false)
    expect(isValidVersion('2.17.0', '2.17.1')).toBe(false)
  })

  it('compares numerically rather than lexicographically', () => {
    // The classic: "2.9.0" > "2.10.0" as strings.
    expect(isValidVersion('2.10.0', '2.9.0')).toBe(true)
    expect(isValidVersion('2.9.0', '2.10.0')).toBe(false)
  })

  it('rejects a missing version on either side', () => {
    expect(isValidVersion('', '2.0.0')).toBe(false)
    expect(isValidVersion('2.0.0', '')).toBe(false)
    expect(isValidVersion(null, '2.0.0')).toBe(false)
    expect(isValidVersion('2.0.0', null)).toBe(false)
  })

  /**
   * Characterization of two inputs the doc comment excludes ("Only supports 3 part versions") but
   * which the app can genuinely receive, since `serverSettings.version` is whatever the server
   * reports.
   *
   * A prerelease suffix makes that component `NaN`, and every `NaN` comparison is false, so the
   * loop falls through to its `return true` - "2.17.0-beta" satisfies a "2.17.1" gate it does not
   * actually meet. A short version behaves the same way once it runs out of components.
   *
   * Pinned rather than enabled as a failure: the Android client's equivalent
   * (`DeviceManager.isServerVersionGreaterThanOrEqualTo`) makes the same choice, and changing one
   * without the other would put the two clients out of step.
   */
  it('treats an unparseable component as satisfying the gate (characterization)', () => {
    expect(isValidVersion('2.17.0-beta', '2.17.1')).toBe(true)
    expect(isValidVersion('2.17', '2.17.1')).toBe(true)
  })
})
