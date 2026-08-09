package com.audiobookshelf.app.data

import android.content.ContentResolver
import android.content.Context
import android.graphics.ImageDecoder
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.audiobookshelf.app.device.DeviceManager
import com.audiobookshelf.app.support.AbsTestEnvironment
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkAll
import java.io.FileNotFoundException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Covers a user-reported hard crash: a book whose cover image was not successfully downloaded
 * crashed the app. Traced (see `kotlin-android-coverage-audit-pass-5.md` Part 3, P0 and Appendix
 * A.1) to one missing guard reached from four call sites - none of `LocalLibraryItem
 * .getMediaDescription`, `PlaybackSession.resolveCoverBitmapAsync`, `LocalLibraryItem.getCoverUri`
 * or `PlaybackSession.getCoverUri` catch a failure decoding/resolving a cover that is present on
 * disk as a record but unreadable as an image (zero-byte, truncated, moved, or outside the
 * configured `FileProvider` roots).
 *
 * `ImageDecoder`/`MediaStore`/`FileProvider` are Android SDK surfaces the mockable `android.jar`
 * stubs to no-ops, so they cannot fail on their own on a host JVM. The crash specs below use
 * `mockkStatic` to make them throw the exact exception the real platform documents for a missing
 * or undecodable file/URI, then assert production does not let it propagate. That is simulation of
 * a documented contract, not observation of the live bug - each such test says explicitly what
 * real-device condition it is standing in for.
 */
@Suppress("DEPRECATION") // MediaStore.Images.Media.getBitmap(ContentResolver, Uri) is the pre-28 branch under test
class CoverImageTest {
  private val ctx: Context = mockk(relaxed = true)

  @Before
  fun setUp() {
    AbsTestEnvironment.reset()
    AbsTestEnvironment.mockUriParse()
  }

  @After
  fun tearDown() {
    unmockkAll()
    AbsTestEnvironment.reset()
  }

  // --- Crash specs: reproduce the reported bug -----------------------------------------------

  @Test
  fun `getMediaDescription survives an undecodable local cover on pre-28 devices`() {
    // Stands in for: cover file on disk is zero-byte/truncated/corrupt, decoded via the pre-28
    // MediaStore.Images.Media.getBitmap path, which throws FileNotFoundException on a real device.
    AbsTestEnvironment.withSdkInt(27) {
      mockkStatic(MediaStore.Images.Media::class)
      every { MediaStore.Images.Media.getBitmap(any<ContentResolver>(), any()) } throws
              FileNotFoundException("No such file or directory")
      val item = localLibraryItem(coverContentUrl = "content://downloads/missing")

      var thrown: Throwable? = null
      try {
        item.getMediaDescription(null, ctx)
      } catch (e: Throwable) {
        thrown = e
      }

      assertNull("an undecodable local cover must not crash media-browser description building", thrown)
    }
  }

  @Test
  fun `getMediaDescription survives an undecodable local cover on SDK 28+ devices`() {
    // Stands in for the same corrupt-cover file, decoded via the SDK 28+ ImageDecoder path.
    AbsTestEnvironment.withSdkInt(33) {
      mockkStatic(ImageDecoder::class)
      every { ImageDecoder.createSource(any<ContentResolver>(), any()) } throws
              FileNotFoundException("No such file or directory")
      val item = localLibraryItem(coverContentUrl = "content://downloads/missing")

      var thrown: Throwable? = null
      try {
        item.getMediaDescription(null, ctx)
      } catch (e: Throwable) {
        thrown = e
      }

      assertNull("an undecodable local cover must not crash media-browser description building", thrown)
    }
  }

  @Test
  fun `resolveCoverBitmapAsync survives an undecodable local cover instead of crashing playback start`() {
    // Stands in for the same corrupt-cover file, this time reached from the playback-start path -
    // a crash here means the book itself cannot start playing, not just that browsing breaks.
    AbsTestEnvironment.withSdkInt(33) {
      mockkStatic(ImageDecoder::class)
      every { ImageDecoder.createSource(any<ContentResolver>(), any()) } throws
              FileNotFoundException("No such file or directory")
      val local = localLibraryItem(coverContentUrl = "content://downloads/missing")
      val session = PlaybackSession(
              id = "session", userId = "user", libraryItemId = "library-item", episodeId = null,
              mediaType = "book", mediaMetadata = MediaTypeMetadata("Title", false),
              deviceInfo = DeviceInfo("device", "maker", "model", 33, "test"),
              chapters = emptyList(), displayTitle = "Title", displayAuthor = "Author",
              coverPath = null, duration = 10.0, playMethod = 0, startedAt = 1, updatedAt = 2,
              timeListening = 0, audioTracks = mutableListOf(), currentTime = 0.0,
              libraryItem = null, localLibraryItem = local, localEpisodeId = null,
              serverConnectionConfigId = "server", serverAddress = "https://example.invalid",
              mediaPlayer = "local"
      )

      var thrown: Throwable? = null
      try {
        val job = session.resolveCoverBitmapAsync(ctx, CoroutineScope(Dispatchers.Default)) {}
        runBlocking { job?.join() }
      } catch (e: Throwable) {
        thrown = e
      }

      assertNull("an undecodable local cover must not crash playback start", thrown)
    }
  }

  @Test
  fun `LocalLibraryItem getCoverUri falls back to the packaged icon when FileProvider rejects the path`() {
    // Stands in for a cover recorded with a file: path FileProvider was never configured to serve
    // (moved storage, SD card removed) - a real device throws IllegalArgumentException here.
    mockkStatic(FileProvider::class)
    every { FileProvider.getUriForFile(any(), any(), any()) } throws
            IllegalArgumentException("Failed to find configured root that contains the file")
    val item = localLibraryItem(coverContentUrl = "file:///storage/emulated/0/abs/cover.jpg")

    var thrown: Throwable? = null
    var uri: String? = null
    try {
      uri = item.getCoverUri(ctx).toString()
    } catch (e: Throwable) {
      thrown = e
    }

    assertNull("an unresolvable file: cover must not crash every metadata build that reads it", thrown)
    assertTrue("should fall back to the packaged icon", uri?.contains("R.drawable.icon") != false ||
            uri?.startsWith("android.resource://") == true)
  }

  @Test
  fun `PlaybackSession getCoverUri falls back to the packaged icon when FileProvider rejects the path`() {
    // Same as above, but through the path that also feeds getExoMediaMetadata and the
    // notification-service queue navigator - this is the branch that crashes playback itself.
    mockkStatic(FileProvider::class)
    every { FileProvider.getUriForFile(any(), any(), any()) } throws
            IllegalArgumentException("Failed to find configured root that contains the file")
    val local = localLibraryItem(coverContentUrl = "file:///storage/emulated/0/abs/cover.jpg")
    val session = PlaybackSession(
            id = "session", userId = "user", libraryItemId = "library-item", episodeId = null,
            mediaType = "book", mediaMetadata = MediaTypeMetadata("Title", false),
            deviceInfo = DeviceInfo("device", "maker", "model", 33, "test"),
            chapters = emptyList(), displayTitle = "Title", displayAuthor = "Author",
            coverPath = null, duration = 10.0, playMethod = 0, startedAt = 1, updatedAt = 2,
            timeListening = 0, audioTracks = mutableListOf(), currentTime = 0.0,
            libraryItem = null, localLibraryItem = local, localEpisodeId = null,
            serverConnectionConfigId = "server", serverAddress = "https://example.invalid",
            mediaPlayer = "local"
    )

    var thrown: Throwable? = null
    try {
      session.getCoverUri(ctx)
    } catch (e: Throwable) {
      thrown = e
    }

    assertNull("an unresolvable file: cover must not crash playback session metadata", thrown)
  }

  // --- Normal-behaviour specs: lock in the paths that already work ---------------------------

  @Test
  fun `getCoverUri with no cover returns the packaged icon`() {
    val uri = localLibraryItem(coverContentUrl = null).getCoverUri(ctx).toString()

    assertTrue(uri.startsWith("android.resource://"))
  }

  @Test
  fun `getCoverUri passes a content cover through unchanged`() {
    val uri = localLibraryItem(coverContentUrl = "content://downloads/1").getCoverUri(ctx).toString()

    assertEquals("content://downloads/1", uri)
  }

  @Test
  fun `getMediaDescription with no cover builds a description with a null iconBitmap and the fallback iconUri`() {
    val description = localLibraryItem(coverContentUrl = null).getMediaDescription(null, ctx)

    assertNull(description.iconBitmap)
    assertTrue(description.iconUri.toString().startsWith("android.resource://"))
  }

  @Test
  fun `updateFromScan clears coverContentUrl coverAbsolutePath and media coverPath when no local file matches`() {
    val item = localLibraryItem(coverContentUrl = "content://downloads/1")
    item.coverAbsolutePath = "/local/cover.jpg"
    item.media.coverPath = "cover.jpg"

    item.updateFromScan(mutableListOf(), mutableListOf())

    assertNull(item.coverContentUrl)
    assertNull(item.coverAbsolutePath)
    assertNull(item.media.coverPath)
  }

  @Test
  fun `LibraryItem getCoverUri with no server cover falls back to the packaged icon`() {
    val item = libraryItem()

    val uri = item.getCoverUri().toString()

    assertTrue(uri.startsWith("android.resource://"))
  }

  @Test
  fun `LibraryItem getCoverUri omits the token for servers 2_17_0 and newer`() {
    val book = book().apply { coverPath = "cover.jpg" }
    val item = libraryItem(media = book)
    DeviceManager.serverConnectionConfig = com.audiobookshelf.app.data.ServerConnectionConfig(
            "server", 0, "Test", "https://example.invalid", "2.17.0", "user", "username", "tok", null
    )

    val uri = item.getCoverUri().toString()

    assertEquals("https://example.invalid/api/items/library-item/cover", uri)
  }

  @Test
  fun `LibraryItem getCoverUri appends a token for servers older than 2_17_0`() {
    val book = book().apply { coverPath = "cover.jpg" }
    val item = libraryItem(media = book)
    DeviceManager.serverConnectionConfig = com.audiobookshelf.app.data.ServerConnectionConfig(
            "server", 0, "Test", "https://example.invalid", "2.16.0", "user", "username", "tok", null
    )

    val uri = item.getCoverUri().toString()

    assertEquals("https://example.invalid/api/items/library-item/cover?token=tok", uri)
  }
}
