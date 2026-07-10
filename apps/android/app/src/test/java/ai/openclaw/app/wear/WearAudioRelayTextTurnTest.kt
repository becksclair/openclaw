package ai.openclaw.app.wear

import ai.openclaw.app.gateway.GatewaySession
import ai.openclaw.common.wear.WearReasoningLevel
import ai.openclaw.common.wear.WearRelayProtocol
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
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
  fun audioTurnTranscribesChatsAndReturnsSynthesizedSpeech() =
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
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_START, "audio-turn"),
        """{"acceptedResponseFormats":["mp3","pcm_24000"],"reasoningLevel":"medium"}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.audioChunkPath("audio-turn", 0),
        byteArrayOf(1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_END, "audio-turn"),
        ByteArray(0),
        sourceNodeId = "watch-node",
      )

      waitForGatewayMethod(gateway, "talk.session.close")
      relay.handleGatewayEvent(
        "talk.event",
        """{"type":"transcript","transcriptionSessionId":"stt-1","text":"turn transcript"}""",
      )
      waitForGatewayMethod(gateway, "chat.send")
      relay.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"audio reply"}}""",
      )
      waitForSentPath(transport, "/openclaw/watch/audio/audio-turn/done")

      assertTrue(gateway.methods.contains("talk.session.create"))
      assertTrue(gateway.methods.contains("talk.session.appendAudio"))
      assertTrue(gateway.methods.contains("talk.session.close"))
      assertTrue(gateway.methods.contains("chat.send"))
      assertFalse(gateway.methods.contains("chat.finalAudio.get"))
      assertTrue(gateway.methods.contains("talk.speak"))
      val chatParams =
        gateway.requests
          .single { it.method == "chat.send" }
          .paramsJson
          .orEmpty()
      val chatRoot = json.parseToJsonElement(chatParams).jsonObject
      assertEquals("wear-main", chatRoot["sessionKey"]?.jsonPrimitive?.content)
      assertEquals("turn transcript", chatRoot["message"]?.jsonPrimitive?.content)
      assertEquals(WearReasoningLevel.MEDIUM, chatRoot["thinking"]?.jsonPrimitive?.content)
    }

  @Test
  fun lateAudioChunkForCompletedTurnIsIgnored() =
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
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_START, "audio-turn"),
        """{"acceptedResponseFormats":["mp3","pcm_24000"]}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.audioChunkPath("audio-turn", 0),
        byteArrayOf(1, 0, 2, 0, 3, 0, 4, 0),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_END, "audio-turn"),
        ByteArray(0),
        sourceNodeId = "watch-node",
      )
      waitForGatewayMethod(gateway, "talk.session.close")
      relay.handleGatewayEvent(
        "talk.event",
        """{"type":"transcript","transcriptionSessionId":"stt-1","text":"turn transcript"}""",
      )
      waitForGatewayMethod(gateway, "chat.send")
      relay.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"audio reply"}}""",
      )
      waitForSentPath(transport, "/openclaw/watch/audio/audio-turn/done")

      val sessionsBefore = gateway.requests.count { it.method == "talk.session.create" }

      // A stale chunk for the already-finished turn must not auto-start a fresh run.
      relay.handleWatchMessage(
        WearRelayProtocol.audioChunkPath("audio-turn", 1),
        byteArrayOf(9, 0, 9, 0),
        sourceNodeId = "watch-node",
      )
      delay(50)

      assertEquals(sessionsBefore, gateway.requests.count { it.method == "talk.session.create" })
      assertEquals(1, gateway.requests.count { it.method == "chat.send" })
    }

  @Test
  fun audioChunkMiddleGapFailsTheTurnAtEnd() =
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
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_START, "gap-turn"),
        """{"acceptedResponseFormats":["mp3","pcm_24000"]}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.audioChunkPath("gap-turn", 0),
        byteArrayOf(1, 0, 2, 0),
        sourceNodeId = "watch-node",
      )
      // Index 2 arrives but index 1 is never sent: a real middle drop. The relay
      // tolerates this mid-stream (a benign reorder could still fill index 1) and
      // only detects the hole when PATH_END assembles the buffer.
      relay.handleWatchMessage(
        WearRelayProtocol.audioChunkPath("gap-turn", 2),
        byteArrayOf(3, 0, 4, 0),
        sourceNodeId = "watch-node",
      )
      // No error yet: a mid-stream gap must never fail the turn.
      delay(50)
      assertFalse(transport.sent.any { it.path == "/openclaw/watch/error" })

      // PATH_END finds the hole (indices {0,2}, no contiguous 0..1..2) and fails.
      relay.handleWatchMessage(
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_END, "gap-turn"),
        ByteArray(0),
        sourceNodeId = "watch-node",
      )
      waitForSentPath(transport, "/openclaw/watch/error")

      val errorMessage = transport.sent.single { it.path == "/openclaw/watch/error" }
      val errorRoot = json.parseToJsonElement(errorMessage.data.decodeToString()).jsonObject
      assertEquals("audio dropped", errorRoot["message"]?.jsonPrimitive?.content)
      assertEquals("gap-turn", errorRoot["turnId"]?.jsonPrimitive?.content)

      // The holey buffer is never transcribed.
      assertFalse(gateway.methods.contains("talk.session.close"))
      assertFalse(gateway.methods.contains("chat.send"))
    }

  @Test
  fun outOfOrderAudioChunksAreReassembledAndTranscribed() =
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
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_START, "reorder-turn"),
        """{"acceptedResponseFormats":["mp3","pcm_24000"]}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      // The Data Layer does not guarantee ordering: index 1 lands before index 0.
      relay.handleWatchMessage(
        WearRelayProtocol.audioChunkPath("reorder-turn", 1),
        byteArrayOf(3, 0, 4, 0),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.audioChunkPath("reorder-turn", 0),
        byteArrayOf(1, 0, 2, 0),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_END, "reorder-turn"),
        ByteArray(0),
        sourceNodeId = "watch-node",
      )

      // Indices {0,1} are contiguous once reordered, so the turn proceeds to STT.
      waitForGatewayMethod(gateway, "talk.session.close")
      relay.handleGatewayEvent(
        "talk.event",
        """{"type":"transcript","transcriptionSessionId":"stt-1","text":"reordered transcript"}""",
      )
      waitForGatewayMethod(gateway, "chat.send")
      relay.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"audio reply"}}""",
      )
      waitForSentPath(transport, "/openclaw/watch/audio/reorder-turn/done")

      // No drop was reported despite the out-of-order arrival: indices {1,0}
      // buffered, then the END contiguity check passed. The relay always
      // assembles via (0 until count).map { getValue(it) }, so the PCM handed to
      // STT is in ascending index order regardless of arrival order.
      assertFalse(transport.sent.any { it.path == "/openclaw/watch/error" })
      assertTrue(gateway.methods.contains("talk.session.appendAudio"))
      assertTrue(gateway.methods.contains("talk.session.close"))
      assertTrue(gateway.methods.contains("chat.send"))
    }

  @Test
  fun delayedStartPayloadUpdatesChunkFirstAudioTurnReasoning() =
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
        WearRelayProtocol.audioChunkPath("chunk-first-turn", 0),
        byteArrayOf(1, 0, 2, 0, 3, 0, 4, 0),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_START, "chunk-first-turn"),
        """{"acceptedResponseFormats":["mp3","pcm_24000"],"reasoningLevel":"high"}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_END, "chunk-first-turn"),
        ByteArray(0),
        sourceNodeId = "watch-node",
      )

      waitForGatewayMethod(gateway, "talk.session.close")
      relay.handleGatewayEvent(
        "talk.event",
        """{"type":"transcript","transcriptionSessionId":"stt-1","text":"chunk first transcript"}""",
      )
      waitForGatewayMethod(gateway, "chat.send")

      val chatParams =
        gateway.requests
          .single { it.method == "chat.send" }
          .paramsJson
          .orEmpty()
      val chatRoot = json.parseToJsonElement(chatParams).jsonObject
      assertEquals("chunk first transcript", chatRoot["message"]?.jsonPrimitive?.content)
      assertEquals(WearReasoningLevel.HIGH, chatRoot["thinking"]?.jsonPrimitive?.content)
    }

  @Test
  fun recordingLeaseExpiryTearsDownTurnWithoutPathEnd() =
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
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_START, "stuck-turn"),
        """{"acceptedResponseFormats":["mp3","pcm_24000"]}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.audioChunkPath("stuck-turn", 0),
        byteArrayOf(1, 0, 2, 0),
        sourceNodeId = "watch-node",
      )

      // The watch disconnects mid-recording and never sends PATH_END. Advancing
      // virtual time past MAX_RECORDING_MS (60s) fires the recording-lease watchdog.
      advanceTimeBy(61_000)
      runCurrent()
      waitForSentPath(transport, "/openclaw/watch/error")

      val errorMessage = transport.sent.single { it.path == "/openclaw/watch/error" }
      val errorRoot = json.parseToJsonElement(errorMessage.data.decodeToString()).jsonObject
      assertEquals("Recording timed out", errorRoot["message"]?.jsonPrimitive?.content)
      assertEquals("stuck-turn", errorRoot["turnId"]?.jsonPrimitive?.content)
      // The stale turn never reached STT/chat.
      assertFalse(gateway.methods.contains("talk.session.close"))
      assertFalse(gateway.methods.contains("chat.send"))

      // State was reset, so a brand-new turn can start and run to completion.
      relay.handleWatchMessage(
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_START, "fresh-turn"),
        """{"acceptedResponseFormats":["mp3","pcm_24000"]}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.audioChunkPath("fresh-turn", 0),
        byteArrayOf(5, 0, 6, 0),
        sourceNodeId = "watch-node",
      )
      relay.handleWatchMessage(
        WearRelayProtocol.turnPath(WearRelayProtocol.PATH_END, "fresh-turn"),
        ByteArray(0),
        sourceNodeId = "watch-node",
      )
      waitForGatewayMethod(gateway, "talk.session.close")
    }

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
        """{"text":" hello sky ","acceptedResponseFormats":["mp3","pcm_24000"],"reasoningLevel":"high"}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      waitForGatewayMethod(gateway, "chat.send")
      relay.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"hi back"}}""",
      )
      waitForGatewayMethod(gateway, "talk.speak")
      waitForSentPath(transport, "/openclaw/watch/audio/turn-1/done")

      assertFalse(gateway.methods.contains("talk.session.create"))
      assertFalse(gateway.methods.contains("talk.session.appendAudio"))
      assertFalse(gateway.methods.contains("talk.session.close"))
      assertTrue(gateway.methods.contains("chat.send"))
      assertFalse(gateway.methods.contains("chat.finalAudio.get"))
      assertTrue(gateway.methods.contains("talk.speak"))
      val chatParams =
        gateway.requests
          .single { it.method == "chat.send" }
          .paramsJson
          .orEmpty()
      val chatRoot = json.parseToJsonElement(chatParams).jsonObject
      assertEquals("wear-main", chatRoot["sessionKey"]?.jsonPrimitive?.content)
      assertEquals("hello sky", chatRoot["message"]?.jsonPrimitive?.content)
      assertEquals(WearReasoningLevel.HIGH, chatRoot["thinking"]?.jsonPrimitive?.content)
    }

  @Test
  fun duplicateTextTurnDoesNotRestartChatRun() =
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
      val path = "/openclaw/watch/text/turn-1"
      val payload = """{"text":"hello sky","acceptedResponseFormats":["mp3","pcm_24000"],"reasoningLevel":"high"}""".toByteArray()

      relay.handleWatchMessage(path, payload, sourceNodeId = "watch-node")
      waitForGatewayMethod(gateway, "chat.send")
      relay.handleWatchMessage(path, payload, sourceNodeId = "watch-node")
      delay(50)

      assertEquals(1, gateway.requests.count { it.method == "chat.send" })
      assertFalse(gateway.methods.contains("chat.abort"))
    }

  @Test
  fun completedTextTurnRedeliveryDoesNotRestartChatRun() =
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
      val path = "/openclaw/watch/text/turn-complete"
      val payload = """{"text":"hello sky","acceptedResponseFormats":["mp3","pcm_24000"]}""".toByteArray()

      relay.handleWatchMessage(path, payload, sourceNodeId = "watch-node")
      waitForGatewayMethod(gateway, "chat.send")
      relay.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"hi back"}}""",
      )
      waitForSentPath(transport, "/openclaw/watch/audio/turn-complete/done")
      relay.handleWatchMessage(path, payload, sourceNodeId = "watch-node")
      delay(50)

      assertEquals(1, gateway.requests.count { it.method == "chat.send" })
      assertFalse(gateway.methods.contains("chat.abort"))
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
  fun foregroundListenerIgnoresWatchMessageUntilGatewayCanHandleRelay() =
    runTest {
      val gateway = FakeWearRelayGateway()
      val transport = FakeWearRelayTransport()
      val relay =
        WearAudioRelay(
          gateway = gateway,
          wearTargetSessionKeyProvider = { "wear-main" },
          transport = transport,
          canHandleMessages = { false },
          scope = this,
        )

      relay.handleWatchMessage(
        "/openclaw/watch/text/turn-not-ready",
        """{"text":"hello"}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      delay(50)

      assertTrue(gateway.requests.isEmpty())
      assertTrue(transport.sent.isEmpty())
    }

  @Test
  fun chunkedTextTurnSendsDoneAfterAllIndexedChunks() =
    runTest {
      val gateway =
        FakeWearRelayGateway(
          speakAudioBytes = ByteArray(180_000) { index -> (index % 127).toByte() },
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

  @Test
  fun largeCompressedTalkSpeakUsesChunkedAudioDelivery() =
    runTest {
      val gateway =
        FakeWearRelayGateway(
          speakAudioBytes = ByteArray(385 * 1024) { 1 },
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
        "/openclaw/watch/text/turn-large-speak",
        """{"text":"tell me a long story","acceptedResponseFormats":["mp3","pcm_24000"]}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      waitForGatewayMethod(gateway, "chat.send")
      relay.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"long story"}}""",
      )
      waitForSentPath(transport, "/openclaw/watch/audio/turn-large-speak/done")

      assertTrue(gateway.methods.contains("talk.speak"))
      val paths = transport.sent.map { it.path }
      assertTrue(paths.contains("/openclaw/watch/audio/turn-large-speak/0"))
      assertTrue(paths.contains("/openclaw/watch/audio/turn-large-speak/1"))
      val doneData =
        transport.sent
          .single { it.path == "/openclaw/watch/audio/turn-large-speak/done" }
          .data
          .decodeToString()
      val doneRoot =
        json
          .parseToJsonElement(doneData)
          .jsonObject
      assertEquals("5", doneRoot["chunkCount"]?.jsonPrimitive?.content)
      assertEquals("turn-large-speak", doneRoot["turnId"]?.jsonPrimitive?.content)
      assertEquals("mp3", doneRoot["format"]?.jsonPrimitive?.content)
    }

  @Test
  fun smallResponseIsDeliveredBeforeTurnCompletesAndUsesSingleChunk() =
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
      val path = "/openclaw/watch/text/turn-deliver"
      val payload = """{"text":"hello sky","acceptedResponseFormats":["mp3","pcm_24000"]}""".toByteArray()

      relay.handleWatchMessage(path, payload, sourceNodeId = "watch-node")
      waitForGatewayMethod(gateway, "chat.send")
      relay.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"hi back"}}""",
      )
      // The done marker is the last message of the awaited send, so observing it
      // proves the audio reached the transport before the turn could complete.
      waitForSentPath(transport, "/openclaw/watch/audio/turn-deliver/done")

      val paths = transport.sent.map { it.path }
      val chunkIndex = paths.indexOf("/openclaw/watch/audio/turn-deliver/0")
      val doneIndex = paths.indexOf("/openclaw/watch/audio/turn-deliver/done")
      assertTrue(chunkIndex >= 0)
      assertTrue(doneIndex > chunkIndex)
      val doneRoot = json.parseToJsonElement(transport.sent[doneIndex].data.decodeToString()).jsonObject
      // A small response is the chunkCount == 1 case of the single chunked path.
      assertEquals("1", doneRoot["chunkCount"]?.jsonPrimitive?.content)

      // The turn is completed only after delivery: a redelivery is now treated as
      // an already-finished turn and does not restart the chat run.
      relay.handleWatchMessage(path, payload, sourceNodeId = "watch-node")
      delay(50)
      assertEquals(1, gateway.requests.count { it.method == "chat.send" })
      assertFalse(gateway.methods.contains("chat.abort"))
    }

  @Test
  fun responseSendFailureFailsTheTurnWithPathError() =
    runTest {
      val gateway = FakeWearRelayGateway()
      // Fail the audio response send; status/error sends still go through so the
      // watch can be told the turn failed.
      val transport = FakeWearRelayTransport(failPathSubstring = "/openclaw/watch/audio/")
      val relay =
        WearAudioRelay(
          gateway = gateway,
          wearTargetSessionKeyProvider = { "wear-main" },
          transport = transport,
          scope = this,
        )

      relay.handleWatchMessage(
        "/openclaw/watch/text/turn-send-fail",
        """{"text":"hello sky","acceptedResponseFormats":["mp3","pcm_24000"]}""".toByteArray(),
        sourceNodeId = "watch-node",
      )
      waitForGatewayMethod(gateway, "chat.send")
      relay.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"hi back"}}""",
      )
      // A send failure must surface as PATH_ERROR, not a swallowed log line.
      waitForSentPath(transport, WearRelayProtocol.PATH_ERROR)
      delay(50)

      val errorMessage = transport.sent.single { it.path == WearRelayProtocol.PATH_ERROR }
      val errorRoot = json.parseToJsonElement(errorMessage.data.decodeToString()).jsonObject
      assertTrue(errorRoot["message"]?.jsonPrimitive?.content?.startsWith("Voice failed:") == true)
      assertEquals("turn-send-fail", errorRoot["turnId"]?.jsonPrimitive?.content)
      // No silent success: the done marker is never delivered for a failed send.
      assertFalse(transport.sent.any { it.path == "/openclaw/watch/audio/turn-send-fail/done" })
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
  private val speakAudioBytes: ByteArray = byteArrayOf(1, 2, 3, 4),
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
      "talk.session.create" -> """{"transcriptionSessionId":"stt-1"}"""
      "chat.send" -> """{"runId":"run-1"}"""
      "talk.speak" ->
        """{"audioBase64":"${Base64.getEncoder().encodeToString(speakAudioBytes)}","outputFormat":"mp3","mimeType":"audio/mpeg","fileExtension":".mp3"}"""
      else -> "{}"
    }
  }

  override suspend fun requestDetailed(
    method: String,
    paramsJson: String?,
    timeoutMs: Long,
  ): GatewaySession.RpcResult {
    requests += Request(method = method, paramsJson = paramsJson)
    error("unexpected detailed request: $method")
  }

  data class Request(
    val method: String,
    val paramsJson: String?,
  )
}

private class FakeWearRelayTransport(
  private val failPathSubstring: String? = null,
) : WearRelayTransport {
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
    // Record before throwing is intentionally skipped for failing paths: the
    // send never reached the watch, so it must not appear as a delivered message.
    if (failPathSubstring != null && path.contains(failPathSubstring)) {
      throw IllegalStateException("send failed for $path")
    }
    sent += SentMessage(nodeId = nodeId, path = path, data = data)
  }

  data class SentMessage(
    val nodeId: String,
    val path: String,
    val data: ByteArray,
  )
}
