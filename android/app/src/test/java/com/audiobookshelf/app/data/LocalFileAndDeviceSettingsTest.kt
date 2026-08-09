package com.audiobookshelf.app.data

import android.content.Context
import io.mockk.mockk
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalFileAndDeviceSettingsTest {
  @Test
  fun `local file existence reflects the real filesystem for non-content uris`() {
    val ctx = mockk<Context>()
    val temp = File.createTempFile("abs-test", ".tmp")
    temp.deleteOnExit()

    val present = LocalFile("id", "file", "", "", temp.absolutePath, "audio/mpeg", 1)
    assertTrue(present.exists(ctx))

    temp.delete()
    assertFalse(present.exists(ctx))
  }

  @Test
  fun `missing local file with never-created path does not exist`() {
    val ctx = mockk<Context>()
    val missing = LocalFile("id", "file", "", "", "/does/not/exist/anywhere.mp3", "audio/mpeg", 1)

    assertFalse(missing.exists(ctx))
  }

  @Test
  fun `last server connection config selects the matching entry among several`() {
    val one = ServerConnectionConfig("one", 0, "One", "https://one", null, "u", "n", "t", null)
    val two = ServerConnectionConfig("two", 1, "Two", "https://two", null, "u", "n", "t", null)
    val data = DeviceData(mutableListOf(one, two), "two", null, null)

    assertEquals(two, data.getLastServerConnectionConfig())
  }

  @Test
  fun `malformed sleep timer start time does not crash the hour lookup`() {
    val settings = DeviceSettings.default()
    settings.autoSleepTimerStartTime = "invalid"

    assertEquals(22, settings.autoSleepTimerStartHour)
  }

  @Test
  fun `sleep timer time without a separator does not crash the minute lookup`() {
    val settings = DeviceSettings.default()
    settings.autoSleepTimerEndTime = "0600"

    assertEquals(0, settings.autoSleepTimerEndMinute)
  }
}
