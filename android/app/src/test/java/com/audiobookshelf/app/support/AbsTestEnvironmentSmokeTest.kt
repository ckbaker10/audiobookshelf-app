package com.audiobookshelf.app.support

import com.audiobookshelf.app.device.DeviceManager
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class AbsTestEnvironmentSmokeTest {
  @Before
  fun setUp() {
    AbsTestEnvironment.reset()
  }

  /**
   * `reset()` belongs here as well as in `@Before`: every suite in this package shares one Gradle
   * test JVM, so state this class leaves on the `DeviceManager`/Paper singletons is inherited by
   * whichever class runs next.
   */
  @After
  fun tearDown() {
    AbsTestEnvironment.reset()
  }

  @Test
  fun `reset provides a clean device manager state`() {
    assertNull(DeviceManager.serverConnectionConfig)
    assertEquals("", DeviceManager.serverAddress)
  }

  @Test
  fun `api handler constructs against the fake keystore provider`() {
    val handler = AbsTestEnvironment.apiHandler()
    assertEquals(handler.tag, "ApiHandler")
  }

  @Test
  fun `mock server wiring updates DeviceManager server address`() {
    AbsTestEnvironment.withMockServer { server ->
      assertEquals(server.url("/").toString().trimEnd('/'), DeviceManager.serverAddress)
    }
    assertNull(DeviceManager.serverConnectionConfig)
  }
}
