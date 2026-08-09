package com.audiobookshelf.app.models

import com.audiobookshelf.app.data.LocalFolder
import com.audiobookshelf.app.data.MediaType
import com.audiobookshelf.app.data.MediaTypeMetadata
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadItemTest {
  @Test
  fun `download is not finished when a completed part failed`() {
    val item = downloadItem(part(completed = true), part(completed = true, failed = true))

    assertFalse(item.isDownloadFinished)
  }

  @Test
  fun `download is finished only when every part completed successfully`() {
    val item = downloadItem(part(completed = true), part(completed = true))

    assertTrue(item.isDownloadFinished)
  }
  @Test
  fun `download is not finished while any part is still queued`() {
    val item = downloadItem(part(completed = true), part(completed = false))

    assertFalse(item.isDownloadFinished)
  }

  @Test
  fun `download is not finished while a completed part is still moving`() {
    val item = downloadItem(part(completed = true), part(completed = true, isMoving = true))

    assertFalse(item.isDownloadFinished)
  }

  @Test
  fun `a failed first part cannot make a fully completed multi-part item successful`() {
    val item = downloadItem(
            part(completed = true, failed = true),
            part(completed = true),
            part(completed = true),
            part(completed = true)
    )

    assertFalse(item.isDownloadFinished)
  }

  @Test
  fun `an item with no parts is not a completed download`() {
    assertFalse(downloadItem().isDownloadFinished)
  }


  @Test
  fun `unfinished queued parts remain eligible for download`() {
    val queued = part(completed = false)
    val item = downloadItem(part(completed = true), queued)

    assertTrue(item.getNextDownloadItemParts(1).single() === queued)
  }

  private fun downloadItem(vararg parts: DownloadItemPart) =
          DownloadItem(
                  id = "item",
                  libraryItemId = "library-item",
                  episodeId = null,
                  userMediaProgress = null,
                  serverConnectionConfigId = "server",
                  serverAddress = "https://example.invalid",
                  serverUserId = "user",
                  mediaType = "book",
                  itemFolderPath = "/downloads/item",
                  localFolder =
                          LocalFolder(
                                  id = "internal-test",
                                  name = "Test",
                                  contentUrl = "",
                                  basePath = "",
                                  absolutePath = "/downloads",
                                  simplePath = "/downloads",
                                  storageType = "internal",
                                  mediaType = "book"
                          ),
                  itemTitle = "Test item",
                  itemSubfolder = "item",
                  media = MediaType(MediaTypeMetadata("Test item", false), null),
                  downloadItemParts = parts.toMutableList()
          )

  private fun part(
          completed: Boolean,
          failed: Boolean = false,
          isMoving: Boolean = false
  ) =
          DownloadItemPart(
                  id = "part-${nextPartId++}",
                  downloadItemId = "item",
                  filename = "track.mp3",
                  fileSize = 10,
                  finalDestinationPath = "/downloads/item/track.mp3",
                  serverPath = "/api/items/item/file",
                  localFolderName = "Test",
                  localFolderUrl = "",
                  localFolderId = "internal-test",
                  ebookFile = null,
                  audioTrack = null,
                  episode = null,
                  completed = completed,
                  moved = false,
                  isMoving = isMoving,
                  failed = failed,
                  uri = null,
                  destinationUri = null,
                  finalDestinationUri = null,
                  finalDestinationSubfolder = "item",
                  downloadId = null,
                  progress = if (completed) 100 else 0,
                  bytesDownloaded = if (completed) 10 else 0
          )

  companion object {
    private var nextPartId = 0
  }
}
