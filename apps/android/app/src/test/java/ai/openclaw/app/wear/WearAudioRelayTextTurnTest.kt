package ai.openclaw.app.wear

import ai.openclaw.app.gateway.GatewaySession
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.Base64

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class WearAudioRelayTextTurnTest {
  private val json = Json { ignoreUnknownKeys = true }

  @Test
  fun textTurnRoutesTranscriptToChatTtsWithoutTranscriptionSession() =
    runTest {
      val gateway = FakeWearRelayGateway()
      val transport = FakeWearRelayTransport()
      val relay =
        WearAudioRelay(
          gateway = gateway,
          wearTargetSessionKeyProvider = { "wear-main" },
          transport = transport,
          scope = this,
        )

      relay.handleWatchMessage(
        "/openclaw/watch/text/turn-1",
        """{"text":" hello sky ","acceptedResponseFormats":["mp3","ogg_opus","pcm_24000"]}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      waitForGatewayMethod(gateway, "chat.send")
      relay.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"hi back"}}""",
      )
      waitForGatewayMethod(gateway, "chat.finalAudio.get")
      waitForSentPath(transport, "/openclaw/watch/audio/turn-1/format/mp3")

      assertFalse(gateway.methods.contains("talk.session.create"))
      assertFalse(gateway.methods.contains("talk.session.appendAudio"))
      assertFalse(gateway.methods.contains("talk.session.close"))
      assertTrue(gateway.methods.contains("chat.send"))
      assertTrue(gateway.methods.contains("chat.finalAudio.get"))
      assertFalse(gateway.methods.contains("talk.speak"))
      val chatParams =
        gateway.requests
          .single { it.method == "chat.send" }
          .paramsJson
          .orEmpty()
      val chatRoot = json.parseToJsonElement(chatParams).jsonObject
      assertEquals("wear-main", chatRoot["sessionKey"]?.jsonPrimitive?.content)
      assertEquals("hello sky", chatRoot["message"]?.jsonPrimitive?.content)
      assertEquals("low", chatRoot["thinking"]?.jsonPrimitive?.content)
    }

  @Test
  fun blankTextTurnReturnsErrorWithoutChatRun() =
    runTest {
      val gateway = FakeWearRelayGateway()
      val transport = FakeWearRelayTransport()
      val relay =
        WearAudioRelay(
          gateway = gateway,
          wearTargetSessionKeyProvider = { "wear-main" },
          transport = transport,
          scope = this,
        )

      relay.handleWatchMessage(
        "/openclaw/watch/text/turn-blank",
        """{"text":"   ","acceptedResponseFormats":["pcm_24000"]}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      waitForSentPath(transport, "/openclaw/watch/error")

      assertFalse(gateway.methods.contains("chat.send"))
      val errorMessage = transport.sent.single { it.path == "/openclaw/watch/error" }
      val errorRoot = json.parseToJsonElement(errorMessage.data.decodeToString()).jsonObject
      assertEquals("No speech recognized", errorRoot["message"]?.jsonPrimitive?.content)
      assertEquals("turn-blank", errorRoot["turnId"]?.jsonPrimitive?.content)
    }

  @Test
  fun chunkedTextTurnSendsDoneAfterAllIndexedChunks() =
    runTest {
      val gateway =
        FakeWearRelayGateway(
          finalAudioBytes = ByteArray(180_000) { index -> (index % 127).toByte() },
        )
      val transport = FakeWearRelayTransport()
      val relay =
        WearAudioRelay(
          gateway = gateway,
          wearTargetSessionKeyProvider = { "wear-main" },
          transport = transport,
          scope = this,
        )

      relay.handleWatchMessage(
        "/openclaw/watch/text/turn-big",
        """{"text":"tell me something","acceptedResponseFormats":["mp3","pcm_24000"]}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      waitForGatewayMethod(gateway, "chat.send")
      relay.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"big audio"}}""",
      )
      waitForSentPath(transport, "/openclaw/watch/audio/turn-big/done")

      val paths = transport.sent.map { it.path }
      val firstChunkIndex = paths.indexOf("/openclaw/watch/audio/turn-big/0")
      val secondChunkIndex = paths.indexOf("/openclaw/watch/audio/turn-big/1")
      val doneIndex = paths.indexOf("/openclaw/watch/audio/turn-big/done")
      assertTrue(firstChunkIndex >= 0)
      assertTrue(secondChunkIndex >= 0)
      assertTrue(doneIndex > firstChunkIndex)
      assertTrue(doneIndex > secondChunkIndex)
      val doneRoot = json.parseToJsonElement(transport.sent[doneIndex].data.decodeToString()).jsonObject
      assertEquals("2", doneRoot["chunkCount"]?.jsonPrimitive?.content)
      assertEquals("turn-big", doneRoot["turnId"]?.jsonPrimitive?.content)
      assertEquals("mp3", doneRoot["format"]?.jsonPrimitive?.content)
    }
}

private suspend fun waitForGatewayMethod(
  gateway: FakeWearRelayGateway,
  method: String,
) {
  withTimeout(2_000) {
    while (!gateway.methods.contains(method)) {
      delay(10)
    }
  }
}

private suspend fun waitForSentPath(
  transport: FakeWearRelayTransport,
  path: String,
) {
  withTimeout(2_000) {
    while (transport.sent.none { it.path == path }) {
      delay(10)
    }
  }
}

private class FakeWearRelayGateway(
  private val finalAudioBytes: ByteArray = byteArrayOf(1, 2, 3, 4),
) : WearGateway {
  val requests = mutableListOf<Request>()

  val methods: List<String>
    get() = requests.map { it.method }

  override suspend fun request(
    method: String,
    paramsJson: String?,
    timeoutMs: Long,
  ): String {
    requests += Request(method = method, paramsJson = paramsJson)
    return when (method) {
      "chat.send" -> """{"runId":"run-1"}"""
      "talk.speak" ->
        """{"audioBase64":"${Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3, 4))}","outputFormat":"opus"}"""
      else -> "{}"
    }
  }

  override suspend fun requestDetailed(
    method: String,
    paramsJson: String?,
    timeoutMs: Long,
  ): GatewaySession.RpcResult {
    requests += Request(method = method, paramsJson = paramsJson)
    return GatewaySession.RpcResult(
      ok = true,
      payloadJson =
        """{"found":true,"audioBase64":"${Base64.getEncoder().encodeToString(finalAudioBytes)}","outputFormat":"mp3","mimeType":"audio/mpeg","fileExtension":".mp3"}""",
      error = null,
    )
  }

  data class Request(
    val method: String,
    val paramsJson: String?,
  )
}

private class FakeWearRelayTransport : WearRelayTransport {
  val sent = mutableListOf<SentMessage>()
  private var listener: WearRelayMessageListener? = null

  override fun addListener(listener: WearRelayMessageListener) {
    this.listener = listener
  }

  override fun removeListener(listener: WearRelayMessageListener) {
    if (this.listener == listener) {
      this.listener = null
    }
  }

  override suspend fun connectedNodeIds(): List<String> = listOf("watch-node")

  override suspend fun sendToNode(
    nodeId: String,
    path: String,
    data: ByteArray,
  ) {
    sent += SentMessage(nodeId = nodeId, path = path, data = data)
  }

  data class SentMessage(
    val nodeId: String,
    val path: String,
    val data: ByteArray,
  )
}
