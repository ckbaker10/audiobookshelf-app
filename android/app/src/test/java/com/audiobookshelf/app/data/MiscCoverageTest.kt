package com.audiobookshelf.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MiscCoverageTest {
  @Test
  fun `collection book count reflects list size or zero when absent`() {
    val withBooks = LibraryCollection("collection", "library", "Name", null, mutableListOf(libraryItem(), libraryItem()))
    val withoutBooks = LibraryCollection("collection", "library", "Name", null, null)

    assertEquals(2, withBooks.bookCount)
    assertEquals(0, withoutBooks.bookCount)
  }

  @Test
  fun `local file ebook detection matches known formats only`() {
    assertTrue(localFile("application/epub+zip").isEBookFile())
    assertFalse(localFile("audio/mpeg").isEBookFile())
    assertFalse(localFile(null).isEBookFile())
  }

  @Test
  fun `audio track relative path falls back to empty string without metadata`() {
    val withoutMetadata = audioTrack()
    val withMetadata = withoutMetadata.copy(metadata = FileMetadata("f.mp3", "mp3", "/f.mp3", "sub/f.mp3", 10))

    assertEquals("", withoutMetadata.relPath)
    assertEquals("sub/f.mp3", withMetadata.relPath)
  }

  @Test
  fun `negative audio track duration produces an end offset before the start`() {
    val track = audioTrack(startOffset = 5.0, duration = -2.0)

    assertEquals(5_000L, track.startOffsetMs)
    assertEquals(-2_000L, track.durationMs)
    assertEquals(3_000L, track.endOffsetMs)
  }

  private fun localFile(mimeType: String?) = LocalFile("id", "file", "", "", "/file", mimeType, 1)
}
