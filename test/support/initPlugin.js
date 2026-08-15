import { vi } from 'vitest'

/**
 * Loads `plugins/init.client.js` and returns the helpers it hangs off `Vue.prototype`.
 *
 * That module is a Nuxt client plugin with top-level side effects - it registers a directive and
 * calls `Capacitor.getPlatform()` on import - so the native modules have to be mocked before it is
 * imported. Everything mocked here is a *native* seam; the helpers under test are pure JavaScript
 * and are exercised for real.
 *
 * The helpers are only reachable through `Vue.prototype` because the module neither exports them
 * nor accepts injection. Reading them back off the prototype is therefore the only way to test
 * them without changing production code, which this branch does not do.
 */
export async function loadInitPluginHelpers() {
  vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(), removeAllListeners: vi.fn() } }))
  vi.mock('@capacitor/dialog', () => ({ Dialog: { confirm: vi.fn(), alert: vi.fn() } }))
  vi.mock('@capacitor/status-bar', () => ({
    StatusBar: { setStyle: vi.fn(), show: vi.fn(), hide: vi.fn() },
    Style: { Dark: 'DARK', Light: 'LIGHT' }
  }))
  vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn() } }))
  vi.mock('@capacitor/core', () => ({
    Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
    CapacitorHttp: { get: vi.fn(), post: vi.fn() },
    registerPlugin: () => ({})
  }))
  vi.mock('@capacitor/screen-orientation', () => ({ ScreenOrientation: { lock: vi.fn(), unlock: vi.fn() } }))
  vi.mock('@/plugins/capacitor', () => ({
    AbsFileSystem: {},
    AbsAudioPlayer: {},
    AbsDatabase: {},
    AbsLogger: { info: vi.fn(), error: vi.fn() }
  }))

  const Vue = (await import('vue')).default
  await import('@/plugins/init.client.js')
  return Vue.prototype
}
