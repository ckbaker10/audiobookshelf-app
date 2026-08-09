package com.audiobookshelf.app.device

import com.audiobookshelf.app.data.ServerConnectionConfig
import com.audiobookshelf.app.support.AbsTestEnvironment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class DeviceManagerVersionTest {
  @Before
  fun setUp() {
    AbsTestEnvironment.reset()
  }

  private fun withServerVersion(version: String) {
    DeviceManager.serverConnectionConfig =
            ServerConnectionConfig("id", 0, "n", "https://x", version, "u", "un", "t", null)
  }

  @Test
  fun `equal versions compare as greater than or equal`() {
    withServerVersion("2.26.0")
    assertTrue(DeviceManager.isServerVersionGreaterThanOrEqualTo("2.26.0"))
  }

  @Test
  fun `greater major minor or patch each satisfy the comparison`() {
    withServerVersion("3.0.0")
    assertTrue(DeviceManager.isServerVersionGreaterThanOrEqualTo("2.26.0"))

    withServerVersion("2.27.0")
    assertTrue(DeviceManager.isServerVersionGreaterThanOrEqualTo("2.26.5"))

    withServerVersion("2.26.6")
    assertTrue(DeviceManager.isServerVersionGreaterThanOrEqualTo("2.26.5"))
  }

  @Test
  fun `lesser major minor or patch each fail the comparison`() {
    withServerVersion("1.9.9")
    assertFalse(DeviceManager.isServerVersionGreaterThanOrEqualTo("2.0.0"))

    withServerVersion("2.25.9")
    assertFalse(DeviceManager.isServerVersionGreaterThanOrEqualTo("2.26.0"))

    withServerVersion("2.26.4")
    assertFalse(DeviceManager.isServerVersionGreaterThanOrEqualTo("2.26.5"))
  }

  @Test
  fun `differing part counts compare the missing parts as zero`() {
    withServerVersion("2.17")
    assertTrue(DeviceManager.isServerVersionGreaterThanOrEqualTo("2.17.0"))
    assertFalse(DeviceManager.isServerVersionGreaterThanOrEqualTo("2.17.1"))
  }

  @Test
  fun `empty server version is never greater than or equal to anything`() {
    withServerVersion("")
    assertFalse(DeviceManager.isServerVersionGreaterThanOrEqualTo("0.0.1"))
    assertFalse(DeviceManager.isServerVersionGreaterThanOrEqualTo(""))
  }

  @Test
  fun `empty compare version is always satisfied`() {
    withServerVersion("1.0.0")
    assertTrue(DeviceManager.isServerVersionGreaterThanOrEqualTo(""))
  }

  @Test
  fun `a prerelease suffix parses its numeric-looking segment as zero`() {
    // "2.26.0-beta".split(".") -> ["2", "26", "0-beta"]; "0-beta".toIntOrNull() is null, so the
    // patch component silently becomes 0 instead of failing to parse or comparing the suffix.
    // This means a server on "2.26.0-beta" reports itself as satisfying a "2.26.0" gate, which
    // may or may not be the intended contract - this test locks in the current behavior so a
    // change to it is deliberate rather than accidental.
    withServerVersion("2.26.0-beta")
    assertTrue(DeviceManager.isServerVersionGreaterThanOrEqualTo("2.26.0"))
  }

  @Test
  fun `getServerConnectionConfig finds by id and misses cleanly`() {
    val config = ServerConnectionConfig("one", 0, "One", "https://one", null, "u", "n", "t", null)
    DeviceManager.deviceData.serverConnectionConfigs = mutableListOf(config)

    assertEquals(config, DeviceManager.getServerConnectionConfig("one"))
    assertNull(DeviceManager.getServerConnectionConfig("missing"))
    assertNull(DeviceManager.getServerConnectionConfig(null))
  }
}
