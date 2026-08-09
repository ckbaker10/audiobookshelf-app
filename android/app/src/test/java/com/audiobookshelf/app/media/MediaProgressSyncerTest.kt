package com.audiobookshelf.app.media

import android.content.Context
import android.net.ConnectivityManager
import com.audiobookshelf.app.data.ServerConnectionConfig
import com.audiobookshelf.app.data.audioTrack
import com.audiobookshelf.app.data.book
import com.audiobookshelf.app.data.playbackSession
import com.audiobookshelf.app.device.DeviceManager
import com.audiobookshelf.app.managers.DbManager
import com.audiobookshelf.app.player.PlayerNotificationService
import com.audiobookshelf.app.support.AbsTestEnvironment
import io.mockk.every
import io.mockk.mockk
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MediaProgressSyncerTest {
  private lateinit var pns: PlayerNotificationService
  private lateinit var syncer: MediaProgressSyncer
  private lateinit var db: DbManager

  @Before
  fun setUp() {
    AbsTestEnvironment.reset()
    db = DbManager()
    pns = mockk(relaxed = true)
    // Without this, Context.getSystemService(CONNECTIVITY_SERVICE) on a relaxed mock returns a
    // generic proxy that isn't a ConnectivityManager, and DeviceManager.checkConnectivity's
    // unchecked cast throws ClassCastException instead of just reporting "not connected".
    every { pns.getSystemService(Context.CONNECTIVITY_SERVICE) } returns
            mockk<ConnectivityManager>(relaxed = true)
    syncer = MediaProgressSyncer(pns, AbsTestEnvironment.apiHandler())
  }

  /** Sets the private `lastSyncTime` field without going through `start()`'s real Timer. */
  private fun setLastSyncTime(millisAgo: Long) {
    val field = MediaProgressSyncer::class.java.getDeclaredField("lastSyncTime")
    field.isAccessible = true
    field.set(syncer, System.currentTimeMillis() - millisAgo)
  }

  private fun syncOnce(shouldSyncServer: Boolean = false, currentTime: Double = 50.0): SyncResult? {
    val latch = CountDownLatch(1)
    var result: SyncResult? = null
    syncer.sync(shouldSyncServer, currentTime) {
      result = it
      latch.countDown()
    }
    assertTrue("sync callback was never invoked", latch.await(5, TimeUnit.SECONDS))
    return result
  }

  @Test
  fun `sync reports no result when it has never been started`() {
    assertNull(syncOnce())
  }

  @Test
  fun `sync reports no result within one second of the last sync`() {
    setLastSyncTime(500L)
    syncer.currentPlaybackSession = playbackSession(mutableListOf(audioTrack(duration = 100.0)))

    assertNull(syncOnce())
  }

  @Test
  fun `sync guards against a NaN progress session instead of persisting it`() {
    setLastSyncTime(5_000L)
    // Zero-duration session with a zero sync time -> progress = 0.0 / 0.0 = NaN. (A non-zero
    // currentTime against a zero duration is +Infinity, not NaN, and does not trip this guard.)
    syncer.currentPlaybackSession = playbackSession(mutableListOf())

    assertNull(syncOnce(currentTime = 0.0))
    assertTrue(db.getAllLocalMediaProgress().isEmpty())
  }

  @Test
  fun `offline local session sync saves progress locally without contacting the server`() {
    setLastSyncTime(5_000L)
    val session =
            playbackSession(mutableListOf(audioTrack(duration = 100.0)), currentTime = 10.0).apply {
              // isLocal is derived from playMethod; PLAYMETHOD_LOCAL = 3.
              playMethod = 3
            }
    syncer.currentPlaybackSession = session

    val result = syncOnce(shouldSyncServer = true, currentTime = 20.0)

    assertEquals(false, result?.serverSyncAttempted)
    val saved = db.getAllLocalMediaProgress()
    assertEquals(1, saved.size)
    assertEquals(20.0, saved.first().currentTime, 0.0)
  }

  @Test
  fun `local session syncs to the server when connected to the same server the item belongs to`() {
    setLastSyncTime(5_000L)
    DeviceManager.serverConnectionConfig =
            ServerConnectionConfig("srv-1", 0, "n", "https://x", "2.17.0", "u", "un", "t", null)
    val session =
            playbackSession(mutableListOf(audioTrack(duration = 100.0)), currentTime = 10.0).apply {
              playMethod = 3
              serverConnectionConfigId = "srv-1"
            }
    syncer.currentPlaybackSession = session
    every { pns.getSystemService(Context.CONNECTIVITY_SERVICE) } returns
            mockk<ConnectivityManager>(relaxed = true).also {
              every { it.getNetworkCapabilities(any()) } returns
                      mockk(relaxed = true) { every { hasTransport(any()) } returns true }
            }

    // No server is actually listening; sendLocalProgressSync will fail to connect, which is
    // still a valid, deterministic outcome to assert on (serverSyncAttempted = true, success = false).
    val result = syncOnce(shouldSyncServer = true, currentTime = 20.0)

    assertEquals(true, result?.serverSyncAttempted)
    assertEquals(false, result?.serverSyncSuccess)
  }

  @Test
  fun `reset clears the tracked playback session and local progress`() {
    syncer.currentPlaybackSession = playbackSession()
    syncer.currentLocalMediaProgress = null

    syncer.reset()

    assertNull(syncer.currentPlaybackSession)
    assertEquals("", syncer.currentSessionId)
  }
}
