# Frontend tests

Component tests for the Vue/Nuxt half of the app. Read this before adding or changing anything in
`test/`.

The Android suite's guide is `android/app/src/test/java/com/audiobookshelf/app/TESTING.md`. The
philosophy is shared and is not restated here — this file covers what is different on the frontend.

```bash
npm test              # once
npm run test:watch    # watch mode
npm test -- test/bookshelf/offline-library.spec.js
```

## Current state

**278 tests, 5 failures.** The fix queue is `bookshelf/offline-library-parity.spec.js`.

Offline, the row (list) view reaches fewer downloads than the catalogue (grid) view — 9 of 24
against 10 of 24 at a phone viewport, neither being the whole library. Two mechanisms, described in
that file's KDoc: `scroll()` returns early with no session, and scrolling *with* a cached session
fires a request that cannot succeed and re-mounts the first window on top of the scrolled one. The
fix belongs on `fix-offline-library-parity`.

Zero failures is the target, not a permanent state: a newly found defect *should* make this number
non-zero until its fix lands. If the suite is red, the failing specs' KDoc says what is outstanding.

Every one of the 29 failures this suite was built around has been fixed and the specs went green
with their assertions untouched — five reported upstream issues (#542, #1711/#1712, #1335, #1274,
#1870) and five defects found by scanning, including a transient-refresh logout that was the
JavaScript twin of Android #1908/#1900/#1901.

One of those fixes then produced a regression the suite could not see, because the spec covered
only the component that was changed: #1335 stopped "Switch Server/User" from logging out, and
`ServerConnectForm`'s untouched auto-connect re-authenticated the surviving session and redirected
to the shelf, so the switch looked inert. `navigation/switch-server-connection-screen.spec.js`
covers the arrival side. When a fix moves a responsibility between components, the spec has to
follow it there.

If you change the suite, re-run it and update this number from the run.

## Conventions

1. **Component tests, not e2e.** Mount a component with fake plugins, assert what it renders and
   what it asks for. No running Nuxt server, no browser, no device. Same reasoning as the Android
   suite's host-JVM rule.
2. **A known defect is an enabled failing test, never `.skip`.** The failure count is the fix
   queue.
3. **Assert the contract, not the observed behaviour.** Write what *should* happen and let it fail.
4. **Do not change production code to make a test pass.**
5. **Test names are load-bearing.** If deleting the assertion would leave the name still "true",
   the name overclaims.

## The harness (`test/support/harness.js`)

The rule that shapes all of it: **a fake either returns something a test explicitly asked for, or
throws.** Nothing no-ops.

That matters more here than in most codebases. `$db` is a Capacitor bridge with no implementation
off-device, and the first defect this suite was written for is a *swallowed* failure — so a fake
that quietly returns `undefined` would reproduce the bug inside the test framework.

| Helper | Use |
| --- | --- |
| `mountComponent(component, opts)` | Mounts with the injected plugins Nuxt provides (`$db`, `$nativeHttp`, `$store`, `$eventBus`, `$socket`, `$strings`, `$router`, …). Unconfigured ones throw on use. |
| `fakeDb({ localLibraryItems, localMediaProgress })` | Stands in for `plugins/db.js`. Filters by media type as the real bridge does, and records `calls` so "was local storage consulted at all?" is assertable. |
| `fakeNativeHttp({ responses })` | **Rejects by default.** A test that forgets to queue a response models the offline case rather than an accidental success. Records `requests`. |
| `storeWith({ user, networkConnected, currentLibraryId, localMediaProgress })` | Vuex store with the real shape. Those four inputs decide nearly every branch worth testing. |
| `fakeEventBus()` / `fakeSocket()` | Record emits, expose `listenerCount(event)`, and let a test drive a server-push event without a server. |
| `fakeRouter()` | Records `push`/`replace` instead of navigating. Recorded rather than throwing, because "did **not** navigate" is a contract too. |
| `fakeLocalStore()` | Capacitor Preferences, backed by a real object so a write is visible to a later read. Records every call. |
| `stubShelfGeometry(vm, dims)` | Replaces `LazyBookshelf.initSizeData()` with fixed dimensions, **keeping** the list-view branch (`entitiesPerShelf = 1`). Do not use it in a spec that is about geometry — define `clientWidth`/`clientHeight` and let the real method run. |
| `flush()` | Drains pending promises, then Vue's render queue. |

`$strings` returns the key itself, not a translation. Tests assert *which* string was chosen —
asserting the English text would make every test a hostage of `strings/en-us.json`.

## What the host DOM cannot do

`happy-dom` reports every element as zero-sized. `LazyBookshelf.initSizeData()` derives
`entitiesPerShelf` and `shelvesPerPage` from `clientWidth`/`clientHeight`, so left alone the shelf
collapses and no card is ever mounted.

Tests that exercise shelf virtualization must therefore define the container dimensions they need
and assert the app's calculations and resulting DOM, not happy-dom's layout engine. Use realistic
phone dimensions and keep the boundary explicit in the spec. A browser-based test is still needed
for CSS layout, route transitions, or visual geometry that the DOM host does not calculate.

**A data-layer assertion cannot tell you the screen is right.** `entities` and `totalEntities` were
correct while the offline Library tab rendered nothing but a red notice: putting a card on screen
is a separate step, and `mountEntityCard` looks its shelf row up with
`document.getElementById('shelf-N')` and returns early - logging, not throwing - when it is absent.

`mountComponent(..., { attachTo: document.body })` makes that layer reachable, and
`entityIndexesMounted` is the honest proxy for "the row was found", because an index is recorded
only after the lookup succeeds. Clear `document.body` in `afterEach` when you use it: those
assertions are document-wide, so a leftover row from a previous test would satisfy them.

Cards are built programmatically with `new ComponentClass()`, outside the test-utils tree. They
must be created with the shelf as `parent`; this supplies the real Vue/Vuex context during their
first render. A render error here is not a harmless harness limitation: it reproduced the app's
initial offline-library failure, where `$nuxt` was not available yet and toggling list/grid only
appeared to fix the shelf because replacement cards were created later. The harness therefore
includes the store getters those cards use and render-level specs assert the actual card DOM.

## Characterization vs. defect spec

Much of the pure-helper coverage pins behaviour that is odd but arguably intended. The rule used
here:

- **Defect spec** - the result is indefensible for any caller (a `ReferenceError`, an invalid
  timestamp). Enabled and failing, with inputs/expected/observed in the KDoc.
- **Characterization** - the result is surprising but no caller is known to be harmed, or the
  intent is genuinely ambiguous from the code. Passing, labelled `(characterization)` in the name,
  with the reasoning in the comment so nobody "fixes" it by accident.

Examples of the second kind currently pinned: `$bytesPretty(-1024)` is `'NaN undefined'`;
`$secondsToTimestamp(-90)` is `'-1:58:30'`; `$sanitizeSlug`'s invalid-character class contains an
accidental range (`-` between a space and `_` is 0x20-0x5F) so it admits `+`, `(`, `)` and `.`;
`isValidVersion('2.17.0-beta', '2.17.1')` is `true`, matching the Android client's equivalent.

When in doubt, prefer a characterization and say why. A wrong defect spec sends someone to change
working code.

## Two ways these tests can lie, and how they are avoided

Both were hit while writing the current specs, so they are not hypothetical.

**A stubbed-out action makes a state assertion vacuous.** `switch-server-user.spec.js` asserts the
user survives a screen change. If the test's `user/logout` merely recorded the call, the assertion
would pass because nothing *could* have cleared the state - not because production chose to keep
it. The fake therefore performs the same clearing `store/user.js` performs.

**A side-effect assertion is vacuous while the subscription does not exist.** "Removes its
listener on destroy" passes trivially when there is no listener: destroy changes nothing either
way, so it stays green both today and after a fix that forgets to clean up. Assert
`$eventBus.listenerCount(event)` directly instead.

Before writing an assertion, ask what would have to be true for it to fail. If the answer is
"nothing that could plausibly happen", it is not a test.

## Deliberately not covered

- `LazyBookshelf`'s virtualised-scroll machinery — roughly 500 lines of geometry that needs real
  measurements to mean anything. **Partly covered now:** `offline-library-parity.spec.js` supplies
  the measurements instead of stubbing past them (`clientWidth`/`clientHeight` plus
  `window.innerWidth`, which `bookWidth` reads separately) and drives real scroll events through
  `#bookshelf-wrapper`. That reaches the index arithmetic. It does not reach CSS layout, so whether
  a mounted card is *visible* is still a browser question.
- iOS, and anything device-bound.
- The Capacitor bridges themselves. `plugins/db.js` is a thin pass-through to native code that the
  Android suite covers from the other side.

## Layout

```
test/
  support/harness.js          the fakes and the mount helper
  support/harness.spec.js     smoke tests for the harness itself
  support/initPlugin.js       loads plugins/init.client.js with native seams mocked
  bookshelf/                  shelf and library-view state, incl. offline behaviour
  navigation/                 routing and lifecycle across screens
  connection/                 server connection and auth
  plugins/                    pure helpers and the nativeHttp request/refresh path
  store/                      Vuex actions, getters and mutations, called directly
  mixins/                     mixin methods, called with an explicit `this`
  objects/                    plain classes
```

One file per issue or behaviour cluster, named for what it covers rather than for the component it
mounts - several specs mount `LazyBookshelf` for unrelated reasons.

`harness.spec.js` exists because every other test trusts those fakes. A fake that quietly
misbehaves should fail there rather than corrupt results elsewhere.
