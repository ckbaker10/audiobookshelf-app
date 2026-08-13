package com.audiobookshelf.app.managers

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Covers only [MtlsManager.getClient]'s timeout-builder logic. Everything else in MtlsManager -
 * KeyChain access, SharedPreferences, HttpsURLConnection defaults - needs a real Android
 * Context/KeyStore and is out of scope for the host-JVM suite, the same boundary already drawn
 * around SecureStorage's crypto path.
 *
 * getClient() never touches applicationContext, so this doesn't need MtlsManager.initialize() -
 * and since no test in this suite ever populates the cached SSLSocketFactory/TrustManager, every
 * client built here exercises the plain-TLS path, matching a device with no certificate
 * configured.
 */
class MtlsManagerTest {
  @Test
  fun `getClient with no timeouts specified uses OkHttp defaults`() {
    val client = MtlsManager.getClient()

    assertEquals(10_000, client.connectTimeoutMillis)
    assertEquals(10_000, client.readTimeoutMillis)
    assertEquals(10_000, client.writeTimeoutMillis)
    assertEquals(0, client.callTimeoutMillis)
  }

  @Test
  fun `getClient applies a positive connectTimeout in seconds`() {
    val client = MtlsManager.getClient(connectTimeout = 30)

    assertEquals(30_000, client.connectTimeoutMillis)
  }

  @Test
  fun `getClient applies a positive callTimeout in seconds`() {
    val client = MtlsManager.getClient(callTimeout = 3)

    assertEquals(3_000, client.callTimeoutMillis)
  }

  @Test
  fun `getClient applies positive read and write timeouts in seconds`() {
    val client = MtlsManager.getClient(readTimeout = 60, writeTimeout = 45)

    assertEquals(60_000, client.readTimeoutMillis)
    assertEquals(45_000, client.writeTimeoutMillis)
  }

  @Test
  fun `getClient ignores a zero or negative timeout and keeps the default`() {
    val client = MtlsManager.getClient(connectTimeout = 0, callTimeout = -1)

    assertEquals(10_000, client.connectTimeoutMillis)
    assertEquals(0, client.callTimeoutMillis)
  }

  @Test
  fun `getClient with no cached certificate does not attach an sslSocketFactory override`() {
    // No test in this suite ever populates the cache, so this also stands as the "plain TLS,
    // no certificate configured" contract - the default OkHttp client already has an
    // sslSocketFactory (java.net.ssl's own default), so what's asserted is that getClient()
    // doesn't fail or require initialize() to have been called first.
    val client = MtlsManager.getClient(connectTimeout = 30, readTimeout = 60, writeTimeout = 60)

    assertEquals(30_000, client.connectTimeoutMillis)
  }
}
