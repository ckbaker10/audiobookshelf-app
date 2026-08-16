# E2E web tests

Browser tests for the frontend, in `test-e2e/`. Read `FRONTEND_TESTING.md` first — this file covers
only what is different in a browser.

```bash
npm run generate        # dist/ must exist and be current
npm run test:e2e        # run the web project
npm run test:e2e:build  # both, in order

npx playwright test --config test-e2e/playwright.config.mjs --headed
npx playwright test --config test-e2e/playwright.config.mjs -g "row view"
```

## Install

Two pieces, and they fail in different ways. The **runner** is an ordinary npm dependency; the
**browser** is a ~200 MB binary fetched from Microsoft's CDN at install time, and that fetch is what
breaks on restricted networks.

```bash
npm ci                            # 1. the runner - @playwright/test is already in devDependencies
npx playwright install chromium   # 2. the browser
```

That is the whole happy path. `npm ci` needs nothing special; step 2 downloads three things into
`~/.cache/ms-playwright/`:

| Component | Version pinned by Playwright 1.62.1 | Path |
| --- | --- | --- |
| Chrome for Testing | 151.0.7922.34 (`chromium` build v1234) | `chromium-1234` |
| Chrome Headless Shell | 151.0.7922.34 | `chromium_headless_shell-1234` |
| FFmpeg | v1011 (video capture only) | `ffmpeg-1011` |

Chromium only — the other engines would triple the download for no coverage, since the app ships in
an Android WebView, which is Chromium.

Useful flags:

```bash
npx playwright install chromium --dry-run     # print URLs, versions and target paths; downloads nothing
npx playwright install chromium --only-shell  # headless shell only, smaller; enough for CI
npx playwright install --with-deps chromium   # also apt-installs the shared libraries (needs sudo)
npx playwright install --list                 # what is already on this machine
```

On a bare Linux box the browser will not launch without its shared libraries. `--with-deps` is the
supported way to get them and is what `.github/workflows/e2e-web.yml` uses.

### When the browser will not download

This is not hypothetical: the specs in this directory were written on a machine where
`cdn.playwright.dev` was unreachable, and none of them have ever run. The symptom is a 30 s timeout
per attempt:

```
Error: Request to https://cdn.playwright.dev/builds/cft/151.0.7922.34/linux64/chrome-linux64.zip
timed out after 30000ms
```

Worth knowing before you start guessing: for this version the Chrome-for-Testing build has **one**
source. FFmpeg has Microsoft fallback mirrors, Chromium does not — so `install` can appear to make
partial progress and still fail on the part you need. `npm i @playwright/browser-chromium` is not a
way around it either; that package shells out to the same downloader.

In rough order of effort:

**1. Longer timeout, if the connection is merely slow.**

```bash
PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=180000 npx playwright install chromium
```

**2. A mirror or proxy, if your network has one.**

```bash
PLAYWRIGHT_DOWNLOAD_HOST=https://your-mirror.example.com npx playwright install chromium
HTTPS_PROXY=http://proxy.example.com:8080 npx playwright install chromium
```

`PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST` overrides Chromium alone; `PLAYWRIGHT_CDN_MIRRORS` takes a list.

**3. A system browser instead.** The config reads two variables so this needs no file edit:

```bash
# a channel Playwright knows how to find: chrome, chrome-beta, chrome-dev, chrome-canary,
# msedge, msedge-beta, chromium-tip-of-tree
E2E_BROWSER_CHANNEL=chrome npm run test:e2e

# or point straight at a binary
E2E_BROWSER_EXECUTABLE=/snap/bin/chromium npm run test:e2e
```

On Ubuntu, `sudo snap install chromium` currently gives 151.0.7922.108 against Playwright's pinned
151.0.7922.34 — close enough that a mismatch is unlikely to be what breaks a spec. Set
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` on `npm ci` to stop it retrying the download you are working
around.

**This is a fallback, not a supported configuration.** CI runs Playwright's pinned build, so a
system browser means you and CI are testing against different binaries. Reproduce anything surprising
on the pinned build before believing it.

**4. Copy `~/.cache/ms-playwright/` from a machine that has it.** Same OS and architecture, same
Playwright version. Or set `PLAYWRIGHT_BROWSERS_PATH` to a shared location.

## Current state

**16 specs, never run.** No browser could be downloaded on the machine they were written on — see
above. The config loads and all 16 collect; that is all that is known. Treat the first real run as a
debugging session and start it with `smoke.spec.js` — if the build-and-serve story is wrong,
everything else times out in a way that looks like an application defect.

Delete this section once the suite has run.

## Why this tier exists

Not more coverage — a different kind. The 278 Vitest specs mount a component with everything around
it faked, and happy-dom reports every element as zero-sized. Three things follow that no amount of
unit testing reaches:

| Gap | Why only a browser |
| --- | --- |
| `LazyBookshelf`'s virtualisation geometry | `initSizeData` measures `clientWidth`/`clientHeight`. Under happy-dom both are 0, so `entitiesPerShelf` collapses and the numbers under test never exist. |
| Whether a mounted card is *visible* | `entities` and `totalEntities` were correct while the offline shelf rendered nothing but a red notice. Mounting a card and putting it on screen are separate steps. |
| Real connectivity transitions | `context.setOffline()` drives `@capacitor/network`'s web implementation, which reads `navigator.onLine` and listens for the window `online`/`offline` events. Nothing is faked. |

## Scope, and what is deliberately absent

One project, `web`. Not here, and not by omission:

- **A live server.** These specs are offline-first; the one online leg is a `page.route()` handler.
  Booting a real Audiobookshelf for a card count is cost without coverage.
- **The Android WebView tier.** Planned in `AI_Planning/audiobookshelf/e2e-testing-plan.md` as
  Tier 2. It needs a device and covers the native bridge seam, which nothing here touches.
- **Auth and switch-server flows.** They need a real socket and real JWT rotation. `pages/account.vue`
  redirects to `/connect` when `socketConnected` is false, and socket.io is not something
  `page.route()` fakes convincingly — so it is aborted outright and these specs cover what the app
  does without one, rather than pretending.

## Conventions

These extend `FRONTEND_TESTING.md`'s five. Numbering continues from it.

6. **A test hook is not "changing production code to make a test pass".** Convention #4 forbids
   changing behaviour to satisfy a test. A `data-testid`, or a web-only bridge reading a
   `localStorage` key it already writes, changes nothing a user can observe. The boundary: if
   removing the hook would change what the app *does*, it is not a hook and #4 applies.
   Currently three attributes (`bookshelf-total`, `bookshelf-view-toggle`, `offline-notice`) and one
   seedable key (`localLibraryItems`).
7. **Prefer the ids the app already has.** Cards are `book-card-N` and the scroll container is
   `#bookshelf-wrapper`. Both are structural, both are already selected on by the unit specs, and
   neither is a `data-testid` that had to be added. Add a hook only where the alternative is a
   Tailwind utility class or translated text.
8. **Never select on translated text.** Same reasoning `FRONTEND_TESTING.md` gives for `$strings`,
   and it applies harder here: `strings/en-us.json` has 42 locale siblings.
9. **`retries: 0`.** A retried-green suite converts a real intermittent defect into noise. Quarantine
   and fix, or delete.
10. **Assert reachability, not what is on screen.** The shelf is virtualised: cards that scroll out
    of view are removed. Counting cards at the bottom measures the window size, not the library.
    `indexesReachableByScrolling()` takes the union over a sweep, which is what "can the user get to
    their books" actually means.

## The harness

```
test-e2e/
  playwright.config.mjs    .mjs because the package is CommonJS - an ESM .js config fails to load
  scripts/serve-dist.mjs   static server for dist/, with the 200.html fallback
  support/
    fixtures.js            phone context, the `library` fixture, the scroll sweep
    seed.js                localStorage builders: device data and downloads
    routeFixtures.js       /api handlers, with capture provenance in the header
  web/
    smoke.spec.js
    offline-library-parity.spec.js
```

**Seeding.** `seed.js` writes two keys through `addInitScript`, before any page script runs — a seed
applied after navigation is a page too late, because `layouts/default.vue` reads device data on
mount.

| Key | Holds | Read by |
| --- | --- | --- |
| `device` | server connection configs, `lastServerConnectionConfigId` | `AbsDatabaseWeb.getDeviceData` |
| `localLibraryItems` | the downloads | `AbsDatabaseWeb.getLocalLibraryItems` |

`lastServerConnectionConfigId` is what separates the two offline states the Library tab behaves
differently in: a device with a session to restore, and one without (a fresh install, or a logout).
Both are ordinary and both are covered.

**Why the serving is hand-rolled.** `nuxt generate` emits `200.html` as the client-side fallback.
Without serving it for unknown paths, a deep link like `/bookshelf/library` 404s and every spec
fails at navigation rather than at its assertion. That is the whole reason `serve-dist.mjs` exists
instead of a dependency.

## Fixture provenance

Payload shapes are captured from the `audiobookshelf` server pinned at commit
**`96d4021a3cd45f67bf374b65abafbe5d73e926b5`** — tag `v2.36.0`. (The tag object is `57d01f88`; a
checkout resolves to the commit.) Not the tracking checkout, which follows upstream.

```bash
git -C /home/lukas/repos/audiobookshelf worktree add /home/lukas/repos/abs-2.36.0 v2.36.0
```

| Fixture | Captured from |
| --- | --- |
| `libraryItemsPayload` | `server/controllers/LibraryController.js:610-622` |
| `authorizePayload` | `server/Auth.js:96-105`, via `MiscController.authorize` |

These are shapes, not recordings: field names and nesting are the server's, values are the test's.
A fixture whose provenance is not written down is indistinguishable from one that was invented.

**The reported version must clear 2.26.0.** `layouts/default.vue:180` gates on
`$isValidVersion(serverSettings.version, '2.26.0')`; below it the layout takes its pre-2.26 auth
branch and the page under test is not the one users see.

## What these tests can still lie about

**A fixture that drifts from the real API passes forever.** Nothing here talks to a running server,
so a route handler that got the envelope wrong is green while production cannot parse a real answer.
This is why the shapes are captured rather than invented, and why the pin is recorded — re-capture
when the app starts supporting a newer server, and change the pin deliberately.

**Aborting socket.io is a boundary, not a fake.** Specs here run in a state the app treats as "no
live connection". That is a real state, but it is not the only one, and nothing here covers what the
app does when a socket connects and then drops.

**`AbsDatabaseWeb` is not `AbsDatabase.kt`.** The web bridge is an ordinary JavaScript object
reading `localStorage`; the Android bridge is Kotlin over a real database. They can drift, and
nothing in this suite would notice. That seam is Tier 2's job.
