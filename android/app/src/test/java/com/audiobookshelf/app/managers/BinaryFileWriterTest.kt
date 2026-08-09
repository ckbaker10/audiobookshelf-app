package com.audiobookshelf.app.managers

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class BinaryFileWriterTest {
  @Test
  fun `exact length response reports success once`() {
    val output = ByteArrayOutputStream()
    val callback = RecordingCallback()
    val written = BinaryFileWriter(output, callback)
            .write(byteArrayOf(1, 2, 3, 4).inputStream(), length = 4)
    assertEquals(4L, written)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4), output.toByteArray())
    assertEquals(listOf(false), callback.completions)
    assertEquals(100L, callback.progressUpdates.last().second)
  }

  @Test
  fun `clean early EOF reports failure instead of accepting a truncated file`() {
    val output = ByteArrayOutputStream()
    val callback = RecordingCallback()
    val written = BinaryFileWriter(output, callback)
            .write(byteArrayOf(1, 2).inputStream(), length = 4)
    assertEquals(2L, written)
    assertArrayEquals(byteArrayOf(1, 2), output.toByteArray())
    assertEquals(listOf(true), callback.completions)
    assertEquals(50L, callback.progressUpdates.last().second)
  }

  @Test
  fun `failure before the first byte reports failure without progress`() {
    val output = ByteArrayOutputStream()
    val callback = RecordingCallback()
    val input = FailingInputStream(byteArrayOf(1, 2), failAfterBytes = 0)
    val written = BinaryFileWriter(output, callback).write(input, length = 2)
    assertEquals(0L, written)
    assertArrayEquals(byteArrayOf(), output.toByteArray())
    assertEquals(emptyList<Pair<Long, Long>>(), callback.progressUpdates)
    assertEquals(listOf(true), callback.completions)
  }
  @Test

  fun `stream failure reports failure and never reports success`() {
    val output = ByteArrayOutputStream()
    val callback = RecordingCallback()
    val input = FailingInputStream(byteArrayOf(1, 2, 3, 4), failAfterBytes = 2)

    val written = BinaryFileWriter(output, callback).write(input, length = 4)

    assertEquals(2L, written)
    assertArrayEquals(byteArrayOf(1, 2), output.toByteArray())
    assertEquals(listOf(true), callback.completions)
  }

  @Test
  fun `cancellation reports failure and does not consume remaining bytes`() {
    val output = ByteArrayOutputStream()
    val callback = RecordingCallback()

    val written =
            BinaryFileWriter(output, callback)
                    .write(byteArrayOf(1, 2, 3).inputStream(), length = 3) { true }

    assertEquals(0L, written)
    assertArrayEquals(byteArrayOf(), output.toByteArray())
    assertEquals(listOf(true), callback.completions)
  }

  private class RecordingCallback : DownloadItemManager.InternalProgressCallback {
    val completions = mutableListOf<Boolean>()

    override fun onProgress(totalBytesWritten: Long, progress: Long) {
      progressUpdates += totalBytesWritten to progress
    }

    override fun onComplete(failed: Boolean) {
      completions += failed
    }
    val progressUpdates = mutableListOf<Pair<Long, Long>>()
  }

  private class FailingInputStream(
          private val bytes: ByteArray,
          private val failAfterBytes: Int
  ) : InputStream() {
    private var position = 0

    override fun read(): Int {
      if (position >= failAfterBytes) throw IOException("simulated network disconnect")
      return bytes[position++].toInt() and 0xff
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
      if (position >= failAfterBytes) throw IOException("simulated network disconnect")
      if (position >= bytes.size) return -1
      val count = minOf(length, failAfterBytes - position, bytes.size - position)
      bytes.copyInto(buffer, offset, position, position + count)
      position += count
      return count
    }
  }
}
