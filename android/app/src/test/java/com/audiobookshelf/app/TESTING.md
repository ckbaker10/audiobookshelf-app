# Android host-JVM test suite — the single reference

This file replaces the `AI_Planning/audiobookshelf/` planning series (the
`android-test-plan`, `kotlin-android-submodule-coverage`,
`kotlin-android-coverage-next-steps`, `kotlin-android-coverage-audit-pass-{4,5,6}`,
`kotlin-android-coverage-pass-{6,7}-results`,
`github-open-issues-test-coverage-{reference,candidates}`,
`drifted-branch-regression-review` and `api-consumption-interface-audit` documents).
Everything durable from those seven passes is here. Test KDoc in this suite points
here and nowhere else.

**If you are an agent picking this up cold, read §1, §5 and §6 first.** §7 is the
work queue.

---

## 1. Rules of this branch

These are not style preferences. Every one of them exists because breaking it
already cost a pass.

1. **Host-JVM tests only.** No `src/androidTest`, no Robolectric, no emulator, no
   Espresso. Device-bound contracts are deferred deliberately, not forgotten.
2. **Production code is never changed to make a test pass.** The only production
   change this branch has ever made is a constructor default
   (`InternalDownloadManager`'s `OkHttpClient`), and only because it improved the
   design independently.
3. **A known defect lands as an *enabled failing* test, never `@Ignore`.** The
   failure count is a work queue, not a problem. Never weaken an assertion to get
   green.
4. **Assert the contract, not the observed behaviour.** For a regression spec, write
   what *should* happen and let it fail. Never catch the defect's own exception and
   assert something weaker.
5. **A test name is load-bearing documentation.** If deleting the assertion would
   leave the name still "true", the name overclaims. Fix one or the other.
6. **Record what you drop.** If a planned case turns out to be unreachable, wrong,
   or not worth it, say so in the results — silence is how two passes lost cases.
7. **Verify the caller before writing a defect spec.** A failing spec against an
   unreachable path is worse than no spec; it gets "fixed" by someone who then
   discovers the method was never reachable. Two planned specs were correctly
   downgraded to characterizations this way.
8. **A GitHub issue is evidence, not an assertion.** Capture exact inputs, expected
   result, observed result and code path in the test KDoc before enabling a failure.

### The KDoc shape every defect spec uses

```
Inputs:   the exact fixture, in the terms the report uses
Expected: the contract, and why it is the contract
Observed: what production does today
Path:     File.kt:line -> File.kt:line, the actual chain
```

---

## 2. Running it

```bash
export ANDROID_HOME=$HOME/Android/Sdk        # not set in this environment, and
                                             # android/local.properties does not exist
./android/gradlew :app:testDebugUnitTest -p android --no-daemon --rerun

# coverage (the test task fails by design, so run the report separately)
./android/gradlew jacocoDebugUnitTestReport -p android --no-daemon -x testDebugUnitTest
```

Reports: `android/app/build/reports/tests/testDebugUnitTest/index.html`,
`android/app/build/reports/jacoco/jacocoDebugUnitTestReport/`.

A single suite: `--tests "com.audiobookshelf.app.data.ProgressConflictTest"`.

Test-only build settings in `android/app/build.gradle`, each load-bearing:

| Setting | Why |
| --- | --- |
| `testImplementation "org.json:json:20231013"` | AGP's mockable `android.jar` strips `org.json` method bodies, so `JSONObject` silently returns nulls instead of parsing. Capacitor's `JSObject` extends it. |
| Java 21 `javaLauncher` for unit tests | Capacitor classes are compiled for Java 21; the app toolchain is 17. Without it, any test touching a Capacitor type throws `UnsupportedClassVersionError`. Scoped to test tasks; `assembleDebug` is unaffected. |
| `--add-opens java.base/{util,lang,math}` | PaperDb's Kryo serializer reflects into the JDK on 21+. |

---

## 3. Current state

497 tests, **46 enabled failures**, 3,225 / 7,977 lines (**40.4%**).

Coverage across passes: 9.9% → 19.9% → 27.8% → 37.9% → 40.1% → 40.4%.

| Package | Lines | Note |
| --- | ---: | --- |
| `models` | 93/93 (100%) | Complete. |
| `server` | 412/556 (74.1%) | All 24 `ApiHandler` endpoints; remainder is the keystore-bound refresh-success path. |
| `data` | 823/1,142 (72.1%) | Domain models. Best-covered large package. |
| `device` | 197/323 (61.0%) | Remainder is `FolderScanner`'s SAF half. |
| `media` | 489/933 (52.4%) | `MediaEventManager` 100%; `MediaManager` is the largest reachable gap left. |
| `plugins` | 536/1,026 (52.2%) | Remainder is `AbsFileSystem` (SAF) and `AbsAudioPlayer`'s `Handler` bodies. |
| `managers` | 441/983 (44.9%) | `InternalDownloadManager` 29/29, `DbManager` 175/185; remainder is `SleepTimerManager`/`SecureStorage`. |
| `player` | 232/2,643 (8.8%) | `PlayerNotificationService` (1,242) + `CastPlayer` (519) dominate and are blocked. |
| `services` | 2/123 (1.6%) | Foreground service; blocked. |
| root `app` | 0/155 (0%) | Activity/widget; blocked. |

**The percentage is not a quality gate and never has been.** Passes 3, 4 and 5 each
published a projection; two overshot and one undershot, and no projection ever
changed a decision. Pass 6 stopped publishing them.

---

## 4. Suite map

| Suite | Covers |
| --- | --- |
| `data/ProgressConflictTest` | Progress-conflict cluster, local direction (8 issues) |
| `data/LargeMediaBoundsTest` | Large/invalid media bounds, track/chapter indices |
| `data/CoverImageTest` | The reported cover-image crash, reader side |
| `data/PlaybackSessionTest`, `PlaybackSessionExtraTest`, `PlaybackSessionServerVersionTest` | Session timing, progress, server-version URI gating |
| `data/AudioBookModelTest`, `DeviceAndMediaTypeTest`, `ProgressAndCollectionTest`, `LocalLibraryItemTest`, `LocalMediaProgressExtraTest`, `PodcastEpisodeTest`, `ItemInProgressTest`, `LibraryHierarchyTest`, `MiscCoverageTest`, `LocalFileAndDeviceSettingsTest` | Domain models and edge inputs |
| `device/ConnectivityClassificationTest` | Connectivity-state cluster (VPN, captive portal) |
| `device/LocalMediaLifecycleTest` | Local-media-lifecycle cluster (scan identity, orphaned items) |
| `device/FolderScannerTest` | Internal-storage scan, cover adoption, re-download behaviour |
| `device/DeviceManagerVersionTest` | Server-version gating |
| `managers/DownloadIntegrityTest` | Download-integrity cluster, unknown/zero expected size |
| `managers/InternalDownloadManagerTest` | Transfer protocol: truncation, Range 206/200/416, headers |
| `managers/DownloadItemManagerTest`, `IncompleteDownloadCleanupTest` | Queue state, restore, retention |
| `managers/DbManagerPersistenceTest`, `DbManagerCleanupTest` | Paper persistence and cleanup rules |
| `media/ExternalPauseControlTest` | Pause/external-control cluster |
| `media/ServerProgressFallbackTest` | The `fix-progress-save-error` drift |
| `media/MediaProgressSyncerTest` | Syncer lifecycle: stop/pause/finished/seek/reset/sync |
| `media/MediaManagerTest`, `MediaEventManagerTest`, `IconsTest` | Aggregation, events, icon mapping |
| `player/MediaSessionCallbackTest`, `PlayerListenerTest` | Media-session and player callbacks |
| `player/BrowseTreeTest`, `CastUtilityTest`, `CastTimelineTest` | Browse tree, Cast helpers |
| `plugins/AbsDatabaseTest` | Every `AbsDatabase` method not gated behind `load()` — **see §6.1 before editing** |
| `plugins/AbsDatabaseProgressConflictTest` | Websocket progress push (kept separate; §6.1) |
| `plugins/AbsAudioPlayerTest` | The plugin surface reachable without `Handler` dispatch |
| `plugins/AbsDownloaderTest`, `AbsLoggerTest` | Download-manifest builder, logging |
| `server/ServerApiContractTest` | App↔server request contract, checked against the server source |
| `server/ApiHandlerCredentialTest` | Credential preservation across transient failures |
| `server/ApiHandlerContractTest`, `ApiHandlerEdgeCaseTest` | Endpoint shapes, failure paths, callback cardinality |
| `support/AbsTestEnvironment` | The shared harness — §5 |

---

## 5. The harness (`support/AbsTestEnvironment`)

Reach for the helper, never a fresh stub — the mockable-`android.jar` gaps are a
known list and each one was found by running a spike and reading the next NPE.

| Helper | Use it for |
| --- | --- |
| `reset()` | Repoints Paper at a fresh temp dir and clears `DeviceManager`/`MediaEventManager`/`AbsLogger` singleton state. **Call from both `@Before` and `@After`** — one Gradle JVM runs every class, so state leaks forward. |
| `mockLocalFileStatics()` | `Base64.encodeToString`, `Environment.getExternalStorageDirectory()`, `MimeTypeMap.getSingleton()`, `Uri.parse`/`fromFile`. |
| `mockUriParse()` | `Uri` stubs that retain `toString`/`scheme`/`path` (a bare relaxed mock returns empty strings). |
| `injectField(target, name, value)` | Set a `private lateinit var` a Capacitor `load()` would normally assign. Walks the class hierarchy. |
| `withStaticField(cls, name, value) {}` | Scoped override of a `public static final` field. Needed for `Build.MANUFACTURER`/`MODEL`, which the mockable jar nulls — `mockkStatic` cannot help, a field read is `getstatic`, not a method call. Always the scoped form; the raw setter leaked across classes in a prior pass. |
| `withSdkInt(n) {}` | `Build.VERSION.SDK_INT` reads **0** by default, silently pinning every untouched test to pre-28 branches. |
| `apiHandler(ctx)` | An `ApiHandler` wired to a mock `Context`; construction alone exercises `SecureStorage`. |
| `withMockServer {}` | `MockWebServer` + `DeviceManager.serverConnectionConfig`, torn down automatically. Currently used by almost nothing — see §7.3. |

`AbsTestEnvironment` registers a JCA provider named `AndroidKeyStore` backed by JKS,
because `SecureStorage`'s property initializer calls `KeyStore.getInstance("AndroidKeyStore")`
at construction.

Paper caches `Book` instances in a static map keyed by name, so `reset()` also
clears `Paper.mBookMap` by reflection — without it a book opened by the first test
class keeps writing that class's temp directory for the whole run. This was found by
an actual cross-test leak, not speculation.

---

## 6. Blocked list — what the host JVM cannot reach

Confirmed empirically, not assumed. Do not re-chase these.

### Android stubs that silently return null / no-op

| Surface | Behaviour |
| --- | --- |
| `Looper.getMainLooper()` | Returns null, so `Handler(...).post {}` **returns false and never runs the body**. This is the single biggest blocker in the suite. |
| `android.os.Bundle` | No working `put`/`get`. Any contract whose only observable is "what went into a Bundle" is untestable. |
| `SparseArray` / `SparseIntArray` | `get(key, default)` returns null regardless of the default or prior `put`. Blocks `CastTimeline`/`CastTimelineTracker`. |
| `Build.VERSION.SDK_INT` | Reads `0` — use `withSdkInt`. |
| `Build.MANUFACTURER` / `MODEL` | Null — use `withStaticField`. |
| `Settings.Secure.getString(..., ANDROID_ID)` | Null. A static *method*, so `mockkStatic` works. Blocks `ApiHandler.sendSyncLocalSessions` until stubbed. |
| `android.icu.text.DateFormat.getDateInstance()` | Null. |
| `org.json.JSONObject` | Method-stripped — **fixed** by the real `org.json` jar on the test classpath. |
| `android.net.Uri` | Same problem, no drop-in replacement — use `mockUriParse()`. |

### Classes that stay unreachable

* `player/PlayerNotificationService` (1,242 lines) and `player/CastPlayer` (519) —
  Android `Service`/ExoPlayer lifecycle.
* `managers/SleepTimerManager` (209) — live service plus main-looper `Handler`. **Its
  consumers are not blocked**: `AbsAudioPlayer`'s sleep-timer methods test fine with
  the manager mocked.
* `plugins/AbsFileSystem` (122) and `FolderScanner`'s external/SAF half — SAF.
* `SecureStorage`'s crypto path (46 of 57) — `KeyGenParameterSpec` is a stub; the JCA
  double cannot supply it.
* `MainActivity`, `MediaPlayerWidget`, `DownloadService`/`DownloadServiceHost`.
* `ApiHandler`'s 401 → refresh → **retry-success** path — needs a real `AndroidKeyStore`.
  The failure branches are covered.
* **Twelve of `AbsAudioPlayer`'s seventeen `@PluginMethod`s** — they wrap the
  delegation *and* the `call.resolve` in `Handler(Looper.getMainLooper()).post {}`, so
  they return without throwing while doing nothing. A `verify` would fail; a
  "did not throw" assertion would pass vacuously forever. Write neither.
* `MediaSessionCallback.handleMediaButtonClickCount` and
  `MediaProgressSyncer.start`'s 15-second tick body — `Timer`/`Handler` bound.

### 6.1 The `AbsDatabaseTest` landmine — read before editing that file

**Adding any test to `plugins/AbsDatabaseTest` can deterministically break two
unrelated tests in it.** Its two `setCurrentServerConnectionConfig` "new config"
tests are the only ones there that reach `DeviceManager.getBase64Id`, so the only
ones depending on `mockLocalFileStatics()`'s `mockkStatic(Base64::class)` being live.

Probing `Base64.encodeToString` from that class's `@Before` shows the stub returning
its mocked value in all 40 tests as the class stands, and `null` in all 43 once three
tests are added — the static mock goes inert **for the whole class, before any test
body runs**, and `setCurrentServerConnectionConfig`'s `GlobalScope.launch(Dispatchers.IO)`
body then dies on an NPE and never resolves its call, surfacing as a 5-second timeout
in a test that has nothing to do with the change.

Bisected: **not** ordering (`@FixMethodOrder(NAME_ASCENDING)` does not help), **not**
test count (a trivial extra `@Test` is harmless), **not** the content of the added
tests (the same cases under different method names leave the mock working). The
trigger is name-dependent and reproducible; the mechanism inside MockK was not
identified. `AbsDatabaseProgressConflictTest` exists as a separate class for exactly
this reason.

Remediation in §7.3.

### 6.2 `MediaProgressSyncer.start()` leaks a thread — do not call it

`start()` schedules on `Timer("ListeningTimer", false)` — `false` is `isDaemon`, so it
is a **non-daemon** thread on a 15-second repeat. Neither `reset()` nor `pause()`
reaps it (both cancel the `TimerTask`, not the `Timer`), so every test that calls it
leaks a thread for the rest of the JVM and enough of them can stop the Gradle test JVM
from exiting. Its body posts to a main-looper `Handler`, so it never executes anyway —
`start()` buys almost no coverage for its cost.

`listeningTimerRunning` is a public `var`: set it directly to reach the branches that
matter. `ExternalPauseControlTest` and `MediaProgressSyncerTest` both do this.

---

## 7. Known remediations

### 7.1 Production fixes, ordered by (impact ÷ effort)

Each one turns listed enabled failures green. **They belong on a fix branch, not
here.** Line numbers are against the revision these tests were written for; confirm
before editing.

| # | Fix | Where | Frees |
| --- | --- | --- | ---: |
| 1 | Guard the write: `if (playbackSession.updatedAt <= lastUpdate) return`. Currently `currentTime`, `progress`, `lastUpdate` are all assigned unconditionally, so a stale session overwrites newer data *and drags `lastUpdate` backwards*, poisoning every later server reconciliation. | `LocalMediaProgress.updateFromPlaybackSession` (`:59`) | 3 |
| 2 | Clamp: `(currentTime / getTotalDuration()).coerceIn(0.0, 1.0)`, plus a NaN guard for zero duration. An unclamped `5.0` both persists and flips `isFinished` (`>= 0.99`). | `PlaybackSession.progress` (`:83`) | 3 |
| 3 | `(audioTracks.size - 1).coerceAtLeast(0)` in both index helpers, and guard the three indexers that use them. Empty track list currently yields **-1**, and `audioTracks[-1]` throws out of a queue-navigation helper. Sibling `getTrackStartOffsetMs` already guards exactly this. | `PlaybackSession.getCurrentTrackIndex`/`getNextTrackIndex` (`:90`, `:100`) | 3 |
| 4 | Add the missing `else` branch (`call.resolve` with an error) when the local item is not found, and make `it.media as Podcast` a safe cast. Today a missing record resolves **zero** times — the JS promise hangs forever — and an episode id sent for a book throws `ClassCastException`. | `AbsAudioPlayer.prepareLibraryItem` (`:222`, `:225`) | 2 |
| 5 | Treat 401 from `/auth/refresh` as terminal and **IO/5xx as retryable**. The server distinguishes these (it returns 401 specifically for an invalid refresh token, `server/Auth.js:340,348`), so the app can too. Also reorder: read `serverConnectionConfigId` *before* nulling the config — as written, `removeRefreshToken` is never reached. | `ApiHandler.handleTokenRefresh` (`:216`, `:224`), `handleRefreshFailure` (`:390`) | 2 |
| 6 | Add `TRANSPORT_VPN`, and require `NET_CAPABILITY_INTERNET`/`VALIDATED` rather than transport alone. A VPN reads as offline; a captive portal reads as online. | `DeviceManager.checkConnectivity` (`:155`) | 2 |
| 7 | Validate when `expectedSize <= 0` — at minimum reject a `Content-Encoding` other than `identity` and a `Content-Type` that cannot be the requested file. Today there is **no** integrity check on that path, so an HTML error page and a gzip stream are both accepted as the file. `fileSize = 0` is the production default for cover parts. | `InternalDownloadManager` (`:98`) | 2 |
| 8 | Compare `lastUpdate` before applying, as the sibling caller `ApiHandler.syncLocalMediaProgressForUser` (`:825`) already does. | `AbsDatabase.syncServerMediaProgressWithLocalMediaProgress` (`:368`) | 1 |
| 9 | Pass `progress >= 0.99` instead of a hard-coded `false`. A book finished on first listen (no prior record) persists as *not finished*; the existing-record branch gets this right, so the two branches disagree. | `PlaybackSession.getNewLocalMediaProgress` (`:433`) | 1 |
| 10 | Do not move `currentTime` backwards. A delayed external pause rewinds an already-saved later position; nothing serialises the media session, player listener and 15-second timer against each other. | `PlaybackSession.syncData` (`:420`) | 1 |
| 11 | Add a `length() > 0` check — the only guard today is `File.exists()`, and a zero-byte cover exists. Root cause of the reported cover-image crash. | `FolderScanner.createLocalFile` (`:25`) | 1 |
| 12 | Remove (or flag) an item once `checkHasTracks()` is false. A server-linked item that has lost every file is written back emptied and stays selectable in the library and Android Auto tree. The needed information is already computed. | `DbManager.cleanLocalLibraryItems` (`:222`) | 1 |
| 13 | Percent-encode the query. An enabled spec demonstrates query-parameter injection; apply the same reserved-character matrix to IDs and filters. | `ApiHandler.getSearchResults` (`:598`) | 1 |
| 14 | Propagate `ServerConnectionConfig.customHeaders` — they are configured, stored, and never sent, by either JSON requests or downloads. Matters for reverse proxies and identity-aware gateways. | `ApiHandler`, `InternalDownloadManager` | 1 |
| 15 | Catch deserialization failure and invoke the callback with an error. Valid JSON of an unexpected shape currently drops the callback entirely, which reads as a hang. | `ApiHandler.makeRequest` | 1 |
| 16 | Guard the cover-resolution chain (four call sites: `LocalLibraryItem.getMediaDescription`/`getCoverUri`, `PlaybackSession.resolveCoverBitmapAsync`/`getCoverUri`). One missing guard; a fix must also still invoke `onArtResolved`, or the crash becomes a spinner that never clears. | `LocalLibraryItem`, `PlaybackSession` | 5 |

Smaller model fixes, each freeing one spec: initialize an absent track collection in
`Book.addAudioTrack`; accept tracks when a podcast's episode list is null; normalize
case/whitespace/parameters in audio-MIME and ebook-format detection (2); guard
malformed sleep-timer strings (2); book progress must not match an episode on the same
library item; tolerate empty series metadata and a missing author collection; stop
force-casting every collection item to `Book`; keep progress percentages in 0–100;
reject a negative download-queue limit. Four `MediaManager` cache/filter defects
(including one that caches under a key its own lookup never reads, so every call
re-fetches) are documented in that suite's KDoc.

### 7.2 Characterized, deliberately *not* enabled failures

Do not "fix" these without a decision — the tests pin current behaviour so a change is
visible, and each has a reason:

* **`LocalMediaProgress.updateFromServerMediaProgress`** is unguarded, but one of its
  two callers guards it. The defect spec lives against the *unguarded* caller
  (`AbsDatabase`, remediation 8); the method's own behaviour is pinned.
* **`MediaProgressSyncer.syncFromServerProgress`** has no comparison, but its only
  caller (`PlayerNotificationService:882`) guards on the same object it mutates, so an
  older record cannot reach it. Two facts worth keeping: the `// Currently unused`
  comment above it is **stale** — it *is* called — and the guard lives in the caller,
  so any future second caller inherits no protection.
* **Server-item offline progress.** Master's recovery is *queue-based*: the session is
  persisted every sync attempt and flushed on reconnect, so the position is **not
  lost**. A downloaded item writes `LocalMediaProgress` immediately, so the two media
  types differ offline. Making server progress visible offline is a product decision.
* **Local item identity ignores the server** (`local_${libraryItemId}`), so two servers
  sharing an item id collide on one record. Changing the scheme would orphan every
  record already on disk.
* **`cancelSleepTimer` resolves outside its `Handler` post**, unlike its eleven
  siblings — a sequencing quirk on device, and the reason that one method is
  observable here at all.
* **`pause` and `finished` return without invoking their callback** when nothing is
  playing, unlike `stop`. A caller that awaited them would hang.

### 7.3 Test-infrastructure remediations (all easy, all in this suite)

1. **Add `Settings.Secure.getString` to `mockLocalFileStatics()`.** Newly found; it
   blocks `sendSyncLocalSessions` and every caller. One `mockkStatic` line.
2. **Defuse the `AbsDatabaseTest` landmine (§6.1).** Cheapest useful step, independent
   of root cause: assert in `@Before` that the `Base64` stub is live, so the failure is
   immediate and legible instead of a 5-second timeout in an unrelated test. Better:
   stop depending on a static mock inside a `GlobalScope` coroutine.
3. **Extract a shared `AbsSingletonTest` base class or JUnit `@Rule`** for the
   `reset()` in `@Before`/`@After` pair. This fix has now been re-derived by hand three
   passes running, and was applied to two suites in one pass and the other seven in the
   next.
4. **Adopt or drop `withMockServer`.** The harness's headline helper is used by almost
   nothing; both `ApiHandler` suites re-implement it inline.
5. `reset()` returns a `File` no caller uses.

---

## 8. Traps that have actually bitten

* **`?.x() != false` is a null-accepting assertion.** `uri?.contains("x") != false` is
  `true` when `uri` is null. One shipped in the very pass that was auditing for this
  defect class. `== true` is safe. Ask of every assertion: *would this still pass if
  the method returned `null`, `0`, `""`, or an empty list?*
* **A green test named after a bug.** The worst finding of the series: an assertion
  written around observed behaviour instead of the desired contract, which would go
  green on a *wrong* fix.
* **`assertNull(thrown)` alone under-tests.** "Does not crash" and "still tells the UI
  it finished" are different contracts, and only the second clears a spinner.
* **Constants inline; fields do not.** `NetworkCapabilities.TRANSPORT_*` and
  `NET_CAPABILITY_*` are compile-time constants and work correctly on both sides.
  `Build.VERSION.SDK_INT` is a real field read and returns 0.
* **When an Android stub blocks a contract, document the gap in the class KDoc rather
  than asserting around it.** `PodcastEpisodeTest` is the model: four sentences on why
  `Bundle` extras are not covered, worth more than four assertions that would have
  passed vacuously (one of them against a constant whose value is `0`).
* **Reachability claims need a spike, not a reading.** `AbsAudioPlayer` was tagged
  "verified" on a spike that only proved a method *returned without throwing* — the
  `Handler` body never ran. `FolderScanner` and `AbsDownloader` sat on the blocked list
  for two passes while being fully reachable.

---

## 9. Where the remaining risk is

Ranked by user impact, not by uncovered line count.

1. **`PlayerNotificationService` (1,242 lines, 1 covered).** The largest single risk in
   the app and structurally unreachable here. It needs either a policy extraction or a
   device suite; nothing else will move it.
2. **The five Priority-B issue clusters** — playback interruption, media-control state,
   download destination, Android Auto tree, startup state. All are blocked on
   *extracting a policy object* from a service or plugin, which is a production change.
   They are blocked on a refactor decision, not on technique.
3. **Cross-repository contract drift.** `ServerApiContractTest` pins the app's request
   shapes against the server source, but responses are still hand-written fixtures on
   this side — they stay green after the server changes a serializer, field type or
   status. Server-produced golden fixtures are the known answer.
4. **`MediaManager`** (288 missed of 510) — the largest *reachable* gap left.
5. **Transport policy is triplicated** — Nuxt Axios, Capacitor HTTP and native OkHttp
   each implement auth, refresh, retry and parsing differently, and only the Kotlin one
   has coverage. The JS client has no test setup at all.

---

## 10. History, condensed

| Pass | What it did | End state |
| --- | --- | ---: |
| 1–2 | Domain models, download state, Cast utilities. Found the `SparseArray`/`org.json` stub limits. | 19.9% |
| 3 | Overturned "needs production seams first": `Paper.init()` with a mocked `Context` unlocked the whole `DeviceManager`/`DbManager`/`ApiHandler`/Capacitor stack. Built `AbsTestEnvironment`. | 27.8% |
| 4 | Audited pass 3 — found a false green and three overclaiming names. Added `MediaSessionCallback`/`PlayerListener` (overturning "`player` is fully Android-bound"), `DownloadItemManager`, `AbsDatabase`. | 37.9% |
| 5 | Audited pass 4. Delivered the reported cover-image crash as failing specs traced to one missing guard; took `FolderScanner`'s internal path and `AbsDownloader` off the blocked list. | 37.9%, 376 tests |
| 6 | First pass driven by open GitHub issues rather than coverage percentage. Progress-conflict cluster (8 issues), credential preservation, media bounds, `AbsAudioPlayer`. Corrected two plan items after checking production. | 40.1%, 438 tests |
| 7 | Completed every remaining Priority-A cluster: connectivity, download integrity, external pause, local-media lifecycle. Verified the drift review's claims and the app↔server API contract. | 40.4%, 497 tests |

Each pass audited its predecessor and found real defects in it. That is the series'
main quality mechanism — keep it.

---

## 11. Issue-cluster and drift status

All seven Priority-A clusters from the open-issue review now have suites (§4): progress
conflict, auth/transient HTTP, large/invalid media, pause/external control, connectivity
state, download integrity, local-media lifecycle. That is 29 distinct issues (28 across the
seven clusters, plus #1817), of the 52 reviewed.
Priority B (five clusters) is deferred per §9.2.

Drifted branches:

| Branch | Status |
| --- | --- |
| `fix-progress-save-error` | Claim verified; master's recovery is queue-based, so the position is not lost. Downgraded to an optional UI improvement. |
| `fix-download-corrupt-network-switch` | Download half complete (`InternalDownloadManager` 29/29). Connectivity/requeue half needs injectable seams. |
| `fix-telephone-pause` | Not host-testable; master delegates audio focus to ExoPlayer. Needs a policy extraction. |
| `fix-save-password` | Needs Android Credential Manager. Not meaningful as a host-JVM test. |
| `add-logging-option-settings` | Feature addition, not a correctness repair. |
| `fix-download-issue` | Superseded by the master download overhaul. Do not port. |

App↔server API: **no drift.** All 21 endpoints the client calls exist on the server
(`audiobookshelf` at `1b46d680`) with matching verbs, pinned by `ServerApiContractTest`.
One known response-type mismatch remains: `GET /ping` returns `{"success": true}` and
`ApiHandler.pingServer` reads it with `getString`, which an enabled spec records.
