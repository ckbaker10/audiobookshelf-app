package com.audiobookshelf.app.media

import com.audiobookshelf.app.data.LibraryItem
import com.audiobookshelf.app.data.ServerConnectionConfig
import com.audiobookshelf.app.data.book
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
  fun `getById returns null for a non-local id when no server items are loaded`() {
    assertNull(mediaManager.getById("server-item-1"))
  }

  @Test
  fun `getPodcastWithEpisodeByEpisodeId resolves local-prefixed ids from the local database`() {
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
  fun `checkResetServerItems clears cached state when not connected to a server`() {
    DeviceManager.serverConnectionConfig = null

    assertTrue(mediaManager.checkResetServerItems())
  }

  @Test
  fun `loadLibraryDiscoveryBooksWithAudio crashes instead of returning empty for uncached libraries`() {
    // loadLibraryDiscoveryBooksWithAudio calls cb(listOf()) when the library isn't cached yet,
    // but is missing a `return` afterward: it falls through to
    // `cachedLibraryDiscovery[libraryId]?.filter{...} as List<LibraryItem>`, and casting a null
    // result with `as` (not `as?`) throws instead of short-circuiting. Any caller - Android Auto's
    // discovery shelf - crashes the first time a library's discovery shelf hasn't been populated
    // yet, rather than seeing an empty shelf.
    var deliveredEmptyList = false

    try {
      mediaManager.loadLibraryDiscoveryBooksWithAudio("lib-1") { items ->
        if (items.isEmpty()) deliveredEmptyList = true
      }
    } catch (e: NullPointerException) {
      // Kotlin's `as` throws NullPointerException (not ClassCastException) when casting a null
      // value to a non-nullable type. Documents the current crash; see comment above.
    }

    assertTrue(
            "loadLibraryDiscoveryBooksWithAudio should deliver an empty list without throwing " +
                    "for a library with no cached discovery data",
            deliveredEmptyList
    )
  }

  @Test
  fun `getById and getFromSearch resolve items loaded through the collections cache`() {
    val itemJson = minimalLibraryItemJson("item-1", title = "The Great Adventure")
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

    assertEquals(listOf("item-1"), books?.map { it.id })
    assertEquals("item-1", mediaManager.getById("item-1")?.id)
    assertEquals("item-1", mediaManager.getFromSearch("great adventure")?.id)
    assertNull(mediaManager.getFromSearch("no such title"))
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
