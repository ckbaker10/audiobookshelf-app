import { describe, it, expect, vi, beforeEach } from 'vitest'

const capacitorHttpPost = vi.fn()
vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { post: (...a) => capacitorHttpPost(...a), get: vi.fn() },
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
  registerPlugin: () => ({})
}))
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn() } }))
vi.mock('@/plugins/capacitor', () => ({ AbsLogger: { info: vi.fn(), error: vi.fn() } }))

const { state: userState, getters: userGetters, actions, mutations } = await import('@/store/user')

/**
 * `store/user.js` actions, getters and mutations.
 *
 * These decide what survives a logout, which sort/filter a library switch is allowed to keep, and
 * whether a token refresh leaves the session usable. The Android suite covers the *native* half of
 * token refresh (`ApiHandlerCredentialTest`); this is the JavaScript half, which has its own
 * refresh path through `CapacitorHttp` and no coverage at all.
 *
 * Actions are invoked directly with a hand-built context rather than through a live store: they are
 * plain functions of `({ state, commit, dispatch, getters })`, and calling them that way makes each
 * branch reachable and every commit observable.
 *
 * `this` inside these actions is the Nuxt root, which is where `$db`, `$localStore`, `$eventBus`,
 * `$socket` and `$nativeHttp` live - so they are supplied via `.call(root, ctx, payload)`.
 */

/** The Nuxt root the actions reach through `this`. */
function nuxtRoot({ refreshToken = 'refresh-tok', savedConfig, socket } = {}) {
  const events = []
  const localStoreWrites = []
  return {
    events,
    localStoreWrites,
    $db: {
      getRefreshToken: vi.fn(async () => refreshToken),
      setServerConnectionConfig: vi.fn(async (config) => savedConfig ?? config),
      logout: vi.fn(async () => {})
    },
    $localStore: {
      setUserSettings: vi.fn(async (s) => localStoreWrites.push(s)),
      getUserSettings: vi.fn(async () => null),
      removeLastLibraryId: vi.fn(async () => {})
    },
    $eventBus: { $emit: (event, ...args) => events.push({ event, args }) },
    $socket: socket ?? { connected: false, isAuthenticated: false, sendAuthenticate: vi.fn(), logout: vi.fn() },
    $nativeHttp: { post: vi.fn(async () => ({})) }
  }
}

const freshState = () => userState()

beforeEach(() => {
  capacitorHttpPost.mockReset()
})

describe('checkUpdateLibrarySortFilter', () => {
  /** Runs the action and returns whatever it asked `updateUserSettings` to change. */
  function run(settings, mediaType) {
    const state = { ...freshState(), settings: { ...freshState().settings, ...settings } }
    const dispatched = []
    actions.checkUpdateLibrarySortFilter.call(nuxtRoot(), { state, dispatch: (type, payload) => dispatched.push({ type, payload }), commit: () => {} }, mediaType)
    return dispatched.find((d) => d.type === 'updateUserSettings')?.payload
  }

  it('maps book-only sorts onto their podcast equivalents', () => {
    expect(run({ mobileOrderBy: 'media.metadata.authorName' }, 'podcast').mobileOrderBy).toBe('media.metadata.author')
    expect(run({ mobileOrderBy: 'media.metadata.authorNameLF' }, 'podcast').mobileOrderBy).toBe('media.metadata.author')
    expect(run({ mobileOrderBy: 'media.duration' }, 'podcast').mobileOrderBy).toBe('media.numTracks')
    expect(run({ mobileOrderBy: 'media.metadata.publishedYear' }, 'podcast').mobileOrderBy).toBe('media.metadata.title')
  })

  it('maps podcast-only sorts back when switching to a book library', () => {
    expect(run({ mobileOrderBy: 'media.metadata.author' }, 'book').mobileOrderBy).toBe('media.metadata.authorName')
    expect(run({ mobileOrderBy: 'media.numTracks' }, 'book').mobileOrderBy).toBe('media.duration')
  })

  it('resets a filter a podcast library cannot honour', () => {
    // The filter is stored as "series.<base64>", so only the first part is meaningful.
    expect(run({ mobileFilterBy: 'series.abc123' }, 'podcast').mobileFilterBy).toBe('all')
    expect(run({ mobileFilterBy: 'authors.abc123' }, 'podcast').mobileFilterBy).toBe('all')
    expect(run({ mobileFilterBy: 'progress.finished' }, 'podcast').mobileFilterBy).toBe('all')
    expect(run({ mobileFilterBy: 'issues' }, 'podcast').mobileFilterBy).toBe('all')
  })

  it('keeps a filter a podcast library can honour', () => {
    expect(run({ mobileFilterBy: 'all' }, 'podcast')).toBeUndefined()
    expect(run({ mobileFilterBy: 'tags.abc' }, 'podcast')).toBeUndefined()
  })

  it('dispatches nothing when the current sort and filter are already valid', () => {
    expect(run({ mobileOrderBy: 'addedAt', mobileFilterBy: 'all' }, 'book')).toBeUndefined()
    expect(run({ mobileOrderBy: 'addedAt', mobileFilterBy: 'all' }, 'podcast')).toBeUndefined()
  })

  /**
   * Characterization. Switching to a **book** library does not validate the filter at all - only
   * the sort is remapped. A podcast-specific filter therefore survives into a book library.
   *
   * In practice the invalid-filter list is book-shaped (series, authors, narrators), so there is
   * no known podcast filter that breaks a book library. Pinned because the asymmetry is invisible
   * from the code and a future podcast-only filter would inherit no protection.
   */
  it('does not validate the filter when switching to a book library (characterization)', () => {
    expect(run({ mobileFilterBy: 'series.abc123' }, 'book')).toBeUndefined()
  })
})

describe('updateUserSettings', () => {
  async function run(existing, payload) {
    const state = { ...freshState(), settings: { ...freshState().settings, ...existing } }
    const commits = []
    const root = nuxtRoot()
    await actions.updateUserSettings.call(root, { state, commit: (type, p) => commits.push({ type, payload: p }) }, payload)
    return { commits, root, state }
  }

  it('commits and persists a changed setting, and announces it once', async () => {
    const { commits, root } = await run({ mobileOrderBy: 'addedAt' }, { mobileOrderBy: 'media.metadata.title' })

    expect(commits).toHaveLength(1)
    expect(commits[0].payload.mobileOrderBy).toBe('media.metadata.title')
    expect(root.localStoreWrites).toHaveLength(1)
    expect(root.events.filter((e) => e.event === 'user-settings')).toHaveLength(1)
  })

  it('does nothing when the value is unchanged', async () => {
    const { commits, root } = await run({ mobileOrderBy: 'addedAt' }, { mobileOrderBy: 'addedAt' })

    expect(commits).toEqual([])
    expect(root.localStoreWrites).toEqual([])
    expect(root.events).toEqual([])
  })

  it('returns false for a missing payload rather than writing anything', async () => {
    const state = freshState()
    const root = nuxtRoot()
    const result = await actions.updateUserSettings.call(root, { state, commit: () => {} }, null)

    expect(result).toBe(false)
    expect(root.localStoreWrites).toEqual([])
  })

  it('applies several changed keys in one write', async () => {
    const { commits, root } = await run(
      { mobileOrderBy: 'addedAt', mobileOrderDesc: true },
      { mobileOrderBy: 'media.duration', mobileOrderDesc: false }
    )

    expect(commits[0].payload.mobileOrderBy).toBe('media.duration')
    expect(commits[0].payload.mobileOrderDesc).toBe(false)
    expect(root.localStoreWrites).toHaveLength(1)
  })

  /**
   * Characterization, and a real constraint on callers. The loop iterates the *existing* settings
   * keys, so a key that is not already in the defaults is silently dropped - it is never committed
   * and never persisted, with no error.
   *
   * Any new setting therefore has to be added to `state.settings`'s defaults before it can be
   * stored at all, which is easy to miss when adding a feature.
   */
  it('silently ignores a key that is not already a known setting (characterization)', async () => {
    const { commits, root } = await run({}, { someBrandNewSetting: true })

    expect(commits).toEqual([])
    expect(root.localStoreWrites).toEqual([])
  })
})

describe('loadUserSettings', () => {
  async function run(stored) {
    const state = freshState()
    const commits = []
    const root = nuxtRoot()
    root.$localStore.getUserSettings = vi.fn(async () => stored)
    await actions.loadUserSettings.call(root, { state, commit: (type, p) => commits.push({ type, payload: p }) })
    return { commits, root }
  }

  it('restores stored settings over the defaults and announces once', async () => {
    const { commits, root } = await run({ mobileOrderBy: 'media.duration', mobileOrderDesc: false })

    expect(commits[0].payload.mobileOrderBy).toBe('media.duration')
    expect(commits[0].payload.mobileOrderDesc).toBe(false)
    expect(root.events.filter((e) => e.event === 'user-settings')).toHaveLength(1)
  })

  it('keeps the default for any key the stored settings omit', async () => {
    const { commits } = await run({ mobileOrderBy: 'media.duration' })

    expect(commits[0].payload.mobileFilterBy).toBe('all')
    expect(commits[0].payload.playbackRate).toBe(1)
  })

  it('does nothing when nothing has been stored yet', async () => {
    const { commits, root } = await run(null)

    expect(commits).toEqual([])
    expect(root.events).toEqual([])
  })

  it('ignores stored keys that are not known settings', async () => {
    const { commits } = await run({ mobileOrderBy: 'media.duration', removedInAnOldVersion: 'x' })

    expect(commits[0].payload.removedInAnOldVersion).toBeUndefined()
  })
})

describe('refreshToken', () => {
  const context = (over = {}) => ({
    state: { ...freshState(), serverConnectionConfig: { id: 'srv-1', address: 'https://abs.example.invalid', token: 'old-tok' } },
    commit: over.commit || (() => {}),
    getters: {
      getServerConnectionConfigId: 'srv-1',
      getServerAddress: 'https://abs.example.invalid'
    }
  })

  it('posts the stored refresh token to the refresh endpoint', async () => {
    capacitorHttpPost.mockResolvedValue({ status: 200, data: { user: { accessToken: 'new-tok', refreshToken: 'new-refresh' } } })
    const root = nuxtRoot({ refreshToken: 'stored-refresh' })

    await actions.refreshToken.call(root, context())

    const request = capacitorHttpPost.mock.calls[0][0]
    expect(request.url).toBe('https://abs.example.invalid/auth/refresh')
    expect(request.headers['x-refresh-token']).toBe('stored-refresh')
  })

  it('returns the new access token and commits it', async () => {
    capacitorHttpPost.mockResolvedValue({ status: 200, data: { user: { accessToken: 'new-tok', refreshToken: 'new-refresh' } } })
    const commits = []
    const root = nuxtRoot()

    const result = await actions.refreshToken.call(root, context({ commit: (type, p) => commits.push({ type, payload: p }) }))

    expect(result).toBe('new-tok')
    expect(commits).toContainEqual({ type: 'setAccessToken', payload: 'new-tok' })
  })

  it('persists the refreshed config so the new refresh token survives a restart', async () => {
    capacitorHttpPost.mockResolvedValue({ status: 200, data: { user: { accessToken: 'new-tok', refreshToken: 'new-refresh' } } })
    const root = nuxtRoot()

    await actions.refreshToken.call(root, context())

    const saved = root.$db.setServerConnectionConfig.mock.calls[0][0]
    expect(saved.token).toBe('new-tok')
    expect(saved.refreshToken).toBe('new-refresh')
  })

  it('returns null without contacting the server when nothing is stored', async () => {
    const root = nuxtRoot({ refreshToken: null })

    const result = await actions.refreshToken.call(root, context())

    expect(result).toBeNull()
    expect(capacitorHttpPost).not.toHaveBeenCalled()
  })

  it('returns null on a non-200 response and does not touch the stored config', async () => {
    capacitorHttpPost.mockResolvedValue({ status: 401, data: {} })
    const root = nuxtRoot()

    const result = await actions.refreshToken.call(root, context())

    expect(result).toBeNull()
    expect(root.$db.setServerConnectionConfig).not.toHaveBeenCalled()
  })

  it('returns null when a 200 response carries no access token', async () => {
    // A malformed success is not a success: the old token must not be replaced by nothing.
    capacitorHttpPost.mockResolvedValue({ status: 200, data: { user: {} } })
    const commits = []
    const root = nuxtRoot()

    const result = await actions.refreshToken.call(root, context({ commit: (type, p) => commits.push({ type, payload: p }) }))

    expect(result).toBeNull()
    expect(commits).toEqual([])
  })

  it('re-authenticates the socket when it is connected but unauthenticated', async () => {
    capacitorHttpPost.mockResolvedValue({ status: 200, data: { user: { accessToken: 'new-tok' } } })
    const socket = { connected: true, isAuthenticated: false, sendAuthenticate: vi.fn(), logout: vi.fn() }
    const root = nuxtRoot({ socket })

    await actions.refreshToken.call(root, context())

    expect(socket.sendAuthenticate).toHaveBeenCalledTimes(1)
  })

  it('does not re-authenticate a socket that is already authenticated', async () => {
    capacitorHttpPost.mockResolvedValue({ status: 200, data: { user: { accessToken: 'new-tok' } } })
    const socket = { connected: true, isAuthenticated: true, sendAuthenticate: vi.fn(), logout: vi.fn() }
    const root = nuxtRoot({ socket })

    await actions.refreshToken.call(root, context())

    expect(socket.sendAuthenticate).not.toHaveBeenCalled()
  })

  /**
   * Characterization of an unguarded failure mode. `CapacitorHttp.post` rejects on a transport
   * error - no network, DNS failure, TLS refusal - and nothing here catches it, so the rejection
   * propagates to whichever caller triggered the refresh.
   *
   * That is arguably right (the caller must know the refresh failed) but it is a *different*
   * outcome from every other failure path in this action, which all return `null`. A caller
   * written against the `null` contract will not be expecting a throw.
   */
  it('propagates a transport failure rather than returning null (characterization)', async () => {
    capacitorHttpPost.mockRejectedValue(new Error('Network request failed'))
    const root = nuxtRoot()

    await expect(actions.refreshToken.call(root, context())).rejects.toThrow('Network request failed')
  })
})

describe('mutations', () => {
  it('logout clears the user and access token', () => {
    const state = { ...freshState(), user: { id: 'u1' }, accessToken: 'tok' }

    mutations.logout(state)

    expect(state.user).toBeNull()
    expect(state.accessToken).toBeNull()
  })

  it('updateUserMediaProgress replaces a matching record in place', () => {
    const state = { user: { mediaProgress: [{ id: 'p1', currentTime: 10 }] } }

    mutations.updateUserMediaProgress(state, { id: 'p1', currentTime: 99 })

    expect(state.user.mediaProgress).toEqual([{ id: 'p1', currentTime: 99 }])
  })

  it('updateUserMediaProgress appends an unknown record', () => {
    const state = { user: { mediaProgress: [{ id: 'p1', currentTime: 10 }] } }

    mutations.updateUserMediaProgress(state, { id: 'p2', currentTime: 5 })

    expect(state.user.mediaProgress).toHaveLength(2)
  })

  it('updateUserMediaProgress is a no-op without a user or without data', () => {
    const noUser = { user: null }
    mutations.updateUserMediaProgress(noUser, { id: 'p1' })
    expect(noUser.user).toBeNull()

    const state = { user: { mediaProgress: [] } }
    mutations.updateUserMediaProgress(state, null)
    expect(state.user.mediaProgress).toEqual([])
  })

  it('removeMediaProgress drops only the matching record', () => {
    const state = { user: { mediaProgress: [{ id: 'p1' }, { id: 'p2' }] } }

    mutations.removeMediaProgress(state, 'p1')

    expect(state.user.mediaProgress).toEqual([{ id: 'p2' }])
  })

  it('setSettings ignores a nullish payload rather than blanking the settings', () => {
    const state = { settings: { mobileOrderBy: 'addedAt' } }

    mutations.setSettings(state, null)

    expect(state.settings).toEqual({ mobileOrderBy: 'addedAt' })
  })

  it('updateBookmark replaces the bookmark matching item and time', () => {
    const state = { user: { bookmarks: [{ libraryItemId: 'li-1', time: 10, title: 'Old' }] } }

    mutations.updateBookmark(state, { libraryItemId: 'li-1', time: 10, title: 'New' })

    expect(state.user.bookmarks[0].title).toBe('New')
  })

  it('updateBookmark leaves a bookmark at a different time alone', () => {
    const state = { user: { bookmarks: [{ libraryItemId: 'li-1', time: 10, title: 'Old' }] } }

    mutations.updateBookmark(state, { libraryItemId: 'li-1', time: 20, title: 'New' })

    expect(state.user.bookmarks[0].title).toBe('Old')
  })

  it('deleteBookmark removes only the exact item and time', () => {
    const state = {
      user: {
        bookmarks: [
          { libraryItemId: 'li-1', time: 10 },
          { libraryItemId: 'li-1', time: 20 },
          { libraryItemId: 'li-2', time: 10 }
        ]
      }
    }

    mutations.deleteBookmark(state, { libraryItemId: 'li-1', time: 10 })

    expect(state.user.bookmarks).toEqual([
      { libraryItemId: 'li-1', time: 20 },
      { libraryItemId: 'li-2', time: 10 }
    ])
  })

  it('bookmark mutations are no-ops when the user has no bookmarks', () => {
    const state = { user: { id: 'u1' } }

    mutations.updateBookmark(state, { libraryItemId: 'li-1', time: 10 })
    mutations.deleteBookmark(state, { libraryItemId: 'li-1', time: 10 })

    expect(state.user.bookmarks).toBeUndefined()
  })
})

describe('getters', () => {
  it('getIsRoot and getIsAdminOrUp reflect the user type', () => {
    expect(userGetters.getIsRoot({ user: { type: 'root' } })).toBe(true)
    expect(userGetters.getIsRoot({ user: { type: 'admin' } })).toBe(false)
    expect(userGetters.getIsAdminOrUp({ user: { type: 'admin' } })).toBe(true)
    expect(userGetters.getIsAdminOrUp({ user: { type: 'root' } })).toBe(true)
    expect(userGetters.getIsAdminOrUp({ user: { type: 'user' } })).toBe(false)
  })

  it('permission getters are false rather than undefined when logged out', () => {
    expect(userGetters.getUserCanDownload({ user: null })).toBe(false)
    expect(userGetters.getUserCanAccessExplicitContent({ user: null })).toBe(false)
  })

  it('permission getters read the permissions object', () => {
    const state = { user: { permissions: { download: true, accessExplicitContent: false } } }

    expect(userGetters.getUserCanDownload(state)).toBe(true)
    expect(userGetters.getUserCanAccessExplicitContent(state)).toBe(false)
  })
})
