package ai.openclaw.app.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class DeviceIdentityStoreTest {
  @Test
  fun namespacedIdentityDoesNotReuseDefaultDeviceIdentity() {
    val app = RuntimeEnvironment.getApplication()

    val defaultIdentity = DeviceIdentityStore(app).loadOrCreate()
    val pairingIdentity = DeviceIdentityStore(app, namespace = "operator-pairing").loadOrCreate()

    assertNotEquals(defaultIdentity.deviceId, pairingIdentity.deviceId)
    assertEquals(
      pairingIdentity.deviceId,
      DeviceIdentityStore(app, namespace = "operator-pairing").loadOrCreate().deviceId,
    )
  }
}
