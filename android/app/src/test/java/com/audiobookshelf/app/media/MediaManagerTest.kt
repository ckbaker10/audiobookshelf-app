package com.audiobookshelf.app.media

import com.audiobookshelf.app.data.LibraryItem
import com.audiobookshelf.app.data.LocalLibraryItem
import com.audiobookshelf.app.data.Podcast
import com.audiobookshelf.app.data.PodcastEpisode
import com.audiobookshelf.app.data.PodcastMetadata
import com.audiobookshelf.app.data.ServerConnectionConfig
import com.audiobookshelf.app.data.audioTrack
import com.audiobookshelf.app.data.localLibraryItem
import com.audiobookshelf.app.device.DeviceManager
import com.audiobookshelf.app.managers.DbManager
import com.audiobookshelf.app.support.AbsTestEnvironment
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MediaManagerTest {
  private lateinit var server: MockWebServer
  private lateinit var mediaManager: MediaManager

  @Before
  fun setUp() {
    AbsTestEnvironment.reset()
    server = MockWebServer()
    server.start()
    DeviceManager.serverConnectionConfig =
            ServerConnectionConfig(
                    "test-server", 0, "Test", server.url("/").toString().trimEnd('/'),
                    "2.17.0", "user-1", "username", "test-token", null
            )
    mediaManager = MediaManager(AbsTestEnvironment.apiHandler(), AbsTestEnvironment.mockContext())
  }

  @After
  fun tearDown() {
    server.shutdown()
  }

  @Test
  fun `getFirstItem returns null when there are no server or local items`() {
    assertNull(mediaManager.getFirstItem())
  }

  @Test
  fun `getFirstItem falls back to the first local book when no server items are loaded`() {
    val db = DbManager()
    db.saveLocalLibraryItem(localLibraryItem(id = "local-1"))

    assertEquals("local-1", mediaManager.getFirstItem()?.id)
  }

  @Test
  fun `getById resolves local-prefixed ids from the local database`() {
    val db = DbManager()
    db.saveLocalLibraryItem(localLibraryItem(id = "local-1"))

    assertEquals("local-1", mediaManager.getById("local-1")?.id)
    assertNull(mediaManager.getById("local-missing"))
  }

  @Test
  fun `getPodcastWithEpisodeByEpisodeId resolves a local podcast episode from the local database`() {
    val episode =
            PodcastEpisode(
                    "local-ep-1", 1, null, null, "Episode 1", null, null, null, null, null,
                    audioTrack(localFileId = "lf-1"), null, 10.0, 100L, null, null
            )
    val podcast =
            Podcast(
                    PodcastMetadata("Cast", null, null, mutableListOf(), false), null,
                    mutableListOf(), mutableListOf(episode), false, 1
            )
    val db = DbManager()
    db.saveLocalLibraryItem(
            localLibraryItem(id = "local-podcast-1", media = podcast, mediaType = "podcast")
    )

    val result = mediaManager.getPodcastWithEpisodeByEpisodeId("local-ep-1")

    assertEquals("local-podcast-1", (result?.libraryItemWrapper as? LocalLibraryItem)?.id)
    assertEquals("Episode 1", result?.episode?.title)
  }

  @Test
  fun `getPodcastWithEpisodeByEpisodeId misses cleanly for an unknown local episode id`() {
    assertNull(mediaManager.getPodcastWithEpisodeByEpisodeId("local-does-not-exist"))
  }

  @Test
  fun `getFromSearch with a blank query falls back to getFirstItem`() {
    val db = DbManager()
    db.saveLocalLibraryItem(localLibraryItem(id = "local-1"))

    assertEquals("local-1", mediaManager.getFromSearch(null)?.id)
    assertEquals("local-1", mediaManager.getFromSearch("")?.id)
  }

  @Test
  fun `checkResetServerItems reports true when not connected to a server`() {
    DeviceManager.serverConnectionConfig = null

    assertTrue(mediaManager.checkResetServerItems())
  }

  @Test
  fun `checkResetServerItems actually clears previously cached server items`() {
    loadServerItemIntoCache("item-1", "Cached Book")
    assertEquals("item-1", mediaManager.getById("item-1")?.id)

    DeviceManager.serverConnectionConfig = null
    assertTrue(mediaManager.checkResetServerItems())

    assertNull(
            "checkResetServerItems should have cleared the cached server item",
            mediaManager.getById("item-1")
    )
  }

  @Test
  fun `loadLibraryDiscoveryBooksWithAudio delivers an empty list without throwing for an uncached library`() {
    // loadLibraryDiscoveryBooksWithAudio calls cb(listOf()) when the library isn't cached yet,
    // but is missing a `return` afterward: it falls through to
    // `cachedLibraryDiscovery[libraryId]?.filter{...} as List<LibraryItem>`, and casting a null
    // result with `as` (not `as?`) throws instead of short-circuiting. Any caller - Android
    // Auto's discovery shelf - crashes the first time a library's discovery shelf hasn't been
    // populated yet, rather than seeing an empty shelf.
    //
    // A prior version of this test caught the NullPointerException and asserted only that the
    // pre-throw cb(listOf()) had fired - which is always true regardless of whether the bug is
    // present, since the callback fires before the crash. That made the test a false green: it
    // could never fail while the bug existed, and would still pass if the bug were fixed. This
    // version asserts the actual contract (no throw, exactly one callback) and correctly fails.
    var thrown: Throwable? = null
    val delivered = mutableListOf<List<LibraryItem>>()

    try {
      mediaManager.loadLibraryDiscoveryBooksWithAudio("lib-1") { delivered.add(it) }
    } catch (e: Throwable) {
      thrown = e
    }

    assertNull("should not throw for a library with no cached discovery data", thrown)
    assertEquals(1, delivered.size)
    assertTrue(delivered.single().isEmpty())
  }

  @Test
  fun `getById and getFromSearch resolve items loaded through the collections cache`() {
    loadServerItemIntoCache("item-1", "The Great Adventure")

    assertEquals("item-1", mediaManager.getById("item-1")?.id)
    assertEquals("item-1", mediaManager.getFromSearch("great adventure")?.id)
    assertNull(mediaManager.getFromSearch("no such title"))
    assertNull("a different, never-loaded id should not resolve", mediaManager.getById("item-2"))
  }

  /** Loads a single server library item into `serverLibraryItems` via a real collections round trip. */
  private fun loadServerItemIntoCache(id: String, title: String) {
    val itemJson = minimalLibraryItemJson(id, title = title)
    val collectionJson =
            JSONObject().apply {
              put("id", "col-1")
              put("libraryId", "lib-1")
              put("name", "Collection")
              put("description", JSONObject.NULL)
              put("books", JSONArray().put(JSONObject(itemJson)))
            }
    server.enqueue(
            MockResponse().setBody(JSONObject().apply { put("results", JSONArray().put(collectionJson)) }.toString())
    )

    val collectionsLatch = CountDownLatch(1)
    mediaManager.loadLibraryCollectionsWithAudio("lib-1") { collectionsLatch.countDown() }
    assertTrue(collectionsLatch.await(5, TimeUnit.SECONDS))

    val booksLatch = CountDownLatch(1)
    var books: List<LibraryItem>? = null
    mediaManager.loadLibraryCollectionBooksWithAudio("lib-1", "col-1") {
      books = it
      booksLatch.countDown()
    }
    assertTrue(booksLatch.await(5, TimeUnit.SECONDS))
    assertNotNull(books)
  }

  private fun minimalLibraryItemJson(id: String, title: String): String {
    return """
      {
        "id": "$id", "ino": "ino", "libraryId": "lib-1", "folderId": "folder",
        "path": "/book", "relPath": "book", "mtimeMs": 0, "ctimeMs": 0, "birthtimeMs": 0,
        "addedAt": 0, "updatedAt": 0, "isMissing": false, "isInvalid": false, "mediaType": "book",
        "media": {
          "metadata": {"title": "$title", "genres": [], "explicit": false, "subtitle": null},
          "coverPath": null, "tags": [],
          "tracks": [{"index":0,"startOffset":0.0,"duration":10.0,"title":"Track 1","contentUrl":"/track","mimeType":null,"metadata":null,"isLocal":false,"localFileId":null,"serverIndex":0}]
        }
      }
    """.trimIndent()
  }
}
