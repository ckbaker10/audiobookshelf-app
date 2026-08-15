import { describe, it, expect, vi, beforeEach } from 'vitest'

const capacitorRequest = vi.fn()
const capacitorPost = vi.fn()
vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { request: (...a) => capacitorRequest(...a), post: (...a) => capacitorPost(...a) },
  Capacitor: { getPlatform: () => 'web' },
  registerPlugin: () => ({})
}))

const nativeHttpPlugin = (await import('@/plugins/nativeHttp')).default

/**
 * `plugins/nativeHttp.js` - request construction, and the 401 -> refresh -> retry path.
 *
 * This is the JavaScript half of token handling. The Android suite covers the *native*
 * `ApiHandler` equivalent (`ApiHandlerCredentialTest`), but this plugin has its own independent
 * refresh implementation that every Vue-side request goes through, and it had no coverage.
 *
 * The plugin is a Nuxt injector, so it is instantiated directly with fake `store`/`$db`/`$socket`
 * and the injected object is captured. `CapacitorHttp` is mocked at the module seam - routing it
 * through a harness HTTP fake would replace the code under test.
 */

function buildNativeHttp({ token = 'access-tok', serverConnectionConfig = { id: 'srv-1', address: 'https://abs.example.invalid' }, refreshToken = 'refresh-tok' } = {}) {
  const dispatched = []
  const store = {
    state: { user: { serverConnectionConfig } },
    getters: { 'user/getToken': token },
    dispatch: async (type, payload) => {
      dispatched.push({ type, payload })
    },
    commit: vi.fn()
  }
  const $db = {
    getRefreshToken: vi.fn(async () => refreshToken),
    setServerConnectionConfig: vi.fn(async (c) => c),
    clearRefreshToken: vi.fn(async () => {})
  }
  const $socket = { connected: false, isAuthenticated: false, sendAuthenticate: vi.fn() }

  let injected
  nativeHttpPlugin({ store, $db, $socket }, (name, value) => {
    injected = value
  })
  return { nativeHttp: injected, store, $db, $socket, dispatched }
}

const ok = (data) => ({ status: 200, data })

beforeEach(() => {
  capacitorRequest.mockReset()
  capacitorPost.mockReset()
  // handleRefreshFailure assigns window.location.href. happy-dom treats that as a navigation, so
  // it is replaced with a plain recordable object for the duration of the suite.
  delete window.location
  window.location = { pathname: '/bookshelf', href: '' }
})

describe('request construction', () => {
  it('prefixes a relative url with the server address and attaches the bearer token', async () => {
    capacitorRequest.mockResolvedValue(ok({ id: 'u1' }))
    const { nativeHttp } = buildNativeHttp()

    await nativeHttp.get('/api/me')

    const req = capacitorRequest.mock.calls[0][0]
    expect(req.url).toBe('https://abs.example.invalid/api/me')
    expect(req.headers.Authorization).toBe('Bearer access-tok')
    expect(req.method).toBe('GET')
  })

  it('leaves an absolute url alone and does not attach a token to it', async () => {
    capacitorRequest.mockResolvedValue(ok({}))
    const { nativeHttp } = buildNativeHttp()

    await nativeHttp.get('https://elsewhere.example.invalid/thing')

    const req = capacitorRequest.mock.calls[0][0]
    expect(req.url).toBe('https://elsewhere.example.invalid/thing')
    expect(req.headers.Authorization).toBeUndefined()
  })

  it('sets a json content type only when there is a body', async () => {
    capacitorRequest.mockResolvedValue(ok({}))
    const { nativeHttp } = buildNativeHttp()

    await nativeHttp.post('/api/thing', { a: 1 })
    expect(capacitorRequest.mock.calls[0][0].headers['Content-Type']).toBe('application/json')

    capacitorRequest.mockClear()
    await nativeHttp.get('/api/thing')
    expect(capacitorRequest.mock.calls[0][0].headers['Content-Type']).toBeUndefined()
  })

  it('lets caller headers override the defaults', async () => {
    capacitorRequest.mockResolvedValue(ok({}))
    const { nativeHttp } = buildNativeHttp()

    await nativeHttp.get('/api/me', { headers: { Authorization: 'Bearer override', 'X-Custom': 'yes' } })

    const req = capacitorRequest.mock.calls[0][0]
    expect(req.headers.Authorization).toBe('Bearer override')
    expect(req.headers['X-Custom']).toBe('yes')
  })

  it('does not forward the headers option as a request option', async () => {
    capacitorRequest.mockResolvedValue(ok({}))
    const { nativeHttp } = buildNativeHttp()

    await nativeHttp.get('/api/me', { headers: { 'X-Custom': 'yes' }, connectTimeout: 5000 })

    const req = capacitorRequest.mock.calls[0][0]
    expect(req.connectTimeout).toBe(5000)
    expect(req.headers['X-Custom']).toBe('yes')
  })

  it('uses a server connection config passed as an option, before one is in the store', async () => {
    // The login path: authorizing against a server that is not yet the active one.
    capacitorRequest.mockResolvedValue(ok({}))
    const { nativeHttp } = buildNativeHttp({ serverConnectionConfig: null })

    await nativeHttp.get('/api/me', { serverConnectionConfig: { id: 'srv-2', address: 'https://other.example.invalid' } })

    const req = capacitorRequest.mock.calls[0][0]
    expect(req.url).toBe('https://other.example.invalid/api/me')
    expect(req.serverConnectionConfig).toBeUndefined()
  })

  it('returns the response body rather than the envelope', async () => {
    capacitorRequest.mockResolvedValue(ok({ id: 'u1', username: 'jane' }))
    const { nativeHttp } = buildNativeHttp()

    await expect(nativeHttp.get('/api/me')).resolves.toEqual({ id: 'u1', username: 'jane' })
  })

  it('throws on a 4xx or 5xx that is not a 401', async () => {
    capacitorRequest.mockResolvedValue({ status: 500, data: 'Internal Server Error' })
    const { nativeHttp } = buildNativeHttp()

    await expect(nativeHttp.get('/api/me')).rejects.toThrow('Internal Server Error')
  })

  it('falls back to a status message when the error body is not a string', async () => {
    capacitorRequest.mockResolvedValue({ status: 404, data: { error: 'nope' } })
    const { nativeHttp } = buildNativeHttp()

    await expect(nativeHttp.get('/api/me')).rejects.toThrow('HTTP 404')
  })

  it('sends the request without a token rather than refusing when none is stored', async () => {
    capacitorRequest.mockResolvedValue(ok({}))
    const { nativeHttp } = buildNativeHttp({ token: null })

    await nativeHttp.get('/api/me')

    expect(capacitorRequest.mock.calls[0][0].headers.Authorization).toBeUndefined()
  })
})

describe('401 refresh and retry', () => {
  it('refreshes then retries the original request with the new token', async () => {
    capacitorRequest.mockResolvedValueOnce({ status: 401, data: '' }).mockResolvedValueOnce(ok({ id: 'u1' }))
    capacitorPost.mockResolvedValue(ok({ user: { accessToken: 'new-tok', refreshToken: 'new-refresh' } }))
    const { nativeHttp } = buildNativeHttp()

    const result = await nativeHttp.get('/api/me')

    expect(result).toEqual({ id: 'u1' })
    const retry = capacitorRequest.mock.calls[1][0]
    expect(retry.url).toBe('https://abs.example.invalid/api/me')
    expect(retry.headers.Authorization).toBe('Bearer new-tok')
  })

  it('sends the stored refresh token to the refresh endpoint', async () => {
    capacitorRequest.mockResolvedValueOnce({ status: 401, data: '' }).mockResolvedValueOnce(ok({}))
    capacitorPost.mockResolvedValue(ok({ user: { accessToken: 'new-tok' } }))
    const { nativeHttp, $db } = buildNativeHttp({ refreshToken: 'stored-refresh' })

    await nativeHttp.get('/api/me')

    expect($db.getRefreshToken).toHaveBeenCalledWith('srv-1')
    expect(capacitorPost.mock.calls[0][0].url).toBe('https://abs.example.invalid/auth/refresh')
    expect(capacitorPost.mock.calls[0][0].headers['x-refresh-token']).toBe('stored-refresh')
  })

  it('persists the refreshed tokens', async () => {
    capacitorRequest.mockResolvedValueOnce({ status: 401, data: '' }).mockResolvedValueOnce(ok({}))
    capacitorPost.mockResolvedValue(ok({ user: { accessToken: 'new-tok', refreshToken: 'new-refresh' } }))
    const { nativeHttp, $db } = buildNativeHttp()

    await nativeHttp.get('/api/me')

    expect($db.setServerConnectionConfig).toHaveBeenCalled()
    expect($db.setServerConnectionConfig.mock.calls[0][0].token).toBe('new-tok')
  })

  it('does not retry more than once when the retry itself 401s', async () => {
    // Guard against a refresh loop: the retry is a plain request, not another refresh cycle.
    capacitorRequest.mockResolvedValueOnce({ status: 401, data: '' }).mockResolvedValueOnce({ status: 401, data: 'still no' })
    capacitorPost.mockResolvedValue(ok({ user: { accessToken: 'new-tok' } }))
    const { nativeHttp } = buildNativeHttp()

    await expect(nativeHttp.get('/api/me')).rejects.toThrow()
    expect(capacitorRequest).toHaveBeenCalledTimes(2)
    expect(capacitorPost).toHaveBeenCalledTimes(1)
  })

  it('logs out when there is no refresh token to use', async () => {
    capacitorRequest.mockResolvedValue({ status: 401, data: '' })
    const { nativeHttp, dispatched, $db } = buildNativeHttp({ refreshToken: null })

    await expect(nativeHttp.get('/api/me')).rejects.toThrow('No refresh token available')
    expect(dispatched.map((d) => d.type)).toContain('user/logout')
    expect($db.clearRefreshToken).toHaveBeenCalledWith('srv-1')
  })

  it('logs out when the refresh endpoint rejects the token with a 401', async () => {
    // The one case where logging out is right: the server has explicitly refused the credential.
    capacitorRequest.mockResolvedValue({ status: 401, data: '' })
    capacitorPost.mockResolvedValue({ status: 401, data: 'invalid refresh token' })
    const { nativeHttp, dispatched } = buildNativeHttp()

    await expect(nativeHttp.get('/api/me')).rejects.toThrow()
    expect(dispatched.map((d) => d.type)).toContain('user/logout')
  })

  it('redirects to the connection screen on refresh failure', async () => {
    capacitorRequest.mockResolvedValue({ status: 401, data: '' })
    capacitorPost.mockResolvedValue({ status: 401, data: '' })
    const { nativeHttp } = buildNativeHttp()

    await expect(nativeHttp.get('/api/me')).rejects.toThrow()

    expect(window.location.href).toContain('/connect?error=refreshTokenFailed')
  })

  it('does not redirect when already on the connection screen', async () => {
    window.location.pathname = '/connect'
    capacitorRequest.mockResolvedValue({ status: 401, data: '' })
    capacitorPost.mockResolvedValue({ status: 401, data: '' })
    const { nativeHttp } = buildNativeHttp()

    await expect(nativeHttp.get('/api/me')).rejects.toThrow()

    expect(window.location.href).toBe('')
  })
})

describe('a transient failure during refresh must not log the user out', () => {
  /**
   * **Defect spec.** The same defect the Android client had as #1908/#1900/#1901, still live in
   * the JavaScript request path.
   *
   * `refreshAccessToken` catches *every* failure and returns `null` (`nativeHttp.js:157-160`),
   * including a transport error - no network, DNS failure, TLS refusal, server restarting.
   * `handleTokenRefresh` sees the null, throws, and its catch calls `handleRefreshFailure`, which
   * dispatches `user/logout` and clears the stored refresh token (`:108-115`, `:212-230`).
   *
   * So losing connectivity for the duration of one refresh signs the user out and destroys the
   * credential that would have let them back in silently. Nothing about a dropped TCP connection
   * says the refresh token is invalid.
   *
   * The native side already distinguishes these: `ApiHandler.handleTokenRefresh` treats a 401 from
   * `/auth/refresh` as terminal and IO/5xx as retryable. This path does not, so the same session
   * survives or dies depending on which client made the request.
   *
   * Expected: the session and the stored refresh token survive; the request fails.
   * Observed: logged out, refresh token cleared, redirected to /connect.
   *
   * Left failing; the fix belongs on its own branch.
   */
  it('a network error during refresh does not log the user out', async () => {
    capacitorRequest.mockResolvedValue({ status: 401, data: '' })
    capacitorPost.mockRejectedValue(new Error('Network request failed'))
    const { nativeHttp, dispatched } = buildNativeHttp()

    await expect(nativeHttp.get('/api/me')).rejects.toThrow()

    expect(dispatched.map((d) => d.type)).not.toContain('user/logout')
  })

  it('a network error during refresh does not clear the stored refresh token', async () => {
    capacitorRequest.mockResolvedValue({ status: 401, data: '' })
    capacitorPost.mockRejectedValue(new Error('Network request failed'))
    const { nativeHttp, $db } = buildNativeHttp()

    await expect(nativeHttp.get('/api/me')).rejects.toThrow()

    expect($db.clearRefreshToken).not.toHaveBeenCalled()
  })

  it('a 503 from the refresh endpoint does not log the user out', async () => {
    // A restarting or overloaded server is not a rejected credential.
    capacitorRequest.mockResolvedValue({ status: 401, data: '' })
    capacitorPost.mockResolvedValue({ status: 503, data: 'Service Unavailable' })
    const { nativeHttp, dispatched } = buildNativeHttp()

    await expect(nativeHttp.get('/api/me')).rejects.toThrow()

    expect(dispatched.map((d) => d.type)).not.toContain('user/logout')
  })
})
