# Android JVM tests

This project currently runs host-JVM tests only. Device/emulator tests under
`src/androidTest` are deliberately not part of this test foundation.

## Prerequisites

* JDK 17 or newer (the Android build uses a Java 17 toolchain).
* Android SDK Platform 35 and Build-Tools 35.0.0.
* `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) pointing at the Android SDK.

## Commands

From the repository root:

```bash
./android/gradlew :app:testDebugUnitTest -p android --no-daemon
./android/gradlew :app:jacocoDebugUnitTestReport -p android --no-daemon
```

The coverage HTML report is written to
`android/app/build/reports/jacoco/jacocoDebugUnitTestReport/html/index.html`; the
machine-readable XML report is alongside it.

## Test conventions

Place Kotlin host tests under `android/app/src/test/java`, mirroring the production
package. Use JUnit 4, MockK, MockWebServer, and `kotlinx-coroutines-test` as needed.
Keep test inputs deterministic; do not depend on Android device services, sleeps, or
external network access.
