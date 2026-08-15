import { describe, it, expect } from 'vitest'
import SideDrawer from '@/components/app/SideDrawer.vue'
import { mountComponent, storeWith, fakeRouter, fakeLocalStore, flush } from '../support/harness'

/**
 * Issue #1335 - "Switch Server/User" disconnects the current server.
 *
 * Choosing **Switch Server/User** to look at another server, then backing out, leaves the app
 * logged out of the server it was already connected to. The user has to reconnect to get back to
 * where they started, which is not what "switch" implies and is not recoverable by pressing Back.
 *
 * Production path: `SideDrawer.vue` builds the menu entry with `action: 'logout'` (`:148-151`),
 * and `clickAction` handles it as
 *
 *     if (action === 'logout') { await this.logout(); this.$router.push('/connect') }
 *
 * (`:164-167`). `logout()` dispatches `user/logout`, which clears the user, the socket, the
 * current library and the persisted last-library id (`store/user.js:144-169`).
 *
 * So "switch" and the explicit **Disconnect** button run *the same* destructive action. There is
 * no notion of a reversible switch anywhere in the component, which is why backing out cannot
 * restore anything - there is nothing left to restore.
 *
 * The contract below: choosing to *look at* the connection screen must not tear down the current
 * connection. Only an explicit disconnect, or a successful authentication against a different
 * server, may replace it.
 *
 * The explicit-disconnect specs pass today and are guards: a fix must not make Disconnect stop
 * disconnecting.
 */

const serverConnectionConfig = {
  id: 'srv-1',
  name: 'Home Server',
  address: 'https://abs.example.invalid',
  userId: 'u1',
  username: 'jane',
  token: 'tok'
}

function mountDrawer({ user = { id: 'u1', username: 'jane' }, routeName = 'bookshelf' } = {}) {
  const store = storeWith({ user, networkConnected: true })
  // The menu entry only appears when a server connection config exists.
  store.state.user.serverConnectionConfig = serverConnectionConfig
  store.getters = store.getters || {}

  const router = fakeRouter({ path: '/bookshelf', name: routeName })
  const localStore = fakeLocalStore({ lastLibraryId: 'lib-1' })

  const dispatched = []
  const originalDispatch = store.dispatch.bind(store)
  store.dispatch = async (type, payload) => {
    dispatched.push({ type, payload })
    if (type === 'user/logout') {
      // Performs what store/user.js:144-169 performs, rather than recording the call and
      // returning. Stubbing it out would make every "the connection survives" spec below
      // vacuous - they would pass because nothing could have cleared the state, not because
      // production chose to keep it.
      store.state.user.user = null
      store.state.user.serverConnectionConfig = null
      store.state.libraries.currentLibraryId = null
      await localStore.removeLastLibraryId()
      return
    }
    if (type === 'user/openWebClient') return
    return originalDispatch(type, payload)
  }

  const mounted = mountComponent(SideDrawer, { store, router, localStore })
  return { ...mounted, dispatched, store }
}

describe('#1335 Switch Server/User must not disconnect the current server', () => {
  it('offers a switch entry that is distinguishable from logging out', () => {
    const { wrapper } = mountDrawer()

    const switchEntry = wrapper.vm.navItems.find((i) => i.text === 'ButtonSwitchServerUser')

    expect(switchEntry).toBeTruthy()
    expect(switchEntry.action).not.toBe('logout')
  })

  it('does not dispatch user/logout when the user only wants to choose another server', async () => {
    const { wrapper, dispatched } = mountDrawer()
    const switchEntry = wrapper.vm.navItems.find((i) => i.text === 'ButtonSwitchServerUser')

    await wrapper.vm.clickAction(switchEntry.action)
    await flush()

    expect(dispatched.map((d) => d.type)).not.toContain('user/logout')
  })

  it('leaves the current user in place while the connection screen is open', async () => {
    const { wrapper, store } = mountDrawer()
    const switchEntry = wrapper.vm.navItems.find((i) => i.text === 'ButtonSwitchServerUser')

    await wrapper.vm.clickAction(switchEntry.action)
    await flush()

    expect(store.state.user.user).toEqual({ id: 'u1', username: 'jane' })
    expect(store.state.user.serverConnectionConfig).toEqual(serverConnectionConfig)
  })

  it('keeps the persisted last-library id, so backing out returns to the same shelf', async () => {
    const { wrapper, $localStore } = mountDrawer()
    const switchEntry = wrapper.vm.navItems.find((i) => i.text === 'ButtonSwitchServerUser')

    await wrapper.vm.clickAction(switchEntry.action)
    await flush()

    expect($localStore.store.lastLibraryId).toBe('lib-1')
  })

  it('still navigates to the connection screen', async () => {
    // The guard on the specs above: "do not log out" must not become "do not go anywhere".
    const { wrapper, $router } = mountDrawer()
    const switchEntry = wrapper.vm.navItems.find((i) => i.text === 'ButtonSwitchServerUser')

    await wrapper.vm.clickAction(switchEntry.action)
    await flush()

    expect($router.navigations.some((n) => String(n.to).includes('/connect'))).toBe(true)
  })

  // --- Explicit disconnect: passes today, kept so a fix cannot break it -----------------------

  it('explicit Disconnect does dispatch user/logout', async () => {
    const { wrapper, dispatched } = mountDrawer()

    await wrapper.vm.disconnect()
    await flush()

    expect(dispatched.map((d) => d.type)).toContain('user/logout')
  })

  it('explicit Disconnect returns to the bookshelf when elsewhere', async () => {
    const { wrapper, $router } = mountDrawer({ routeName: 'item-id' })

    await wrapper.vm.disconnect()
    await flush()

    expect($router.navigations).toContainEqual({ method: 'replace', to: '/bookshelf' })
  })

  it('explicit Disconnect closes the side drawer', async () => {
    const { wrapper } = mountDrawer()

    await wrapper.vm.disconnect()
    await flush()

    expect(wrapper.vm.show).toBe(false)
  })
})
