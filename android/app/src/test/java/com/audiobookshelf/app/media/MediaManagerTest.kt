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

  @Test
  fun `loadLibrarySeriesWithAudio filters out series with no audiobooks and caches the result`() {
    val withAudio = seriesJson("series-1", "Zeta Series", hasAudio = true)
    val withoutAudio = seriesJson("series-2", "Alpha Series", hasAudio = false)
    server.enqueue(
            MockResponse().setBody(
                    JSONObject().apply { put("results", JSONArray().put(JSONObject(withAudio)).put(JSONObject(withoutAudio))) }.toString()
            )
    )

    val latch = CountDownLatch(1)
    var result: List<com.audiobookshelf.app.data.LibrarySeriesItem>? = null
    mediaManager.loadLibrarySeriesWithAudio("lib-1") {
      result = it
      latch.countDown()
    }
    assertTrue(latch.await(5, TimeUnit.SECONDS))

    assertEquals(listOf("series-1"), result?.map { it.id })
    // A second call must be served from the cache - no second request to the server.
    assertEquals(1, server.requestCount)
  }

  @Test
  fun `loadLibrarySeriesWithAudio filter overload matches by uppercase title prefix on a cold cache`() {
    // loadLibrarySeriesWithAudio(libraryId, seriesFilter, cb) kicks off an async server load when
    // the series cache is cold (`loadLibrarySeriesWithAudio(libraryId) {}` - fire and forget), but
    // then immediately reads `cachedLibrarySeries[libraryId]!!` on the very next line, before that
    // async load can possibly have completed. That is a guaranteed NullPointerException on every
    // first call for a library - the paginated/filtered series browse crashes immediately unless
    // the unfiltered list happens to have been loaded first. This documents the expected contract
    // (filtered results, no crash even on a cold cache) and currently fails.
    server.enqueue(
            MockResponse().setBody(
                    JSONObject().apply {
                      put(
                              "results",
                              JSONArray()
                                      .put(JSONObject(seriesJson("series-1", "Zeta Series", hasAudio = true)))
                                      .put(JSONObject(seriesJson("series-2", "Alpha Series", hasAudio = true)))
                      )
                    }.toString()
            )
    )

    val latch = CountDownLatch(1)
    var result: List<com.audiobookshelf.app.data.LibrarySeriesItem>? = null
    var thrown: Throwable? = null
    try {
      mediaManager.loadLibrarySeriesWithAudio("lib-1", "ZETA") {
        result = it
        latch.countDown()
      }
    } catch (e: Throwable) {
      thrown = e
    }

    assertNull("should not throw when the series cache is cold", thrown)
    assertTrue(latch.await(5, TimeUnit.SECONDS))
    assertEquals(listOf("series-1"), result?.map { it.id })
  }

  @Test
  fun `loadAuthorsWithBooks filters authors with no books and sorts by name`() {
    server.enqueue(
            MockResponse().setBody(
                    JSONObject().apply {
                      put(
                              "authors",
                              JSONArray()
                                      .put(JSONObject(authorJson("author-1", "Zeta Author", numBooks = 2)))
                                      .put(JSONObject(authorJson("author-2", "Alpha Author", numBooks = 3)))
                                      .put(JSONObject(authorJson("author-3", "No Books Author", numBooks = 0)))
                      )
                    }.toString()
            )
    )

    val latch = CountDownLatch(1)
    var result: List<com.audiobookshelf.app.data.LibraryAuthorItem>? = null
    mediaManager.loadAuthorsWithBooks("lib-1") {
      result = it
      latch.countDown()
    }
    assertTrue(latch.await(5, TimeUnit.SECONDS))

    assertEquals(listOf("Alpha Author", "Zeta Author"), result?.map { it.name })
  }

  @Test
  fun `loadAuthorsWithBooks filter overload matches by uppercase name prefix on a cold cache`() {
    // Same defect shape as loadLibrarySeriesWithAudio above: on a cold cache this fires
    // loadAuthorsWithBooks(libraryId) {} (fire-and-forget async) and then immediately reads
    // cachedLibraryAuthors[libraryId]!!.values on the next line - a guaranteed NullPointerException
    // on every first call. Documents the expected contract; currently fails.
    server.enqueue(
            MockResponse().setBody(
                    JSONObject().apply {
                      put(
                              "authors",
                              JSONArray()
                                      .put(JSONObject(authorJson("author-1", "Zeta Author", numBooks = 2)))
                                      .put(JSONObject(authorJson("author-2", "Alpha Author", numBooks = 3)))
                      )
                    }.toString()
            )
    )

    val latch = CountDownLatch(1)
    var result: List<com.audiobookshelf.app.data.LibraryAuthorItem>? = null
    var thrown: Throwable? = null
    try {
      mediaManager.loadAuthorsWithBooks("lib-1", "ALPHA") {
        result = it
        latch.countDown()
      }
    } catch (e: Throwable) {
      thrown = e
    }

    assertNull("should not throw when the author cache is cold", thrown)
    assertTrue(latch.await(5, TimeUnit.SECONDS))
    assertEquals(listOf("author-2"), result?.map { it.id })
  }

  @Test
  fun `getNextUnfinishedEpisode returns the most recently published unfinished episode`() {
    val older = podcastEpisode("ep-old", publishedAt = 1_000L)
    val newer = podcastEpisode("ep-new", publishedAt = 2_000L)
    val podcast =
            Podcast(
                    PodcastMetadata("Cast", null, null, mutableListOf(), false), null,
                    mutableListOf(), mutableListOf(older, newer), false, 2
            )

    val result = podcast.getNextUnfinishedEpisode("item-1", mediaManager)

    assertEquals("ep-new", result?.id)
  }

  @Test
  fun `getNextUnfinishedEpisode skips episodes with finished server progress`() {
    val newer = podcastEpisode("ep-new", publishedAt = 2_000L)
    val older = podcastEpisode("ep-old", publishedAt = 1_000L)
    val podcast =
            Podcast(
                    PodcastMetadata("Cast", null, null, mutableListOf(), false), null,
                    mutableListOf(), mutableListOf(newer, older), false, 2
            )
    mediaManager.serverUserMediaProgress =
            mutableListOf(
                    com.audiobookshelf.app.data.MediaProgress(
                            "p1", "item-1", "ep-new", 10.0, 1.0, 10.0, true, null, null, 0, 0, null
                    )
            )

    val result = podcast.getNextUnfinishedEpisode("item-1", mediaManager)

    assertEquals("ep-old", result?.id)
  }

  @Test
  fun `getNextUnfinishedEpisode returns null when every episode is finished`() {
    val ep = podcastEpisode("ep-1", publishedAt = 1_000L)
    val podcast =
            Podcast(
                    PodcastMetadata("Cast", null, null, mutableListOf(), false), null,
                    mutableListOf(), mutableListOf(ep), false, 1
            )
    mediaManager.serverUserMediaProgress =
            mutableListOf(
                    com.audiobookshelf.app.data.MediaProgress(
                            "p1", "item-1", "ep-1", 10.0, 1.0, 10.0, true, null, null, 0, 0, null
                    )
            )

    assertNull(podcast.getNextUnfinishedEpisode("item-1", mediaManager))
  }

  @Test
  fun `getNextUnfinishedEpisode tolerates episodes with a null publishedAt`() {
    val noDate = podcastEpisode("ep-no-date", publishedAt = null)
    val dated = podcastEpisode("ep-dated", publishedAt = 1_000L)
    val podcast =
            Podcast(
                    PodcastMetadata("Cast", null, null, mutableListOf(), false), null,
                    mutableListOf(), mutableListOf(noDate, dated), false, 2
            )

    val result = podcast.getNextUnfinishedEpisode("item-1", mediaManager)

    assertNotNull(result)
  }

  private fun podcastEpisode(id: String, publishedAt: Long?) =
          PodcastEpisode(
                  id, 1, null, null, "Episode $id", null, null, null, publishedAt, null,
                  audioTrack(localFileId = "lf-$id"), null, 10.0, 100L, null, null
          )

  private fun seriesJson(id: String, name: String, hasAudio: Boolean): String {
    val tracks =
            if (hasAudio)
                    """[{"index":0,"startOffset":0.0,"duration":10.0,"title":"T","contentUrl":"/t","mimeType":null,"metadata":null,"isLocal":false,"localFileId":null,"serverIndex":0}]"""
            else "[]"
    return """
      {
        "id": "$id", "libraryId": "lib-1", "name": "$name", "description": null,
        "addedAt": 0, "updatedAt": 0, "localLibraryItemId": null,
        "books": [
          {
            "id": "$id-book", "ino": "ino", "libraryId": "lib-1", "folderId": "folder",
            "path": "/book", "relPath": "book", "mtimeMs": 0, "ctimeMs": 0, "birthtimeMs": 0,
            "addedAt": 0, "updatedAt": 0, "isMissing": false, "isInvalid": false, "mediaType": "book",
            "media": {
              "metadata": {"title": "Book", "genres": [], "explicit": false, "subtitle": null},
              "coverPath": null, "tags": [], "tracks": $tracks
            }
          }
        ]
      }
    """.trimIndent()
  }

  private fun authorJson(id: String, name: String, numBooks: Int): String {
    return """
      {
        "id": "$id", "libraryId": "lib-1", "name": "$name", "description": null,
        "imagePath": null, "addedAt": 0, "updatedAt": 0, "numBooks": $numBooks,
        "libraryItems": null, "series": null
      }
    """.trimIndent()
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
