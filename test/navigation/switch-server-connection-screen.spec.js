import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocked at the module seam rather than through `fakeNativeHttp`: the ping that starts an
// auto-connect goes through `CapacitorHttp` directly, and that request is exactly what these
// specs are about - routing it through the harness's HTTP fake would hide it.
const capacitorHttpGet = vi.fn()
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn() } }))
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { get: (...a) => capacitorHttpGet(...a), post: vi.fn() } }))
vi.mock('@capacitor/dialog', () => ({ Dialog: { confirm: vi.fn(), alert: vi.fn() } }))

const ServerConnectForm = (await import('@/components/connection/ServerConnectForm.vue')).default
const { mountComponent, storeWith, fakeDb, fakeNativeHttp, fakeRouter, flush } = await import('../support/harness')

/**
 * Issue #1335, second half - the connection screen reconnects the server the user is leaving.
 *
 * The fix for #1335 stopped "Switch Server/User" from dispatching `user/logout`, so the session
 * survives a look at the connection screen (see switch-server-user.spec.js). It left the arrival
 * side untouched, and that is where the two halves collide.
 *
 * `ServerConnectForm.init()` ends with
 *
 *     if (this.lastServerConnectionConfig) { this.connectToServer(this.lastServerConnectionConfig) }
 *
 * and `connectToServer` finishes a successful authentication with `$router.replace('/bookshelf')`.
 * That auto-connect exists for app start, where it is the whole point: reopen the app, land back
 * on your shelf. Before the #1335 fix, `user/logout` had cleared `lastServerConnectionConfigId`,
 * so a switch arrived here with nothing to auto-connect to and the picker rendered.
 *
 * Now the session is deliberately intact, so `lastServerConnectionConfig` still names the server
 * the user just asked to switch away from. The screen re-authenticates against it and replaces
 * itself with /bookshelf before the user can touch anything - the picker is unreachable, and
 * choosing "Switch Server/User" looks like it does nothing at all. Reported as: logging out logs
 * you straight back in.
 *
 * The contract: arriving with `?switching` shows the server list. Arriving any other way - app
 * start, a redirect - must still auto-connect, so the specs for that are guards, not decoration.
 */

const homeServer = {
  id: 'srv-1',
  name: 'Home Server',
  address: 'https://abs.example.invalid',
  userId: 'u1',
  username: 'jane',
  token: 'tok',
  version: '2.36.0'
}

const otherServer = { ...homeServer, id: 'srv-2', name: 'Other Server', address: 'https://other.example.invalid' }

/** What `/api/authorize` returns for a still-valid stored token - the response that ends in /bookshelf. */
const authorizeResponse = {
  user: { id: 'u1', username: 'jane', token: 'server-side-token', librariesAccessible: [] },
  userDefaultLibraryId: 'lib-1',
  serverSettings: { version: '2.36.0', language: 'en-us' },
  ereaderDevices: []
}

/**
 * Mounts the connection screen as the app reaches it: a signed-in session whose last server
 * config is still on record, which is the state "Switch Server/User" now arrives in.
 *
 * The server answers everything an auto-connect asks for. That is the point: the bug is that the
 * screen *succeeds* at reconnecting, so a fake that failed anywhere along the way would make
 * every spec below pass without the fix.
 */
function mountForm({ query = {}, serverConnectionConfigs = [homeServer, otherServer], lastServerConnectionConfigId = 'srv-1' } = {}) {
  const store = storeWith({ user: { id: 'u1', username: 'jane' }, networkConnected: true })
  store.state.user.serverConnectionConfig = homeServer
  store.state.deviceData = { serverConnectionConfigs, lastServerConnectionConfigId, deviceSettings: {} }

  const db = {
    ...fakeDb(),
    // The Android cert lookup `connectToServer` performs before pinging. Answered explicitly so a
    // spec that reaches it fails on what it is asserting, not on an unstubbed bridge call.
    getClientCertificateAlias: async () => ({ alias: null }),
    setServerConnectionConfig: async (config) => ({ ...config })
  }

  const nativeHttp = fakeNativeHttp({ responses: { '/api/authorize': authorizeResponse } })
  const router = fakeRouter({ path: '/connect', name: 'connect', query })
  const route = { path: '/connect', name: 'connect', query, fullPath: '/connect' }

  return mountComponent(ServerConnectForm, { store, db, nativeHttp, router, route })
}

/** Did the screen try to reach a server on its own? The ping is the first thing an auto-connect does. */
const pinged = () => capacitorHttpGet.mock.calls.some((call) => String(call[0]?.url || '').includes('/ping'))

beforeEach(() => {
  capacitorHttpGet.mockReset()
  // A reachable server, so an auto-connect that starts would run on rather than stalling on a
  // network error and passing the specs below for the wrong reason. `url` is echoed back because
  // CapacitorHttp reports the *final* URL and validateLoginFormResponse compares hostnames with
  // it - omitting it makes the component fail on a missing field instead of on the redirect check.
  capacitorHttpGet.mockImplementation(async (options) => ({
    status: 200,
    url: options.url,
    data: { success: true, isInit: true, language: 'en-us', authMethods: ['local'] }
  }))
})

describe('#1335 the connection screen must not reconnect the server being switched away from', () => {
  it('does not ping the last server when arriving from Switch Server/User', async () => {
    mountForm({ query: { switching: '1' } })
    await flush()
    await flush()

    expect(pinged()).toBe(false)
  })

  it('does not replace itself with the bookshelf, which is the reported symptom', async () => {
    // "Logging out logs me straight back in": the screen re-authenticates and redirects before
    // the user can touch it, so the switch appears to do nothing.
    const { $router } = mountForm({ query: { switching: '1' } })
    await flush()
    await flush()

    expect($router.navigations).toEqual([])
  })

  it('leaves the existing session alone rather than re-authenticating it', async () => {
    const { $store } = mountForm({ query: { switching: '1' } })
    await flush()
    await flush()

    expect($store.state.user.serverConnectionConfig).toEqual(homeServer)
    expect($store.state.user.accessToken).toBeUndefined()
  })

  it('shows the server list rather than the address form', async () => {
    const { wrapper } = mountForm({ query: { switching: '1' } })
    await flush()

    expect(wrapper.vm.showForm).toBe(false)
  })

  it('still shows the address form when switching with no servers on record', async () => {
    // Nothing to pick from: the list would be an empty box with an "add server" button below it.
    const { wrapper } = mountForm({ query: { switching: '1' }, serverConnectionConfigs: [], lastServerConnectionConfigId: null })
    await flush()

    expect(wrapper.vm.showForm).toBe(true)
  })

  // --- Auto-connect on every other arrival: passes today, kept so a fix cannot break it --------

  it('still auto-connects to the last server on a normal arrival', async () => {
    mountForm({ query: {} })
    await flush()
    await flush()

    expect(pinged()).toBe(true)
  })

  it('still lands on the bookshelf on a normal arrival', async () => {
    // Also the proof that the fakes above can carry a login to completion, without which every
    // "did not navigate" assertion in this file would be vacuous.
    const { $router } = mountForm({ query: {} })
    await flush()
    await flush()

    expect($router.navigations).toContainEqual({ method: 'replace', to: '/bookshelf' })
  })

  it('still takes the forced re-login path when asked to', async () => {
    const { wrapper } = mountForm({ query: { serverConnectionConfigId: 'srv-1', error: 'refreshTokenFailed' } })
    await flush()

    expect(wrapper.vm.serverConfig.id).toBe('srv-1')
  })
})
