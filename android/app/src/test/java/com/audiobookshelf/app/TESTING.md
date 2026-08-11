# Android host-JVM test suite — working guide

Read this before adding or changing tests in `android/app/src/test`. It covers the
conventions the suite follows, the shared harness, what the host JVM genuinely
cannot reach, and the defects the suite currently documents.

`android/TESTING.md` covers environment setup and is the shorter entry point. This
file is the detail.

**Arriving cold? Read §1, §5 and §6 first.** §7 is the open work.

---

## 1. Conventions

These are not style preferences. Each one exists because breaking it produced a
test that looked fine and proved nothing.

1. **Host-JVM tests only.** No `src/androidTest`, no Robolectric, no emulator, no
   Espresso. Device-bound contracts are deferred deliberately, not forgotten; §6
   says which ones and why.
2. **Do not change production code to make a test pass.** If a test needs a seam,
   the seam has to be justifiable as a production improvement on its own.
3. **A known defect is an *enabled failing* test, never `@Ignore`.** The suite is
   red on purpose. The failure count is the fix queue. Never weaken an assertion
   to get green — a candidate fix succeeds when its spec goes from failing to
   passing with the assertion untouched.
4. **Assert the contract, not the observed behaviour.** Write what *should*
   happen and let it fail. Never catch the defect's own exception and then assert
   something weaker; that produces a test that would also pass if the bug were
   fixed wrongly.
5. **Test names are load-bearing documentation.** If deleting the assertion would
   leave the name still "true", the name overclaims. Fix one or the other.
6. **Record what you drop.** If a planned case turns out to be unreachable, wrong,
   or not worth it, say so in the PR. Silence is how cases get lost between plan
   and implementation.
7. **Verify the caller before writing a defect spec.** A failing spec against an
   unreachable path is worse than no spec: someone "fixes" it and then discovers
   the method was never reachable. Two specs in this suite were correctly
   downgraded to characterizations this way — see §7.2.
8. **A GitHub issue is evidence, not an assertion.** Capture exact inputs,
   expected result, observed result and the code path in the test KDoc before
   enabling a failure.

### The KDoc shape every defect spec uses

```
Inputs:   the exact fixture, in the terms the report uses
Expected: the contract, and why it is the contract
Observed: what production does today
Path:     File.kt:line -> File.kt:line, the actual chain
```

Characterization tests — ones that pin current behaviour rather than assert a
contract — say so explicitly and explain why, so nobody "fixes" something that was
deliberately recorded.

---

## 2. Running the tests

Prerequisites and SDK setup are in `android/TESTING.md`. In short: JDK 21, Node 20,
Android SDK Platform 35 with Build-Tools 35.0.0, and `ANDROID_HOME` set.

```bash
./android/gradlew :app:testDebugUnitTest -p android --no-daemon --rerun

# Coverage. The test task fails by design, so run the report separately.
./android/gradlew :app:jacocoDebugUnitTestReport -p android --no-daemon -x testDebugUnitTest
```

One suite: `--tests "com.audiobookshelf.app.data.ProgressConflictTest"`.

Reports land in `android/app/build/reports/tests/testDebugUnitTest/index.html` and
`android/app/build/reports/jacoco/jacocoDebugUnitTestReport/`.

Test-only build settings in `android/app/build.gradle`, each load-bearing:

| Setting | Why |
| --- | --- |
| `testImplementation "org.json:json"` | AGP's mockable `android.jar` strips `org.json` method bodies, so `JSONObject` silently returns nulls instead of parsing. Capacitor's `JSObject` extends it. |
| Java 21 `javaLauncher` for unit tests | Capacitor classes are compiled for Java 21; the app toolchain is 17. Without it, any test touching a Capacitor type throws `UnsupportedClassVersionError`. Scoped to test tasks, so `assembleDebug` is unaffected. |
| `--add-opens java.base/{util,lang,math}` | PaperDb's Kryo serializer reflects into the JDK on 21+. |

---

## 3. Current state

497 tests, **46 enabled failures**, 3,225 / 7,977 lines (**40.4%**).

| Package | Lines | Note |
| --- | ---: | --- |
| `models` | 93/93 (100%) | Complete. |
| `server` | 412/556 (74.1%) | All 24 `ApiHandler` endpoints; remainder is the keystore-bound refresh-success path. |
| `data` | 823/1,142 (72.1%) | Domain models. Best-covered large package. |
| `device` | 197/323 (61.0%) | Remainder is `FolderScanner`'s SAF half. |
| `media` | 489/933 (52.4%) | `MediaEventManager` 100%; `MediaManager` is the largest reachable gap. |
| `plugins` | 536/1,026 (52.2%) | Remainder is `AbsFileSystem` (SAF) and `AbsAudioPlayer`'s `Handler` bodies. |
| `managers` | 441/983 (44.9%) | `InternalDownloadManager` 29/29, `DbManager` 175/185; remainder is `SleepTimerManager`/`SecureStorage`. |
| `player` | 232/2,643 (8.8%) | `PlayerNotificationService` (1,242) and `CastPlayer` (519) dominate and are blocked. |
| `services` | 2/123 (1.6%) | Foreground service; blocked. |
| root `app` | 0/155 (0%) | Activity/widget; blocked. |

**The percentage is not a quality gate.** Ratchet per-package thresholds if you want
a gate; a global number mostly measures how much Android-bound code exists.

---

## 4. Suite map

| Suite | Covers |
| --- | --- |
| `data/ProgressConflictTest` | Progress-conflict cluster, local direction |
| `data/LargeMediaBoundsTest` | Large/invalid media bounds, track and chapter indices |
| `data/CoverImageTest` | The reported cover-image crash, reader side |
| `data/PlaybackSessionTest`, `PlaybackSessionExtraTest`, `PlaybackSessionServerVersionTest` | Session timing, progress, server-version URI gating |
| `data/AudioBookModelTest`, `DeviceAndMediaTypeTest`, `ProgressAndCollectionTest`, `LocalLibraryItemTest`, `LocalMediaProgressExtraTest`, `PodcastEpisodeTest`, `ItemInProgressTest`, `LibraryHierarchyTest`, `MiscCoverageTest`, `LocalFileAndDeviceSettingsTest` | Domain models and edge inputs |
| `device/ConnectivityClassificationTest` | Connectivity state: VPN, captive portal |
| `device/LocalMediaLifecycleTest` | Scan identity, orphaned local items |
| `device/FolderScannerTest` | Internal-storage scan, cover adoption, re-download behaviour |
| `device/DeviceManagerVersionTest` | Server-version gating |
| `managers/DownloadIntegrityTest` | Download integrity with unknown/zero expected size |
| `managers/InternalDownloadManagerTest` | Transfer protocol: truncation, Range 206/200/416, headers |
| `managers/DownloadItemManagerTest`, `IncompleteDownloadCleanupTest` | Queue state, restore, retention |
| `managers/DbManagerPersistenceTest`, `DbManagerCleanupTest` | Paper persistence and cleanup rules |
| `media/ExternalPauseControlTest` | Pause from notification, lock screen, Bluetooth, Android Auto |
| `media/ServerProgressFallbackTest` | Offline and failed-sync recovery for server-hosted items |
| `media/MediaProgressSyncerTest` | Syncer lifecycle: stop, pause, finished, seek, reset, sync |
| `media/MediaManagerTest`, `MediaEventManagerTest`, `IconsTest` | Aggregation, events, icon mapping |
| `player/MediaSessionCallbackTest`, `PlayerListenerTest` | Media-session and player callbacks |
| `player/BrowseTreeTest`, `CastUtilityTest`, `CastTimelineTest` | Browse tree, Cast helpers |
| `plugins/AbsDatabaseTest` | Every `AbsDatabase` method not gated behind `load()` — **read §6.1 before editing** |
| `plugins/AbsDatabaseProgressConflictTest` | Websocket progress push (kept separate; §6.1) |
| `plugins/AbsAudioPlayerTest` | The plugin surface reachable without `Handler` dispatch |
| `plugins/AbsDownloaderTest`, `AbsLoggerTest` | Download-manifest builder, logging |
| `server/ServerApiContractTest` | App/server request contract |
| `server/ApiHandlerCredentialTest` | Credential preservation across transient failures |
| `server/ApiHandlerContractTest`, `ApiHandlerEdgeCaseTest` | Endpoint shapes, failure paths, callback cardinality |
| `support/AbsTestEnvironment` | The shared harness — §5 |

---

## 5. The shared harness (`support/AbsTestEnvironment`)

Reach for the helper rather than writing a fresh stub. The mockable-`android.jar`
gaps are a known list, and each entry was found by running code and reading the
next `NullPointerException`.

| Helper | Use it for |
| --- | --- |
| `reset()` | Repoints Paper at a fresh temp dir and clears `DeviceManager` / `MediaEventManager` / `AbsLogger` singleton state. **Call from both `@Before` and `@After`** — one Gradle JVM runs every test class, so state leaks forward into unrelated suites. |
| `mockLocalFileStatics()` | `Base64.encodeToString`, `Environment.getExternalStorageDirectory()`, `MimeTypeMap.getSingleton()`, `Uri.parse`/`fromFile`. |
| `mockUriParse()` | `Uri` stubs that retain `toString`/`scheme`/`path`. A bare relaxed mock returns empty strings, which is fine for "was a URI built" but useless for asserting its value. |
| `injectField(target, name, value)` | Set a `private lateinit var` that a Capacitor `load()` would normally assign. Walks the class hierarchy, since a Kotlin backing field is declared on the exact class that owns the property. |
| `withStaticField(cls, name, value) {}` | Scoped override of a `public static final` field. Needed for `Build.MANUFACTURER`/`MODEL`, which the mockable jar nulls. `mockkStatic` cannot help — a field read compiles to `getstatic`, not a method call, so there is nothing to intercept. Always use the scoped form; an unrestored override leaks into every later test class. |
| `withSdkInt(n) {}` | `Build.VERSION.SDK_INT` reads **0** by default, which silently pins every untouched test to whichever branch guards `< 28`. |
| `apiHandler(ctx)` | An `ApiHandler` wired to a mock `Context`; construction alone exercises `SecureStorage`. |
| `withMockServer {}` | `MockWebServer` plus `DeviceManager.serverConnectionConfig`, torn down automatically. Underused — see §7.3. |

The harness registers a JCA provider named `AndroidKeyStore` backed by JKS, because
`SecureStorage`'s property initializer calls `KeyStore.getInstance("AndroidKeyStore")`
at construction time.

`reset()` also clears Paper's static `mBookMap` by reflection. Paper caches `Book`
instances forever keyed by name, so without this a book opened by the first test
class keeps reading and writing that class's temp directory for the rest of the run.
This was found through an actual cross-test leak.

---

## 6. What the host JVM cannot reach

Confirmed by running code, not assumed. Do not re-litigate these without a spike.

### Android stubs that silently return null or no-op

| Surface | Behaviour |
| --- | --- |
| `Looper.getMainLooper()` | Returns null, so `Handler(...).post {}` **returns false and never runs the body**. The single biggest blocker in the suite. |
| `android.os.Bundle` | No working `put`/`get`. Any contract whose only observable is "what went into a Bundle" is untestable here. |
| `SparseArray` / `SparseIntArray` | `get(key, default)` returns null regardless of the default or of prior `put` calls. Blocks `CastTimeline` and `CastTimelineTracker`. |
| `Build.VERSION.SDK_INT` | Reads `0` — use `withSdkInt`. |
| `Build.MANUFACTURER` / `MODEL` | Null — use `withStaticField`. |
| `Settings.Secure.getString(..., ANDROID_ID)` | Null, which makes `ApiHandler.sendSyncLocalSessions` throw before it sends anything. A static *method*, so `mockkStatic` works. |
| `android.icu.text.DateFormat.getDateInstance()` | Null. |
| `org.json.JSONObject` | Method-stripped — **solved** by the real `org.json` jar on the test classpath. |
| `android.net.Uri` | Same problem, no drop-in replacement — use `mockUriParse()`. |

### Classes that stay unreachable

* `player/PlayerNotificationService` (1,242 lines) and `player/CastPlayer` (519) —
  Android `Service` and ExoPlayer lifecycle.
* `managers/SleepTimerManager` (209) — live service plus a main-looper `Handler`.
  **Its consumers are not blocked**: `AbsAudioPlayer`'s sleep-timer methods test
  fine with the manager mocked.
* `plugins/AbsFileSystem` (122) and `FolderScanner`'s external half — SAF.
* `SecureStorage`'s crypto path (46 of 57) — `KeyGenParameterSpec` is a stub, and a
  JCA test double cannot supply it.
* `MainActivity`, `MediaPlayerWidget`, `DownloadService` / `DownloadServiceHost`.
* `ApiHandler`'s 401 → refresh → **retry-success** path — needs a real
  `AndroidKeyStore`. The failure branches are covered.
* **Twelve of `AbsAudioPlayer`'s seventeen `@PluginMethod`s** — they wrap the
  delegation *and* the `call.resolve` in `Handler(Looper.getMainLooper()).post {}`,
  so they return without throwing while doing nothing at all. A `verify` would
  fail; a "did not throw" assertion would pass vacuously forever. Write neither.
* `MediaSessionCallback.handleMediaButtonClickCount` and `MediaProgressSyncer.start`'s
  15-second tick body — `Timer` and `Handler` bound.

### 6.1 `AbsDatabaseTest` is fragile — read before editing it

**Adding any test to `plugins/AbsDatabaseTest` can deterministically break two
unrelated tests in it.** Its two `setCurrentServerConnectionConfig` "new config"
tests are the only ones there that reach `DeviceManager.getBase64Id`, so the only
ones that depend on `mockLocalFileStatics()`'s `mockkStatic(Base64::class)` being
live.

Probing `Base64.encodeToString` from that class's `@Before` shows the stub returning
its mocked value in all 40 tests as the class stands, and `null` in all 43 once three
tests are added — the static mock goes inert **for the whole class, before any test
body runs**. `setCurrentServerConnectionConfig` then dies inside its
`GlobalScope.launch(Dispatchers.IO)` body on a `NullPointerException` and never
resolves its call, which surfaces as a five-second timeout in a test that has
nothing to do with the change.

Bisected: **not** ordering (`@FixMethodOrder(NAME_ASCENDING)` does not help),
**not** test count (a trivial extra `@Test` is harmless), and **not** the content of
the added tests (the same three cases under different method names leave the mock
working). The trigger is name-dependent and reproducible; the mechanism inside MockK
was not identified. `AbsDatabaseProgressConflictTest` exists as a separate class for
exactly this reason. Remediation in §7.3.

### 6.2 Do not call `MediaProgressSyncer.start()` in a test

It schedules on `Timer("ListeningTimer", false)` — that `false` is `isDaemon`, so it
is a **non-daemon** thread on a 15-second repeat. Neither `reset()` nor `pause()`
reaps it; both cancel the `TimerTask`, not the `Timer`. Every test that calls it
leaks a thread for the rest of the JVM, and enough of them can stop the Gradle test
JVM from exiting. Its body posts to a main-looper `Handler`, so it never executes
anyway — `start()` buys almost no coverage for its cost.

`listeningTimerRunning` is a public `var`, so the branches that matter can be reached
by setting it directly. `ExternalPauseControlTest` and `MediaProgressSyncerTest` both
do this.

---

## 7. Known remediations

### 7.1 Production fixes, ordered by specs-freed over effort

Each turns the listed enabled failures green. **These belong in their own change,
separate from the tests** — a test that moves with the code it tests proves nothing.
Line numbers are indicative; confirm against current source before editing.

| # | Fix | Where | Frees |
| --- | --- | --- | ---: |
| 1 | Guard the write: `if (playbackSession.updatedAt <= lastUpdate) return`. Today `currentTime`, `progress` and `lastUpdate` are assigned unconditionally, so a stale session overwrites newer data *and drags `lastUpdate` backwards*, poisoning every later server reconciliation that compares on it. | `LocalMediaProgress.updateFromPlaybackSession` | 3 |
| 2 | Clamp: `(currentTime / getTotalDuration()).coerceIn(0.0, 1.0)`, plus a NaN guard for zero duration. An unclamped `5.0` both persists and flips `isFinished` via `>= 0.99`. | `PlaybackSession.progress` | 3 |
| 3 | `(audioTracks.size - 1).coerceAtLeast(0)` in both index helpers, and guard the three callers that index with the result. An empty track list yields **-1**, and `audioTracks[-1]` throws out of a queue-navigation helper. Sibling `getTrackStartOffsetMs` already guards exactly this. | `PlaybackSession.getCurrentTrackIndex` / `getNextTrackIndex` | 3 |
| 4 | Add the missing `else` branch resolving with an error when the local item is not found, and make `it.media as Podcast` a safe cast. Today a missing record resolves **zero** times, so the JS promise stays pending forever; an episode id sent for a book throws `ClassCastException`. | `AbsAudioPlayer.prepareLibraryItem` | 2 |
| 5 | Treat a 401 from `/auth/refresh` as terminal and **IO or 5xx as retryable**. The server returns 401 specifically for an invalid refresh token, so the client can distinguish them. Also reorder `handleRefreshFailure`: it nulls the connection config before reading the id it needs, so `removeRefreshToken` is never actually reached. | `ApiHandler.handleTokenRefresh`, `handleRefreshFailure` | 2 |
| 6 | Add `TRANSPORT_VPN`, and require `NET_CAPABILITY_INTERNET` / `VALIDATED` rather than transport alone. A VPN reads as offline; a captive portal reads as online. | `DeviceManager.checkConnectivity` | 2 |
| 7 | Validate when `expectedSize <= 0` — at minimum reject a `Content-Encoding` other than `identity`, and a `Content-Type` that cannot be the requested file. There is currently **no** integrity check on that path, so an HTML error page and a gzip stream are both accepted as the file. `fileSize = 0` is the production default for cover parts. | `InternalDownloadManager` | 2 |
| 8 | Compare `lastUpdate` before applying, as the sibling caller `ApiHandler.syncLocalMediaProgressForUser` already does. | `AbsDatabase.syncServerMediaProgressWithLocalMediaProgress` | 1 |
| 9 | Pass `progress >= 0.99` instead of a hard-coded `false`. A book finished on first listen, with no prior record, persists as *not finished*; the existing-record branch gets this right, so the two branches disagree. | `PlaybackSession.getNewLocalMediaProgress` | 1 |
| 10 | Do not move `currentTime` backwards. A delayed external pause rewinds an already-saved later position; nothing serialises the media session, the player listener and the 15-second timer against each other. | `PlaybackSession.syncData` | 1 |
| 11 | Add a `length() > 0` check. The only guard today is `File.exists()`, and a zero-byte cover exists. Root cause of the reported cover-image crash. | `FolderScanner.createLocalFile` | 1 |
| 12 | Remove or flag an item once `checkHasTracks()` is false. A server-linked item that has lost every file is written back emptied and stays selectable in the library and the Android Auto tree. The information needed is already computed. | `DbManager.cleanLocalLibraryItems` | 1 |
| 13 | Percent-encode the query. An enabled spec demonstrates query-parameter injection; apply the same reserved-character matrix to ids and filters. | `ApiHandler.getSearchResults` | 1 |
| 14 | Propagate `ServerConnectionConfig.customHeaders`. They are configured, stored, and never sent, by either JSON requests or downloads. Matters behind reverse proxies and identity-aware gateways. | `ApiHandler`, `InternalDownloadManager` | 1 |
| 15 | Catch deserialization failure and invoke the callback with an error. Valid JSON of an unexpected shape currently drops the callback entirely, which reads as a hang. | `ApiHandler.makeRequest` | 1 |
| 16 | Guard the cover-resolution chain at its four call sites (`LocalLibraryItem.getMediaDescription` / `getCoverUri`, `PlaybackSession.resolveCoverBitmapAsync` / `getCoverUri`). One missing guard; a fix must also still invoke `onArtResolved`, or the crash becomes a spinner that never clears. | `LocalLibraryItem`, `PlaybackSession` | 5 |

Smaller model fixes, one spec each: initialize an absent track collection in
`Book.addAudioTrack`; accept tracks when a podcast's episode list is null; normalize
case, whitespace and parameters in audio-MIME and ebook-format detection (2); guard
malformed sleep-timer strings (2); stop book progress matching an episode on the same
library item; tolerate empty series metadata and a missing author collection; stop
force-casting every collection item to `Book`; keep progress percentages within
0–100; reject a negative download-queue limit. Four `MediaManager` cache and filter
defects — including one that caches under a key its own lookup never reads, so every
call re-fetches — are documented in that suite's KDoc.

### 7.2 Characterized on purpose — do not "fix" without a decision

These tests pin current behaviour so that changing it is visible. Each has a reason:

* **`LocalMediaProgress.updateFromServerMediaProgress`** is unguarded, but one of
  its two callers guards it. The defect spec therefore lives against the *unguarded*
  caller (remediation 8); the method's own behaviour is only pinned.
* **`MediaProgressSyncer.syncFromServerProgress`** has no comparison, but its only
  caller guards on the same object it mutates, so an older record cannot reach it.
  Two things worth knowing: the `// Currently unused` comment above it is **stale**
  — it *is* called — and the guard lives in the caller, so any future second caller
  inherits no protection.
* **Server-item offline progress.** Recovery is *queue-based*: the session is
  persisted on every sync attempt and flushed on reconnect, so the position is **not
  lost**. A downloaded item writes `LocalMediaProgress` immediately, so the two media
  types differ offline. Surfacing unsynced server progress in the UI is a product
  decision, not a bug fix.
* **Local item identity ignores the server** (`local_${libraryItemId}`), so two
  servers sharing an item id collide on one record. Changing the scheme would orphan
  every record already on disk.
* **`cancelSleepTimer` resolves outside its `Handler` post**, unlike its eleven
  siblings. A sequencing quirk on device, and the reason that one method is
  observable in tests at all.
* **`pause` and `finished` return without invoking their callback** when nothing is
  playing, unlike `stop`. A caller that awaited them would wait forever.

### 7.3 Test-infrastructure work

1. **Add `Settings.Secure.getString` to `mockLocalFileStatics()`.** It blocks
   `sendSyncLocalSessions` and everything that calls it. One `mockkStatic` line.
2. **Defuse the `AbsDatabaseTest` fragility (§6.1).** Cheapest useful step,
   independent of root cause: assert in `@Before` that the `Base64` stub is live, so
   the failure is immediate and legible instead of a timeout somewhere unrelated.
   Better: stop depending on a static mock inside a `GlobalScope` coroutine.
3. **Extract a shared base class or JUnit `@Rule`** for the `reset()` in
   `@Before`/`@After` pair. It has been re-derived by hand repeatedly.
4. **Adopt or drop `withMockServer`.** The harness's headline helper is barely used;
   both `ApiHandler` suites re-implement it inline.
5. `reset()` returns a `File` no caller uses.

---

## 8. Traps that have actually caused bad tests here

* **`?.x() != false` is a null-*accepting* assertion.** `uri?.contains("x") != false`
  is `true` when `uri` is null — the one outcome such a test usually means to
  exclude. `== true` is safe. Ask of every assertion: *would this still pass if the
  method returned `null`, `0`, `""`, or an empty list?*
* **A green test named after a bug.** An assertion written around observed behaviour
  instead of the intended contract will go green on a *wrong* fix.
* **`assertNull(thrown)` alone under-tests.** "Does not crash" and "still tells the
  UI it finished" are different contracts, and only the second one clears a spinner.
* **Constants inline; fields do not.** `NetworkCapabilities.TRANSPORT_*` and
  `NET_CAPABILITY_*` are compile-time constants and work correctly on both sides.
  `Build.VERSION.SDK_INT` is a real field read and returns 0.
* **When an Android stub blocks a contract, document the gap in the class KDoc
  rather than asserting around it.** `PodcastEpisodeTest` is the model: a few
  sentences on why `Bundle` extras are not covered, worth more than four assertions
  that would have passed vacuously — one of them against a constant whose value is
  `0`.
* **Reachability needs a spike, not a reading.** `AbsAudioPlayer` was once assumed
  testable on evidence that only proved a method *returned without throwing*; its
  `Handler` body never ran. Conversely `FolderScanner` and `AbsDownloader` were
  listed as blocked while being fully reachable.

---

## 9. Where the remaining risk is

Ranked by user impact, not by uncovered line count.

1. **`PlayerNotificationService`** (1,242 lines, 1 covered). The largest single risk
   in the app and structurally unreachable from a host JVM. It needs either a policy
   extraction or a device suite; nothing else will move it.
2. **Android-bound policy that has no seam yet** — playback interruption, media
   control state, download destination, the Android Auto browse tree, startup state.
   All need a policy object extracted from a service or plugin before there is
   anything host-testable. Blocked on a refactor decision, not on technique.
3. **Response-shape drift.** `ServerApiContractTest` pins the request shapes the
   client emits, but responses are hand-written fixtures, so they stay green after
   the server changes a serializer, a field type or a status. Server-produced golden
   fixtures are the known answer.
4. **`MediaManager`** — the largest *reachable* gap left.
5. **Transport policy is triplicated.** The Nuxt Axios client, the Capacitor HTTP
   client and native OkHttp each implement auth, refresh, retry and parsing
   differently, and only the Kotlin one has coverage.

---

## 10. Issue coverage

Suites carrying regression specs for reported issues. Each spec's KDoc has the
inputs, expected and observed behaviour, and the code path.

| Cluster | Issues | Suite |
| --- | --- | --- |
| Progress conflict | #1945, #1940, #1852, #1516, #1510, #1442, #1416, #1338 | `ProgressConflictTest`, `AbsDatabaseProgressConflictTest` |
| Download integrity and resume | #1838, #1827, #1709, #1479, #1428 | `DownloadIntegrityTest`, `InternalDownloadManagerTest` |
| Auth and transient HTTP | #1908, #1900, #1901 | `ApiHandlerCredentialTest` |
| Pause and external control | #1847, #1828, #1491 | `ExternalPauseControlTest` |
| Connectivity state | #1702, #1560, #1802 | `ConnectivityClassificationTest` |
| Local media lifecycle | #1680, #1630, #1392 | `LocalMediaLifecycleTest`, `FolderScannerTest` |
| Large and invalid media | #1684, #1650, #1731 | `LargeMediaBoundsTest` |
| Cover image crash | #1817 | `CoverImageTest`, `FolderScannerTest` |

Twenty-nine issues in total. Keep #1945 and #1940 on separate fixtures: they share a
data-integrity invariant but not a cause, and an Android-side fix must not read as
solving the cross-client one.

Several defects in §7.1 have no open issue — notably the first-listen finished flag,
both `prepareLibraryItem` inputs, the empty-track-list index, and the orphaned local
item. They were found by writing these tests.

One known response-shape mismatch is recorded rather than fixed: `GET /ping` returns
`{"success": true}` and `ApiHandler.pingServer` reads it with `getString`.
