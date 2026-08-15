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

**26 tests, 6 enabled failures.**

The six are the offline Library tab defect (`test/bookshelf/offline-library.spec.js`). They are red
on purpose: they state the contract, and the fix belongs on its own branch. Everything else is
green.

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
| `fakeEventBus()` / `fakeSocket()` | Record emits; let a test drive a server-push event without a server. |
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
  bookshelf/                  component tests, one file per behaviour cluster
```

`harness.spec.js` exists because every other test trusts those fakes. A fake that quietly
misbehaves should fail there rather than corrupt results elsewhere.
