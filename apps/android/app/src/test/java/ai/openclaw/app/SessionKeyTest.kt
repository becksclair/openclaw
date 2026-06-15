package ai.openclaw.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionKeyTest {
  @Test
  fun buildNodeMainSessionKeyUsesStableDeviceScopedSuffix() {
    val key = buildNodeMainSessionKey(deviceId = "1234567890abcdef", agentId = "ops")

    assertEquals("agent:ops:node-1234567890ab", key)
  }

  @Test
  fun resolveAgentIdFromMainSessionKeyParsesCanonicalAgentKey() {
    assertEquals("ops", resolveAgentIdFromMainSessionKey("agent:ops:main"))
    assertNull(resolveAgentIdFromMainSessionKey("global"))
  }

  @Test
  fun buildGatewayMainSessionKeyPreservesGatewayCanonicalKey() {
    assertEquals("agent:sky:main", buildGatewayMainSessionKey("ops", "agent:sky:main"))
    assertEquals("global", buildGatewayMainSessionKey("ops", "global"))
  }

  @Test
  fun buildGatewayMainSessionKeyScopesBareMainKeyToAgent() {
    assertEquals("agent:ops:main", buildGatewayMainSessionKey("ops", "main"))
    assertEquals("main", buildGatewayMainSessionKey(null, null))
    assertEquals("main", buildGatewayMainSessionKey(null, "main"))
  }

  @Test
  fun resolveGatewayMainSessionKeyPreservesGlobalScope() {
    assertEquals(
      "global",
      resolveGatewayMainSessionKey(
        agentId = "ops",
        mainKey = "main",
        scope = "global",
      ),
    )
    assertEquals(
      "agent:ops:main",
      resolveGatewayMainSessionKey(
        agentId = "ops",
        mainKey = "main",
        scope = "per-sender",
      ),
    )
  }

  @Test
  fun resolveConversationTargetSessionKeyFollowsSelectedOnlyInFollowMode() {
    assertEquals(
      "agent:sky:telegram:direct:42",
      resolveConversationTargetSessionKey(
        mode = SessionTargetMode.FollowSelected,
        mainSessionKey = "agent:sky:main",
        currentSessionKey = "agent:sky:telegram:direct:42",
      ),
    )
    assertEquals(
      "agent:sky:main",
      resolveConversationTargetSessionKey(
        mode = SessionTargetMode.FollowSelected,
        mainSessionKey = "agent:sky:main",
        currentSessionKey = "main",
      ),
    )
    assertEquals(
      "agent:sky:main",
      resolveConversationTargetSessionKey(
        mode = SessionTargetMode.Main,
        mainSessionKey = "agent:sky:main",
        currentSessionKey = "agent:sky:telegram:direct:42",
      ),
    )
    assertEquals(
      "agent:sky:node-device",
      resolveConversationTargetSessionKey(
        mode = SessionTargetMode.Device,
        mainSessionKey = "agent:sky:node-device",
        currentSessionKey = "agent:sky:telegram:direct:42",
      ),
    )
  }

  @Test
  fun resolveWearConversationTargetSessionKeyUsesExplicitOverrideFirst() {
    assertEquals(
      "agent:sky:direct:bex",
      resolveWearConversationTargetSessionKey(
        explicitWearTargetSessionKey = " agent:sky:direct:bex ",
        mode = SessionTargetMode.FollowSelected,
        mainSessionKey = "agent:sky:main",
        currentSessionKey = "agent:sky:telegram:direct:42",
      ),
    )
    assertEquals(
      "agent:sky:telegram:direct:42",
      resolveWearConversationTargetSessionKey(
        explicitWearTargetSessionKey = null,
        mode = SessionTargetMode.FollowSelected,
        mainSessionKey = "agent:sky:main",
        currentSessionKey = "agent:sky:telegram:direct:42",
      ),
    )
    assertEquals(
      "agent:sky:main",
      resolveWearConversationTargetSessionKey(
        explicitWearTargetSessionKey = "main",
        mode = SessionTargetMode.Main,
        mainSessionKey = "agent:sky:main",
        currentSessionKey = "agent:sky:telegram:direct:42",
      ),
    )
  }
}
