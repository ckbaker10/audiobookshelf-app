package com.audiobookshelf.app.plugins

import com.audiobookshelf.app.data.ServerConnectionConfig
import com.audiobookshelf.app.data.localLibraryItem
import com.audiobookshelf.app.device.DeviceManager
import com.audiobookshelf.app.managers.DbManager
import com.audiobookshelf.app.data.LocalMediaProgress
import com.audiobookshelf.app.support.AbsTestEnvironment
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * `AbsDatabase` is the app's biggest Capacitor plugin (377 lines, 0% before this suite) and its
 * main untrusted-input boundary. These tests cover every `@PluginMethod` that does not depend on
 * the plugin's `lateinit` fields (`mainActivity`/`apiHandler`/`secureStorage`, only set by
 * `load()`, which requires a real Capacitor `Bridge` and is out of scope here).
 *
 * Two gotchas verified in a throwaway spike before writing these (see
 * `kotlin-android-coverage-audit-pass-4.md` Appendix A.1): production calls the **two-arg**
 * `call.getString(name, default)`, and a missing record resolves via the **no-arg**
 * `call.resolve()`. Stubbing only the one-arg forms silently does nothing.
 */
class AbsDatabaseTest {
  private lateinit var db: DbManager
  private lateinit var plugin: AbsDatabase

  @Before
  fun setUp() {
    AbsTestEnvironment.reset()
    db = DbManager()
    plugin = AbsDatabase()
  }

  /** A relaxed `PluginCall` whose two-arg `getString` returns the given params, else its default. */
  private fun pluginCall(vararg params: Pair<String, String>): PluginCall {
    val call = mockk<PluginCall>(relaxed = true)
    every { call.getString(any(), any()) } answers { secondArg() }
    params.forEach { (key, value) -> every { call.getString(key, "") } returns value }
    return call
  }

  /** Stubs `resolve`/`resolve(JSObject)` to release a latch, runs [action], and awaits it. */
  private fun awaitResolve(call: PluginCall, action: () -> Unit): JSObject? {
    val latch = CountDownLatch(1)
    val captured = slot<JSObject>()
    every { call.resolve(capture(captured)) } answers { latch.countDown() }
    every { call.resolve() } answers { latch.countDown() }
    action()
    assertTrue("plugin call never resolved", latch.await(5, TimeUnit.SECONDS))
    return if (captured.isCaptured) captured.captured else null
  }

  @Test
  fun `getDeviceData resolves with the persisted device data`() {
    val call = pluginCall()

    val body = awaitResolve(call) { plugin.getDeviceData(call) }

    assertTrue(body!!.has("deviceSettings"))
  }

  @Test
  fun `getLocalFolders resolves with every saved folder`() {
    db.saveLocalFolder(com.audiobookshelf.app.data.LocalFolder("f1", "Folder", "", "", "/f1", "internal", "book"))
    val call = pluginCall()

    val body = awaitResolve(call) { plugin.getLocalFolders(call) }

    assertEquals(1, body!!.getJSONArray("value").length())
  }

  @Test
  fun `getLocalFolder resolves with the matching folder`() {
    db.saveLocalFolder(com.audiobookshelf.app.data.LocalFolder("f1", "Folder", "", "", "/f1", "internal", "book"))
    val call = pluginCall("folderId" to "f1")

    val body = awaitResolve(call) { plugin.getLocalFolder(call) }

    assertEquals("f1", body!!.getString("id"))
  }

  @Test
  fun `getLocalFolder resolves with no arguments when the folder is missing`() {
    val call = pluginCall("folderId" to "missing")

    val body = awaitResolve(call) { plugin.getLocalFolder(call) }

    assertNull("a missing folder should resolve via the no-arg resolve()", body)
  }

  @Test
  fun `getLocalLibraryItem resolves with the matching item`() {
    db.saveLocalLibraryItem(localLibraryItem(id = "local-1"))
    val call = pluginCall("id" to "local-1")

    val body = awaitResolve(call) { plugin.getLocalLibraryItem(call) }

    assertEquals("local-1", body!!.getString("id"))
  }

  @Test
  fun `getLocalLibraryItem resolves with no arguments when the item is missing`() {
    val call = pluginCall("id" to "does-not-exist")

    val body = awaitResolve(call) { plugin.getLocalLibraryItem(call) }

    assertNull(body)
  }

  @Test
  fun `getLocalLibraryItemByLId resolves by the server library item id`() {
    db.saveLocalLibraryItem(localLibraryItem(id = "local-1", libraryItemId = "server-item-1"))
    val call = pluginCall("libraryItemId" to "server-item-1")

    val body = awaitResolve(call) { plugin.getLocalLibraryItemByLId(call) }

    assertEquals("local-1", body!!.getString("id"))
  }

  @Test
  fun `getLocalLibraryItems filters by media type`() {
    db.saveLocalLibraryItems(
            listOf(localLibraryItem(id = "book-1", mediaType = "book"))
    )
    val call = pluginCall("mediaType" to "book")

    val body = awaitResolve(call) { plugin.getLocalLibraryItems(call) }

    assertEquals(1, body!!.getJSONArray("value").length())
  }

  @Test
  fun `getLocalLibraryItemsInFolder filters by folder id`() {
    db.saveLocalLibraryItem(localLibraryItem(id = "local-1"))
    val call = pluginCall("folderId" to "folder")

    val body = awaitResolve(call) { plugin.getLocalLibraryItemsInFolder(call) }

    assertEquals(1, body!!.getJSONArray("value").length())
  }

  @Test
  fun `getAllLocalMediaProgress resolves with every saved entry`() {
    db.saveLocalMediaProgress(
            LocalMediaProgress(
                    "p1", "local-1", null, 100.0, 0.5, 50.0, false, null, null, 0, 0, null,
                    null, null, null, null, null
            )
    )
    val call = pluginCall()

    val body = awaitResolve(call) { plugin.getAllLocalMediaProgress(call) }

    assertEquals(1, body!!.getJSONArray("value").length())
  }

  @Test
  fun `getLocalMediaProgressForServerItem matches by library item and episode id`() {
    db.saveLocalMediaProgress(
            LocalMediaProgress(
                    "p1", "local-1", null, 100.0, 0.5, 50.0, false, null, null, 0, 0, null,
                    null, null, null, "item-1", "ep-1"
            )
    )
    val call = pluginCall("libraryItemId" to "item-1", "episodeId" to "ep-1")

    val body = awaitResolve(call) { plugin.getLocalMediaProgressForServerItem(call) }

    assertEquals("p1", body!!.getString("id"))
  }

  @Test
  fun `getLocalMediaProgressForServerItem treats a blank episode id as no episode filter`() {
    db.saveLocalMediaProgress(
            LocalMediaProgress(
                    "p1", "local-1", null, 100.0, 0.5, 50.0, false, null, null, 0, 0, null,
                    null, null, null, "item-1", null
            )
    )
    val call = pluginCall("libraryItemId" to "item-1", "episodeId" to "")

    val body = awaitResolve(call) { plugin.getLocalMediaProgressForServerItem(call) }

    assertEquals("p1", body!!.getString("id"))
  }

  @Test
  fun `getLocalMediaProgressForServerItem resolves with no arguments when nothing matches`() {
    val call = pluginCall("libraryItemId" to "missing")

    val body = awaitResolve(call) { plugin.getLocalMediaProgressForServerItem(call) }

    assertNull(body)
  }

  @Test
  fun `removeLocalMediaProgress deletes the record and resolves`() {
    db.saveLocalMediaProgress(
            LocalMediaProgress(
                    "p1", "local-1", null, 100.0, 0.5, 50.0, false, null, null, 0, 0, null,
                    null, null, null, null, null
            )
    )
    val call = pluginCall("localMediaProgressId" to "p1")

    awaitResolve(call) { plugin.removeLocalMediaProgress(call) }

    assertNull(db.getLocalMediaProgress("p1"))
  }

  @Test
  fun `getAccessToken returns the token for a known server connection`() {
    DeviceManager.deviceData.serverConnectionConfigs =
            mutableListOf(ServerConnectionConfig("srv-1", 0, "n", "https://x", null, "u", "un", "secret-token", null))
    val call = pluginCall("serverConnectionConfigId" to "srv-1")
    val captured = slot<JSObject>()
    every { call.resolve(capture(captured)) } returns Unit

    // getAccessToken resolves synchronously (no GlobalScope.launch), unlike most methods above.
    plugin.getAccessToken(call)

    assertEquals("secret-token", captured.captured.getString("token"))
  }

  @Test
  fun `getAccessToken returns an empty string for an unknown server connection`() {
    val call = pluginCall("serverConnectionConfigId" to "missing")
    val captured = slot<JSObject>()
    every { call.resolve(capture(captured)) } returns Unit

    plugin.getAccessToken(call)

    assertEquals("", captured.captured.getString("token"))
  }
}
