import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT || 4173)

/**
 * Escape hatch for machines that cannot download Playwright's own Chromium.
 *
 * `cdn.playwright.dev` is the only source for the Chrome-for-Testing build this version pins, and
 * it is blocked on some networks. Rather than leave the suite unrunnable there, these let a system
 * browser stand in - see E2E_TESTING.md, "When the browser will not download".
 *
 * Unset by default, so the normal path is unaffected and nobody is silently testing against a
 * different browser than CI does.
 */
const systemBrowser = {
  ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}),
  ...(process.env.E2E_BROWSER_EXECUTABLE ? { launchOptions: { executablePath: process.env.E2E_BROWSER_EXECUTABLE } } : {})
}

/**
 * Browser tier for the frontend.
 *
 * Scope is deliberately one project. The Android WebView project and the live-server mode described
 * in `AI_Planning/audiobookshelf/test-tiers-implementation-plan.md` are not here: neither is needed
 * to count cards on a shelf, and both bring a dependency (a device, a booted server) that would
 * make this suite un-runnable in CI on day one.
 */
export default defineConfig({
  testDir: './web',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,

  /**
   * **Never retry.** A retried-green e2e suite is worse than no suite: it converts a real
   * intermittent defect into noise and trains everyone to re-run. Quarantine and fix, or delete.
   * The existing Vitest and JVM suites' credibility rests on the same rule.
   */
  retries: 0,

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },

  projects: [
    {
      name: 'web',
      use: {
        // Real phone geometry is the point. `LazyBookshelf.initSizeData` derives entities-per-shelf
        // from the measured width and `bookWidth` reads `window.innerWidth` separately, so a
        // desktop viewport silently tests a layout no user has.
        ...devices['Pixel 5'],
        ...systemBrowser
      }
    }
  ],

  webServer: {
    // `dist/` must exist. Built separately rather than from here so a failing build is a build
    // failure rather than a mysterious test timeout.
    command: `node scripts/serve-dist.mjs ${PORT}`,
    url: `http://localhost:${PORT}/connect`,
    cwd: import.meta.dirname,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
})
