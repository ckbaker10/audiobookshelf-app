import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT || 4173)

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
        ...devices['Pixel 5']
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
