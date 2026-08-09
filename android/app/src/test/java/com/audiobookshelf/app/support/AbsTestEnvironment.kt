package com.audiobookshelf.app.support

import android.content.Context
import com.audiobookshelf.app.data.ServerConnectionConfig
import com.audiobookshelf.app.device.DeviceManager
import com.audiobookshelf.app.media.MediaEventManager
import com.audiobookshelf.app.plugins.AbsLogger
import com.audiobookshelf.app.server.ApiHandler
import io.mockk.every
import io.mockk.mockk
import io.paperdb.Paper
import java.io.File
import java.security.Provider
import java.security.Security
import okhttp3.mockwebserver.MockWebServer

/**
 * Shared host-JVM test harness for code that touches the `DeviceManager`/Paper singleton stack.
 *
 * `DeviceManager`, `MediaEventManager`, and `AbsLogger` are process-wide Kotlin `object`s that
 * persist state across every test class run in the same Gradle test JVM (Gradle does not fork a
 * new JVM per class by default). [reset] repoints Paper at a fresh temp directory and clears the
 * mutable singleton state that would otherwise leak between tests - call it from a `@Before`
 * method in any test that touches `DeviceManager`, `DbManager`, `ApiHandler`, `MediaEventManager`,
 * or `AbsLogger`.
 */
object AbsTestEnvironment {
  init {
    // Registered once per JVM: SecureStorage's property initializer calls
    // KeyStore.getInstance("AndroidKeyStore"), which does not exist on a host JVM. A JCA
    // provider under that exact name backed by the JDK's own JKS keystore clears it.
    if (Security.getProvider("AndroidKeyStore") == null) {
      Security.addProvider(FakeAndroidKeyStoreProvider())
    }
  }

  /**
   * Repoints Paper at a fresh temp directory and clears mutable singleton state. Call this from
   * both `@Before` (so each test starts clean) and `@After` (so a test doesn't leave
   * `DeviceManager.serverConnectionConfig` pointing at a `MockWebServer` instance it already shut
   * down, which the next test class to run in this JVM would otherwise inherit).
   */
  fun reset() {
    val dir = File(System.getProperty("java.io.tmpdir"), "abs-test-${System.nanoTime()}")
    dir.mkdirs()
    val ctx = mockk<Context>(relaxed = true)
    every { ctx.filesDir } returns dir
    every { ctx.applicationContext } returns ctx
    Paper.init(ctx)
    clearPaperBookCache()

    // DeviceManager.deviceData is cached in a `var` from whenever DeviceManager was first
    // touched in this JVM; force it to re-read from the freshly-pointed Paper directory.
    DeviceManager.deviceData = DeviceManager.dbManager.getDeviceData()
    DeviceManager.serverConnectionConfig = null
    MediaEventManager.clientEventEmitter = null
    AbsLogger.onLogEmitter = null
  }

  /**
   * Paper caches constructed `Book` instances forever in a static `ConcurrentHashMap` keyed only
   * by book name (see `Paper.getBook`) - a later `Paper.init()` call updates where *new* books are
   * created but never evicts books already touched earlier in this JVM, so without this a "log" or
   * "device" book opened by one test class keeps reading/writing the *first* test's temp directory
   * for the rest of the run. Clearing the map forces every book to be re-created against the
   * directory just set by [reset].
   */
  private fun clearPaperBookCache() {
    val field = Paper::class.java.getDeclaredField("mBookMap")
    field.isAccessible = true
    (field.get(null) as MutableMap<*, *>).clear()
  }

  /** A relaxed mock Android `Context`, sufficient for code paths that don't inspect it. */
  fun mockContext(): Context = mockk(relaxed = true)

  /**
   * Overwrites a `public static final` field (e.g. `android.os.Build.MANUFACTURER`) for the rest
   * of this JVM's life.
   *
   * AGP's mockable `android.jar` nulls out the initializers of static String fields like
   * `Build.MANUFACTURER`/`Build.MODEL` (they're non-null on a real device, but null under this
   * stub) - code that reads them directly (not through a method) and forwards them into a
   * non-null Kotlin parameter throws `NullPointerException` at that call site.
   * `mockkStatic` cannot help here: it intercepts static *method* calls, but a Kotlin/Java static
   * field read compiles to a `getstatic` bytecode instruction, not a method call, so there is
   * nothing for MockK to hook. Reflection alone cannot un-final a field either - JDK 12+ blocks
   * mutating `Field`'s own `modifiers` field. `sun.misc.Unsafe` bypasses both problems by writing
   * the field's memory directly. This is inherently JVM-internals-fragile; use it only when a
   * production code path unconditionally reads a static field that the mockable jar has nulled.
   */
  fun setStaticField(clazz: Class<*>, fieldName: String, value: Any?) {
    val unsafeField = Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe")
    unsafeField.isAccessible = true
    val unsafe = unsafeField.get(null)
    val unsafeClass = unsafe.javaClass
    val field = clazz.getField(fieldName)
    val base = unsafeClass.getMethod("staticFieldBase", java.lang.reflect.Field::class.java).invoke(unsafe, field)
    val offset = unsafeClass.getMethod("staticFieldOffset", java.lang.reflect.Field::class.java).invoke(unsafe, field) as Long
    unsafeClass.getMethod("putObject", Any::class.java, Long::class.javaPrimitiveType, Any::class.java)
            .invoke(unsafe, base, offset, value)
  }

  /** An [ApiHandler] wired to a mock `Context`; construction alone exercises `SecureStorage`. */
  fun apiHandler(ctx: Context = mockContext()): ApiHandler = ApiHandler(ctx)

  /**
   * Starts a [MockWebServer] and points `DeviceManager.serverConnectionConfig` at it so
   * `ApiHandler`/`MediaManager` requests reach it without any production change. The server is
   * shut down and the config cleared automatically.
   */
  fun withMockServer(
          serverVersion: String = "2.17.0",
          token: String = "test-token",
          userId: String = "test-user",
          customHeaders: Map<String, String>? = null,
          action: (MockWebServer) -> Unit
  ) {
    val server = MockWebServer()
    server.start()
    try {
      DeviceManager.serverConnectionConfig =
              ServerConnectionConfig(
                      "test-server",
                      0,
                      "Test Server",
                      server.url("/").toString().trimEnd('/'),
                      serverVersion,
                      userId,
                      "test-username",
                      token,
                      customHeaders
              )
      action(server)
    } finally {
      server.shutdown()
      DeviceManager.serverConnectionConfig = null
    }
  }
}

private class FakeAndroidKeyStoreProvider : Provider("AndroidKeyStore", 1.0, "host-JVM test double backed by JKS") {
  init {
    put("KeyStore.AndroidKeyStore", "sun.security.provider.JavaKeyStore\$JKS")
  }
}
