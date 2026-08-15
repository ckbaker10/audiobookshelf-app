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

**235 tests, 29 enabled failures.**

Every failure is a contract that production does not currently meet. They are red on purpose: they
state what should happen, and each fix belongs on its own branch.

Reported upstream issues:

| Issue | Spec | Red |
| --- | --- | ---: |
| [#542](https://github.com/advplyr/audiobookshelf-app/issues/542) offline Library tab | `bookshelf/offline-library.spec.js` | 6 |
| [#1711](https://github.com/advplyr/audiobookshelf-app/issues/1711) / [#1712](https://github.com/advplyr/audiobookshelf-app/issues/1712) detail page survives a library switch | `navigation/library-switch-detail-pages.spec.js` | 6 |
| [#1335](https://github.com/advplyr/audiobookshelf-app/issues/1335) Switch Server/User disconnects | `navigation/switch-server-user.spec.js` | 4 |
| [#1274](https://github.com/advplyr/audiobookshelf-app/issues/1274) OpenID demands HTTPS for the ABS server | `connection/openid-transport-policy.spec.js` | 3 |
| [#1870](https://github.com/advplyr/audiobookshelf-app/issues/1870) Collections keeps the previous tab's count | `bookshelf/collections-state.spec.js` | 2 |

Found by scanning, with no issue filed:

| Defect | Spec | Red |
| --- | --- | ---: |
| A transient failure during token refresh logs the user out and clears the refresh token - the JS twin of Android #1908/#1900, still unfixed here | `plugins/native-http.spec.js` | 3 |
| `$sanitizeFilename` throws `ReferenceError: Path is not defined` for any name over 240 chars - `Path` is never imported | `plugins/sanitize-helpers.spec.js` | 1 |
| `$secondsToTimestampFull` renders `00:00:60`, rounding seconds before deriving minutes so the carry never happens | `plugins/format-helpers.spec.js` | 1 |
| `TouchEvent.getSwipeDirection()` throws when the end event has not arrived - the null guard sits after the dereference it protects | `objects/touch-event.spec.js` | 1 |
| A download queued with already-complete parts shows 0%, because progress is only ever derived when a part *changes* | `store/download-queue.spec.js` | 2 |

The other 206 are green: the harness's own tests, the Home shelf characterization, the guards
inside each defect file that pin the working path a fix must not break, and behaviour and
edge-case coverage for the pure helpers, store actions/getters, mixins and `TouchEvent`.

If you change the suite, re-run it and update these numbers from the run.

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
| `flush()` | Drains pending promises, then Vue's render queue. |

`$strings` returns the key itself, not a translation. Tests assert *which* string was chosen —
asserting the English text would make every test a hostage of `strings/en-us.json`.

## What the host DOM cannot do

`happy-dom` reports every element as zero-sized. `LazyBookshelf.initSizeData()` derives
`entitiesPerShelf` and `shelvesPerPage` from `clientWidth`/`clientHeight`, so left alone the shelf
collapses and no card is ever mounted.

That makes render-level assertions on mounted cards **vacuous** — they would pass whether or not
the data arrived. So `offline-library.spec.js` stubs the measurement and asserts on the data layer
(`entities`, `totalEntities`, the `bookshelf-total-entities` event) instead. That is the layer the
defect lives in, and the empty-state block is driven by `entities.length` anyway.

Asserting on mounted card components here would be testing happy-dom's layout engine, not this app
— the frontend equivalent of the `Handler(Looper.getMainLooper())` trap documented in the Android
guide, where a test can look like it exercises code that never ran.

If you need real layout, that is a browser-based test (Playwright/Cypress) and a different tool.
Do not fake your way to a number and assert on it.

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
  measurements to mean anything.
- iOS, and anything device-bound.
- The Capacitor bridges themselves. `plugins/db.js` is a thin pass-through to native code that the
  Android suite covers from the other side.

## Layout

```
test/
  support/harness.js          the fakes and the mount helper
  support/harness.spec.js     smoke tests for the harness itself
  support/initPlugin.js       loads plugins/init.client.js with native seams mocked
  bookshelf/                  shelf and library-view state
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
