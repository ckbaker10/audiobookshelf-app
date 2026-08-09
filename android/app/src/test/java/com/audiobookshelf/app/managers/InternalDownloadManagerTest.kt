package com.audiobookshelf.app.managers

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class InternalDownloadManagerTest {
  private lateinit var server: MockWebServer
  private lateinit var downloadDirectory: File

  @Before
  fun setUp() {
    server = MockWebServer()
    server.start()
    downloadDirectory = Files.createTempDirectory("abs-download-test").toFile()
  }

  @After
  fun tearDown() {
    server.shutdown()
    downloadDirectory.deleteRecursively()
  }

  @Test
  fun `truncated response is reported as failed and preserves staging file`() {
    server.enqueue(MockResponse().setResponseCode(200).setBody("ab"))
    val destination = File(downloadDirectory, "book.part")
    val callback = download(destination, expectedSize = 4)

    callback.awaitCompletion()

    assertTrue(callback.failed)
    assertArrayEquals("ab".toByteArray(), destination.readBytes())
  }

  @Test
  fun `network failure is reported as failed`() {
    server.enqueue(
            MockResponse()
                    .setBody("abcdef")
                    .setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY)
    )
    val client = OkHttpClient.Builder().build()
    val destination = File(downloadDirectory, "book.part")
    val callback = RecordingCallback()

    InternalDownloadManager(destination, 6, callback, hasAvailableSpace = { true }, client)
            .download(server.url("/interrupted").toString(), "token")

    callback.awaitCompletion()

    assertTrue(callback.failed)
    assertTrue(destination.exists())
    assertTrue(destination.length() < 6)
  }

  @Test
  fun `network recovery resumes staging file with a range request`() {
    server.enqueue(
            MockResponse()
                    .setResponseCode(206)
                    .setHeader("Content-Range", "bytes 2-3/4")
                    .setBody("cd")
    )
    val destination = File(downloadDirectory, "book.part").apply { writeText("ab") }
    val callback = download(destination, expectedSize = 4)

    callback.awaitCompletion()

    assertFalse(callback.failed)
    assertArrayEquals("abcd".toByteArray(), destination.readBytes())
    assertEquals("bytes=2-", server.takeRequest().getHeader("Range"))
    assertEquals(100L, callback.progressUpdates.last().second)
  }

  private fun download(destination: File, expectedSize: Long): RecordingCallback {
    val callback = RecordingCallback()
    InternalDownloadManager(
                    destination,
                    expectedSize,
                    callback,
                    hasAvailableSpace = { true },
                    client = OkHttpClient.Builder().build()
            )
            .download(server.url("/download").toString(), "token")
    return callback
  }

  private class RecordingCallback : DownloadItemManager.InternalProgressCallback {
    private val completion = CountDownLatch(1)
    val progressUpdates = mutableListOf<Pair<Long, Long>>()
    var failed = false
      private set

    override fun onProgress(totalBytesWritten: Long, progress: Long) {
      progressUpdates += totalBytesWritten to progress
    }

    override fun onComplete(failed: Boolean) {
      this.failed = failed
      completion.countDown()
    }

    fun awaitCompletion() {
      assertTrue("download callback timed out", completion.await(5, TimeUnit.SECONDS))
    }
  }
}
