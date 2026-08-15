import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocked at the module seam rather than through `fakeNativeHttp`: this component calls
// `CapacitorHttp` and `Browser` directly, so routing it through the harness's HTTP fake would
// replace the very code under test with something else.
const browserOpen = vi.fn()
const capacitorHttpGet = vi.fn()
vi.mock('@capacitor/browser', () => ({ Browser: { open: (...a) => browserOpen(...a) } }))
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { get: (...a) => capacitorHttpGet(...a), post: vi.fn() } }))
vi.mock('@capacitor/dialog', () => ({ Dialog: { confirm: vi.fn(), alert: vi.fn() } }))

const ServerConnectForm = (await import('@/components/connection/ServerConnectForm.vue')).default
const { mountComponent, storeWith } = await import('../support/harness')

/**
 * Issue #1274 - OpenID login incorrectly requires HTTPS for the *application* server.
 *
 * OAuth 2.0 requires HTTPS for the **identity provider's** authorization endpoint (RFC 6749
 * §10.9). It says nothing about the transport between this app and the audiobookshelf server that
 * merely *tells* the app where that endpoint is. Plenty of people run ABS over plain HTTP on a
 * LAN, or behind a tunnel that terminates TLS elsewhere, while using an HTTPS identity provider -
 * a perfectly valid setup that the app refuses outright.
 *
 * Production path: `clickLoginWithOpenId()` opens with
 *
 *     if (!this.serverConfig.address.startsWith('https') && this.oauth.enforceHTTPs) { ...return }
 *
 * (`ServerConnectForm.vue:232-236`), which rejects the *ABS address* before it ever asks that
 * server for an authorization URL.
 *
 * The correct check already exists, separately and further down:
 *
 *     if (redirectUrl.protocol !== 'https:' && this.oauth.enforceHTTPs) { ...return }
 *
 * (`:268-272`) - applied to the identity provider's URL, which is the one the RFC is about.
 *
 * So the contract is: gate on what the provider returns, not on how the app reached ABS. The
 * identity-provider specs below pass today and are guards - relaxing the ABS check must not
 * relax the one that actually matters.
 */

const authorizationUrl = (base = 'https://idp.example.invalid/authorize') =>
  `${base}?response_type=code&client_id=abs-app&scope=openid%20profile&state=xyz123&redirect_uri=${encodeURIComponent('audiobookshelf://oauth')}`

/** A 302 from ABS carrying the provider's authorization URL, which is what the app consumes. */
const redirectResponse = (location) => ({ status: 302, headers: { location }, data: '' })

function mountForm({ address = 'http://abs.example.invalid', version = '2.36.0' } = {}) {
  const mounted = mountComponent(ServerConnectForm, { store: storeWith({ user: null }) })
  mounted.wrapper.vm.serverConfig = {
    ...mounted.wrapper.vm.serverConfig,
    address,
    version
  }
  return mounted
}

beforeEach(() => {
  browserOpen.mockReset()
  capacitorHttpGet.mockReset()
  // PKCE needs real-ish crypto; happy-dom does not implement subtle.digest.
  if (!globalThis.crypto?.subtle) {
    globalThis.crypto = {
      getRandomValues: (arr) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i + 1
        return arr
      },
      subtle: { digest: async () => new Uint8Array(32).buffer }
    }
  }
})

describe('#1274 OpenID transport policy', () => {
  describe('the ABS server address', () => {
    it('an http ABS server may still start an OpenID login', async () => {
      capacitorHttpGet.mockResolvedValue(redirectResponse(authorizationUrl()))

      const { wrapper } = mountForm({ address: 'http://abs.example.invalid' })
      await wrapper.vm.clickLoginWithOpenId()

      expect(browserOpen).toHaveBeenCalledTimes(1)
    })

    it('asks the http ABS server itself for the authorization url', async () => {
      capacitorHttpGet.mockResolvedValue(redirectResponse(authorizationUrl()))

      const { wrapper } = mountForm({ address: 'http://abs.example.invalid' })
      await wrapper.vm.clickLoginWithOpenId()

      expect(capacitorHttpGet).toHaveBeenCalledTimes(1)
      expect(capacitorHttpGet.mock.calls[0][0].url).toContain('http://abs.example.invalid/auth/openid')
    })

    it('opens the provider url the http ABS server returned, not the ABS url', async () => {
      capacitorHttpGet.mockResolvedValue(redirectResponse(authorizationUrl()))

      const { wrapper } = mountForm({ address: 'http://abs.example.invalid' })
      await wrapper.vm.clickLoginWithOpenId()

      // Asserted via the call list rather than indexing into it, so the failure while the bug is
      // present reads as "the browser was never opened" instead of a TypeError on undefined.
      const openedUrls = browserOpen.mock.calls.map((c) => c[0].url)
      expect(openedUrls).toHaveLength(1)
      expect(openedUrls[0]).toMatch(/^https:\/\/idp\.example\.invalid\/authorize/)
    })

    it('an https ABS server still works', async () => {
      // Guard: this is the path that works today and must keep working.
      capacitorHttpGet.mockResolvedValue(redirectResponse(authorizationUrl()))

      const { wrapper } = mountForm({ address: 'https://abs.example.invalid' })
      await wrapper.vm.clickLoginWithOpenId()

      expect(browserOpen).toHaveBeenCalledTimes(1)
    })
  })

  describe('the identity provider url (guards: these must stay strict)', () => {
    it('refuses to open an http authorization endpoint', async () => {
      capacitorHttpGet.mockResolvedValue(redirectResponse(authorizationUrl('http://idp.example.invalid/authorize')))

      const { wrapper } = mountForm({ address: 'https://abs.example.invalid' })
      await wrapper.vm.clickLoginWithOpenId()

      expect(browserOpen).not.toHaveBeenCalled()
    })

    it('refuses an authorization url with no state parameter', async () => {
      const noState = 'https://idp.example.invalid/authorize?response_type=code&client_id=abs-app&scope=openid&redirect_uri=x'
      capacitorHttpGet.mockResolvedValue(redirectResponse(noState))

      const { wrapper } = mountForm({ address: 'https://abs.example.invalid' })
      await wrapper.vm.clickLoginWithOpenId()

      expect(browserOpen).not.toHaveBeenCalled()
    })

    it('refuses when the server answers without a redirect', async () => {
      capacitorHttpGet.mockResolvedValue({ status: 200, headers: {}, data: 'not a redirect' })

      const { wrapper } = mountForm({ address: 'https://abs.example.invalid' })
      await wrapper.vm.clickLoginWithOpenId()

      expect(browserOpen).not.toHaveBeenCalled()
    })

    it('refuses when the redirect carries no location header', async () => {
      capacitorHttpGet.mockResolvedValue({ status: 302, headers: {}, data: '' })

      const { wrapper } = mountForm({ address: 'https://abs.example.invalid' })
      await wrapper.vm.clickLoginWithOpenId()

      expect(browserOpen).not.toHaveBeenCalled()
    })
  })
})
