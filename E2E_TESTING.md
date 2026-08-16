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

The symptom is a 30 s timeout per attempt, which reads like a blocked CDN:

```
Error: Request to https://cdn.playwright.dev/builds/cft/151.0.7922.34/linux64/chrome-linux64.zip
timed out after 30000ms
```

**On this machine it was IPv6, and `RES_OPTIONS=no-aaaa` is the fix.** The CDN resolves to an AAAA
record that the host cannot route, Node tries it first and waits out the timeout rather than falling
back to IPv4. Nothing about the CDN is blocked, which is why the failure is so misleading: `curl` may
well succeed while `npx playwright install` does not, because they disagree about address-family
preference.

Try that before anything else:

```bash
RES_OPTIONS=no-aaaa npx playwright install chromium
```

Worth knowing if it is *not* that: for this version the Chrome-for-Testing build has **one** source.
FFmpeg has Microsoft fallback mirrors, Chromium does not — so `install` can appear to make partial
progress and still fail on the part you need. `npm i @playwright/browser-chromium` is not a way
around it either; that package shells out to the same downloader.

Then, in rough order of effort:

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

**111 specs, 0 failures.**

The suite was written against the offline row/grid parity defect and measured it at full size before
the fix landed:

| Offline Library tab, no session | Before | After |
| --- | --- | --- |
| grid (catalogue) view | 10 of 24 downloads | **24 of 24** |
| row (list) view | 8 of 24 downloads | **24 of 24** |

Row view reached fewer than grid and neither reached the library. Fixed in `LazyBookshelf.scroll`
and `handleScroll`; the specs went green with their assertions untouched.

Re-run `npm run generate` before `npm run test:e2e` after any change to app code — this tier runs
against the built bundle, so a stale `dist/` tests the previous version and says nothing.

## Why this tier exists

Not more coverage — a different kind. The 278 Vitest specs mount a component with everything around
it faked, and happy-dom reports every element as zero-sized. Three things follow that no amount of
unit testing reaches:

| Gap | Why only a browser |
| --- | --- |
| `LazyBookshelf`'s virtualisation geometry | `initSizeData` measures `clientWidth`/`clientHeight`. Under happy-dom both are 0, so `entitiesPerShelf` collapses and the numbers under test never exist. |
| Whether a mounted card is *visible* | `entities` and `totalEntities` were correct while the offline shelf rendered nothing but a red notice. Mounting a card and putting it on screen are separate steps. |
| Real connectivity transitions | `context.setOffline()` flips `navigator.onLine` and fires the window `offline` event, which is exactly what `@capacitor/network`'s web implementation listens for. The app's own `networkConnected` follows. Nothing is faked — but see the ordering constraint below. |

**Offline emulation does not survive a navigation.** `setOffline(true)` followed by `page.goto()`
lands on a page reporting `navigator.onLine === true`, and the app then behaves as if connected.
Verified in Chromium 151. So the specs load the page **online and then take it offline**, which
models *the connection dropping while the Library tab is open* — the scenario
`LazyBookshelf`'s `networkConnected` watcher exists for.

**Cold-booting the app offline is therefore not reachable in a browser.** The unit suite covers it,
by calling `init()` with `networkConnected: false`. If you find yourself reaching for
`addInitScript` to force `navigator.onLine`, that is manufacturing a state the browser will not
honour — the same trap the parent plan flags for faking `$platform` into `'android'`.

## Scope, and what is deliberately absent

One project, `web`. Not here, and not by omission:

- **A live server.** Everything is fixtures; the auth, refresh and connect flows are driven by
  `page.route()` handlers rather than a booted Audiobookshelf. Real JWT rotation against a real
  server remains uncovered.
- **The Android WebView tier.** Planned in `AI_Planning/audiobookshelf/e2e-testing-plan.md` as
  Tier 2. It needs a device and covers the native bridge seam, which nothing here touches.
- **Anything socket-gated.** socket.io is aborted rather than faked, so `pages/account.vue` (and with
  it *logout*), `item/_id`, `add-podcast`, the episode tables and the connection indicator are out.
  These specs cover what the app does without a live socket, rather than pretending to have one.

**Switch-server is *not* in that last group**, despite an earlier version of this file saying so.
Neither `pages/connect.vue` nor `SideDrawer` reads `socketConnected` — only the logout half of the
drawer needs a socket, because it lands on the account page. The #1335 journey is covered end to end
in `switch-server.spec.mjs`. Check for the gate before assuming it.

- **Downloading, folder selection, and local playback.** `AbsDownloaderWeb` has no methods at all,
  `AbsFileSystemWeb.selectFolder()` returns undefined, and `AbsAudioPlayer` branches on `local_` and
  does nothing. Downloads can be *seeded*, browsed and shown with progress; never performed, and
  never played. **Server** playback is fully covered — `AbsAudioPlayerWeb` is a real 293-line
  implementation over a real `<audio>` element, so `playback.spec.mjs` drives genuine decode, play,
  seek and rate changes against generated WAV bytes.

## Conventions

These extend `FRONTEND_TESTING.md`'s five. Numbering continues from it.

6. **A test hook is not "changing production code to make a test pass".** Convention #4 forbids
   changing behaviour to satisfy a test. A `data-testid`, or a web-only bridge reading a
   `localStorage` key it already writes, changes nothing a user can observe. The boundary: if
   removing the hook would change what the app *does*, it is not a hook and #4 applies.
   Currently eleven attributes (`item-play` included) (`bookshelf-total`, `bookshelf-view-toggle`, `offline-notice`,
   `bookshelf-filter`, `bookshelf-sort`, `drawer-action`, `server-config`, and the three option
   lists `filter-option`, `order-option`, `library-option`, each carrying `data-value` and
   `data-selected`) and one seedable key (`localLibraryItems`). Several elements needed no hook at
   all — the app bar's `aria-label`s and the nav bar's `href`s are already stable.
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
11. **Watch a new spec fail before believing it.** Break the production code it covers, confirm it
    goes red, put the code back. Not ceremony — every rule from 12 down was found this way, by specs
    that were green and wrong. Check the *scope* too: a mutation should kill the specs about the
    thing it broke and no others. If it kills more, a spec is asserting something it does not claim.
12. **Never drive a setting to its default value.** `mobileOrderBy` defaults to `addedAt` and
    `mobileFilterBy` to `all` (`store/user.js:10-12`). A spec that "changes" a setting to what it
    already was asserts the app's starting state and passes with the feature disabled.
13. **Asserting on the last request is not asserting that a request happened.** With no refetch, the
    last request is still the one from page load, so the assertion holds. Require the count to grow
    first — `expectRefetch()` in `library-filter-sort.spec.mjs` is the pattern.
14. **Assert a lower bound, never only an upper one.** `expect(cards).toBeLessThanOrEqual(rows * 4)`
    passes when the selector finds nothing at all. That is how three shelves were "covered" while
    matching zero elements: the card id prefix is per entity (see the table below), not
    `book-card-` everywhere. Pair every bound with `toBeGreaterThan(0)`.
15. **Bind test attributes as explicit strings.** Vue 2 *removes* an attribute bound to `false`, so
    `:data-selected="a === b"` yields no attribute rather than `"false"` and the negative assertion
    cannot be written. Use `:data-selected="a === b ? 'true' : 'false'"`.
16. **Make the two sides of a change differ in the fixture data.** Convention 12 applied to
    fixtures: if both libraries hold twenty items, a switch that silently does nothing looks
    identical to one that works. `library-switch.spec.mjs` uses 20 against 7 deliberately.
17. **Assert what the app asked for *and* what it rendered.** A query-only assertion cannot see a
    shelf that fetched correctly and rendered nothing — the offline Library tab did exactly that for
    three commits. A render-only assertion cannot tell "rendered the wrong thing" from "asked for
    the wrong thing", which are different defects with different fixes.
18. **A spec that asserts a non-action needs its own, inverted mutation.** "Does nothing when the
    current library is chosen again" survives every mutation that *disables* the feature, because
    disabled code also does nothing. It is killed only by removing the early return that makes it
    true. Disabling the feature is not a proof for these; breaking the guard is.
19. **Load online, then go offline.** Offline emulation does not survive a navigation, so
    `setOffline(true)` before `goto` silently produces an online page. This tier can only model a
    connection that dropped while a screen was open — never an app that started offline.
20. **Never assert that the app *cleared* seeded storage.** `addInitScript` re-runs on every
    navigation, and some teardowns end in `window.location.href = …` — `handleRefreshFailure` does.
    The reload re-seeds `device` and the refresh token, so storage shows a healthy session moments
    after the app destroyed it, and the assertion passes against a teardown that really happened.
    Assert where the app *navigated* instead; a redirect is the one signal re-seeding cannot forge.
21. **Fixture every endpoint on the path, not just the interesting one.** The connect flow pings
    `<address>/ping` before authenticating (`ServerConnectForm.vue:532`, `:699`) — note `/ping`, not
    `/api/ping`. Unanswered, the app decides the server is unreachable and never reaches
    `/api/authorize`, so a spec about authentication silently exercises the failure path instead.
    When a flow does less than expected, check the request log before suspecting the app.
22. **Never `goto` a page whose `asyncData` depends on being connected.** `asyncData` runs during
    route resolution, *before* the layout's `attemptConnection` has set `serverConnectionConfig`, so
    a deep link to `/item/:id`, `/collection/:id` or `/playlist/:id` redirects away and the spec
    tests nothing. Navigate the way a user does — from the shelf, by clicking a card.
23. **Serve the shape the endpoint really returns.** The library list is `minified=1` and carries
    `numTracks`; the collection, playlist and item endpoints return the expanded form, and the
    detail pages read `media.tracks.length` directly. Serving a minified item there throws inside
    render, which shows as a *blank page*, not an error — so it reads like a missing fixture rather
    than a malformed one.
24. **Read the branch before asserting the default.** `getAltViewEnabled` returns **true** when
    `deviceSettings` is absent and the stored flag otherwise, so an empty object and a missing object
    are different states. Defaults that live in a getter's guard clause are easy to invert by
    accident.

## The harness

```
test-e2e/
  playwright.config.mjs    projects, viewport, retries: 0
  scripts/serve-dist.mjs   static server for dist/, with the 200.html fallback
  support/
    fixtures.mjs           phone context, the `library` fixture, the scroll sweep
    seed.mjs               localStorage builders: device data and downloads
    routeFixtures.mjs      /api handlers, with capture provenance in the header
    dist.mjs               resolving a URL path to a file in dist/
  web/
    smoke.spec.mjs                  the build serves, boots and routes
    offline-library-parity.spec.mjs downloads offline, row vs grid
    library-filter-sort.spec.mjs    filter, sort, direction toggle
    entity-shelves.spec.mjs         series, collections, playlists
    library-switch.spec.mjs         switching library from the app bar
    switch-server.spec.mjs          the #1335 drawer -> connect journey
    shelf-layout.spec.mjs           alt view, and rotating the device
    series-books-and-scroll.spec.mjs  the series shelf, scroll restore
    auth-refresh.spec.mjs           401 -> refresh, and the failure taxonomy
    downloads-and-progress.spec.mjs downloads screens, progress bars on cards
    playback.spec.mjs               a real <audio> element playing real bytes
    home-search-detail.spec.mjs     Home tab, search, collection/playlist pages
    download-queue.spec.mjs         the indicator, driven by injected bridge events
```

### Downloads: what this tier can and cannot say

The transfer is Kotlin. `InternalDownloadManager` streams the bytes and `DownloadItemManager` runs
the queue, and **no JavaScript in this app pauses, resumes, retries or cancels a download** — the
frontend only displays events pushed over the bridge.

So every question about behaviour under a bad network — disconnects mid-body, resuming from a
partial file, a slow link that stalls and dies, validating what arrived — is answered in
`InternalDownloadManagerTest` and `DownloadIntegrityTest` against MockWebServer, where the network
can actually be reduced to its failure modes. A browser spec asserting "the queue survives a
disconnect" would be asserting that nothing happens, and would pass whether or not Android behaves.

What this tier *can* say is whether the indicator shows the right thing given the events native says
it sent. Those events are injected through `Capacitor.Plugins.AbsDownloader.notifyListeners`, which
is a real function on the web platform because `AbsDownloaderWeb` is an empty `WebPlugin` — it has
the listener machinery and no methods, which is also why a download can never be *started* here.

**Everything here is `.mjs`, and it has to be.** The package is CommonJS, so Playwright loads a `.js`
config through `require` and an ESM one fails at `exports is not defined`; and a `.js` spec is
transformed as CJS, which then cannot `import` an `.mjs` helper. One extension throughout is the only
combination that holds.

**Two ways the app gets served, deliberately.** Online specs use the HTTP server; offline specs are
served the same files through `route.fulfill`, because `setOffline(true)` blocks *all* network,
localhost included, and the bundle would never load. That is not a workaround — on a device the web
assets ship in the APK and Capacitor serves them from `http://localhost`, so they are local and
always available. What a phone loses is the *server*, which is what `setOffline` still takes away
here. `support/dist.mjs` is shared by both paths so they cannot disagree about what the app is.

**API fixtures check the offline flag themselves.** Route handlers run before the network stack, so a
fulfilled request succeeds while the browser is offline. Without that check the app authenticates
against a server it is supposed to be unable to see, and every offline spec quietly tests the online
path — which is exactly what happened on the first run here.

**Every API request is recorded**, with its query already parsed, and reachable from a spec as
`library.libraryRequests()`. The outgoing request is the assertable half of anything query-driven: a
filter or a sort is a query string long before it is a different set of cards.

### Selecting cards

There is no single card selector. `getComponentClass` picks a different component per entity
(`mixins/bookshelfCardsHelpers.js:17-22`), and each has its own id prefix:

| Shelf | Card element |
| --- | --- |
| books (grid or row) | `[id^="book-card-"]` |
| series | `[id^="series-card-"]` |
| collections | `[id^="collection-card-"]` |
| playlists | `[id^="playlist-card-"]` |

Using `book-card-` on a series shelf matches nothing, which is silent unless the assertion has a
lower bound (convention 14). Asserting *zero* `book-card-` elements on a non-book shelf is a real
assertion, though: it catches a fall-through to `LazyBookCard`, which renders something plausible
from the wrong fields.

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
# from a clone of github.com/advplyr/audiobookshelf
git worktree add ../abs-2.36.0 v2.36.0
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

**"Offline" here always means a connection that dropped**, never an app that started that way — see
the ordering constraint above. The difference matters: `init()` and the `networkConnected` watcher
are separate code paths, and this suite only ever exercises the second.

**A route handler that forgets the offline check turns an offline spec green for the wrong reason.**
It happened on the first run: the app authenticated and loaded its library while the browser was
offline, so the shelf showed the server's answer and nothing failed. If an offline spec starts
passing after a fixture change, check that the app is still actually cut off.
