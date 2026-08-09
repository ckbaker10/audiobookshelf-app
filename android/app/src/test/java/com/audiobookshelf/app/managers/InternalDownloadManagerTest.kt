package com.audiobookshelf.app.managers

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
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
    val destination = File(downloadDirectory, "book.part")
    val callback = RecordingCallback()

    InternalDownloadManager(destination, 6, callback, hasAvailableSpace = { true })
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

  @Test
  fun `server ignoring range restarts staging file instead of appending`() {
    server.enqueue(MockResponse().setResponseCode(200).setBody("abcd"))
    val destination = File(downloadDirectory, "book.part").apply { writeText("ab") }
    val callback = download(destination, expectedSize = 4)

    callback.awaitCompletion()

    assertFalse(callback.failed)
    assertArrayEquals("abcd".toByteArray(), destination.readBytes())
    assertEquals("bytes=2-", server.takeRequest().getHeader("Range"))
  }

  @Test
  fun `invalid content range fails without overwriting partial data`() {
    server.enqueue(
            MockResponse()
                    .setResponseCode(206)
                    .setHeader("Content-Range", "bytes 1-2/4")
                    .setBody("cd")
    )
    val destination = File(downloadDirectory, "book.part").apply { writeText("ab") }
    val callback = download(destination, expectedSize = 4)

    callback.awaitCompletion()

    assertTrue(callback.failed)
    assertArrayEquals("ab".toByteArray(), destination.readBytes())
  }

  @Test
  fun `range not satisfiable succeeds when staging file is already complete`() {
    server.enqueue(MockResponse().setResponseCode(416))
    val destination = File(downloadDirectory, "book.part").apply { writeText("abcd") }
    val callback = download(destination, expectedSize = 4)

    callback.awaitCompletion()

    assertFalse(callback.failed)
    assertEquals(listOf(4L to 100L), callback.progressUpdates)
  }

  @Test
  fun `http error reports failure exactly once`() {
    server.enqueue(MockResponse().setResponseCode(500))
    val callback = download(File(downloadDirectory, "book.part"), expectedSize = 4)

    callback.awaitCompletion()

    assertTrue(callback.failed)
    assertEquals(1, callback.completionCount)
  }

  @Test
  fun `storage rejection fails without consuming full response`() {
    server.enqueue(MockResponse().setBody("abcd"))
    val destination = File(downloadDirectory, "book.part")
    val callback = download(destination, expectedSize = 4, hasAvailableSpace = { false })

    callback.awaitCompletion()

    assertTrue(callback.failed)
    assertEquals(0L, destination.length())
  }

  @Test
  fun `download request sends token without placing it in url`() {
    server.enqueue(MockResponse().setBody("abcd"))
    val callback = download(File(downloadDirectory, "book.part"), expectedSize = 4)

    callback.awaitCompletion()
    val request = server.takeRequest()

    assertFalse(callback.failed)
    assertEquals("Bearer token", request.getHeader("Authorization"))
    assertEquals("identity", request.getHeader("Accept-Encoding"))
    assertFalse(request.path.orEmpty().contains("token"))
  }

  private fun download(
          destination: File,
          expectedSize: Long,
          hasAvailableSpace: () -> Boolean = { true }
  ): RecordingCallback {
    val callback = RecordingCallback()
    InternalDownloadManager(
                    destination,
                    expectedSize,
                    callback,
                    hasAvailableSpace = hasAvailableSpace
            )
            .download(server.url("/download").toString(), "token")
    return callback
  }

  private class RecordingCallback : DownloadItemManager.InternalProgressCallback {
    private val completion = CountDownLatch(1)
    val progressUpdates = mutableListOf<Pair<Long, Long>>()
    var failed = false
      private set
    var completionCount = 0
      private set

    override fun onProgress(totalBytesWritten: Long, progress: Long) {
      progressUpdates += totalBytesWritten to progress
    }

    override fun onComplete(failed: Boolean) {
      this.failed = failed
      completionCount++
      completion.countDown()
    }

    fun awaitCompletion() {
      assertTrue("download callback timed out", completion.await(5, TimeUnit.SECONDS))
    }
  }
}
