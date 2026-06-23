package ai.openclaw.app.wear

import ai.openclaw.app.gateway.GatewaySession
import ai.openclaw.common.wear.WearRelayProtocol
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.Base64

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class WearSttTtsSessionTest {
  @Test
  fun resolveWearFinalAudioWaitMs_usesShortGraceWhenTextCanFallbackToSpeak() {
    assertEquals(0L, resolveWearFinalAudioWaitMs(finalEventReceived = false, assistantText = null))
    assertEquals(
      2_000L,
      resolveWearFinalAudioWaitMs(finalEventReceived = true, assistantText = "assistant reply"),
    )
    assertEquals(15_000L, resolveWearFinalAudioWaitMs(finalEventReceived = true, assistantText = ""))
  }

  @Test
  fun shouldUseTalkSpeakForWearAudio_prefersBoostedSpeakWhenAssistantTextExists() {
    assertTrue(shouldUseTalkSpeakForWearAudio("assistant reply"))
    assertTrue(shouldUseTalkSpeakForWearAudio("  assistant reply  "))
    assertFalse(shouldUseTalkSpeakForWearAudio(""))
    assertFalse(shouldUseTalkSpeakForWearAudio("   "))
  }

  @Test
  fun resolveWearAudioToPlay_prefersFinalAudioWithoutCallingTalkSpeak() =
    runTest {
      val finalAudio = WearAudioResponse(audioBytes = byteArrayOf(1, 2, 3), format = "pcm_24000")
      var talkSpeakCalled = false

      val audio =
        resolveWearAudioToPlay(
          assistantText = "assistant reply",
          spokenAudio = finalAudio,
        ) {
          talkSpeakCalled = true
          throw IllegalStateException("talk.speak unavailable")
        }

      assertSame(finalAudio, audio)
      assertFalse(talkSpeakCalled)
    }

  @Test
  fun resolveWearAudioToPlay_usesTalkSpeakWhenFinalAudioIsMissing() =
    runTest {
      val synthesizedAudio = WearAudioResponse(audioBytes = byteArrayOf(4, 5, 6), format = "pcm_24000")

      val audio =
        resolveWearAudioToPlay(
          assistantText = "assistant reply",
          spokenAudio = null,
        ) {
          synthesizedAudio
        }

      assertSame(synthesizedAudio, audio)
    }

  @Test(expected = CancellationException::class)
  fun resolveWearAudioToPlay_doesNotSwallowCancellation() =
    runTest {
      resolveWearAudioToPlay(
        assistantText = "assistant reply",
        spokenAudio = null,
      ) {
        throw CancellationException("cancelled")
      }
    }

  @Test
  fun isOggOpusGatewayAudio_rejectsGenericOggContainers() {
    assertFalse(
      isOggOpusGatewayAudio(
        outputFormat = "ogg",
        mimeType = "audio/ogg",
        fileExtension = ".ogg",
      ),
    )
    assertFalse(
      isOggOpusGatewayAudio(
        outputFormat = "notopus",
        mimeType = "audio/ogg",
        fileExtension = ".ogg",
      ),
    )
  }

  @Test
  fun isOggOpusGatewayAudio_acceptsOpusMetadata() {
    assertTrue(
      isOggOpusGatewayAudio(
        outputFormat = "opus",
        mimeType = "audio/ogg",
        fileExtension = ".opus",
      ),
    )
    assertTrue(
      isOggOpusGatewayAudio(
        outputFormat = "opus_24000",
        mimeType = "audio/ogg",
        fileExtension = ".ogg",
      ),
    )
    assertTrue(
      isOggOpusGatewayAudio(
        outputFormat = "ogg_opus",
        mimeType = "audio/ogg",
        fileExtension = ".ogg",
      ),
    )
    assertTrue(
      isOggOpusGatewayAudio(
        outputFormat = null,
        mimeType = "audio/ogg; codecs=opus",
        fileExtension = ".ogg",
      ),
    )
  }

  @Test
  fun isMp3GatewayAudio_acceptsMp3Metadata() {
    assertTrue(
      isMp3GatewayAudio(
        outputFormat = "mp3",
        mimeType = "audio/mpeg",
        fileExtension = ".mp3",
      ),
    )
    assertFalse(
      isMp3GatewayAudio(
        outputFormat = "opus",
        mimeType = "audio/ogg",
        fileExtension = ".ogg",
      ),
    )
  }

  @Test
  fun startTranscript_skipsTranscriptionAndSendsChat() =
    runTest {
      val gateway = FakeWearGateway()
      val audioResponses = mutableListOf<WearAudioResponse>()
      val session =
        WearSttTtsSession(
          scope = this,
          gateway = gateway,
          sessionKey = "main",
          onAudioResponse = { audioResponses += it },
          onStatus = {},
          onError = { error("unexpected error: $it") },
          onComplete = {},
        )

      session.startTranscript("hello sky")
      runCurrent()
      session.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"hi back"}}""",
      )
      runCurrent()

      assertFalse(gateway.methods.contains("talk.session.create"))
      assertTrue(gateway.methods.contains("chat.send"))
      assertTrue(gateway.methods.contains("talk.speak"))
      assertEquals(1, audioResponses.size)
      assertEquals(byteArrayOf(1, 0, 2, 0).toList(), audioResponses.single().audioBytes.toList())
    }

  @Test
  fun startTranscript_usesFinalMp3AudioWithoutTalkSpeak() =
    runTest {
      val gateway =
        FakeWearGateway(
          finalAudioPayloadJson =
            """{"found":true,"audioBase64":"${Base64.getEncoder().encodeToString(byteArrayOf(9, 8, 7))}","outputFormat":"mp3","mimeType":"audio/mpeg","fileExtension":".mp3"}""",
        )
      val audioResponses = mutableListOf<WearAudioResponse>()
      val session =
        WearSttTtsSession(
          scope = this,
          gateway = gateway,
          sessionKey = "main",
          responseFormat = WearRelayProtocol.RESPONSE_FORMAT_MP3,
          onAudioResponse = { audioResponses += it },
          onStatus = {},
          onError = { error("unexpected error: $it") },
          onComplete = {},
        )

      session.startTranscript("hello sky")
      runCurrent()
      session.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"hi back"}}""",
      )
      waitForGatewayMethod(gateway, "chat.finalAudio.get")
      runCurrent()

      assertFalse(gateway.methods.contains("talk.session.create"))
      assertTrue(gateway.methods.contains("chat.send"))
      assertTrue(gateway.methods.contains("chat.finalAudio.get"))
      assertFalse(gateway.methods.contains("talk.speak"))
      val chatParams =
        gateway.requests
          .single { it.method == "chat.send" }
          .paramsJson
          .orEmpty()
      val chatRoot = Json.parseToJsonElement(chatParams).jsonObject
      assertEquals("low", chatRoot["thinking"]?.jsonPrimitive?.content)
      assertEquals(1, audioResponses.size)
      assertEquals(WearRelayProtocol.RESPONSE_FORMAT_MP3, audioResponses.single().format)
      assertEquals(byteArrayOf(9, 8, 7).toList(), audioResponses.single().audioBytes.toList())
    }

  @Test
  fun startTranscript_fallbackSynthesisRequestsMp3ForMp3Watch() =
    runTest {
      assertEquals("mp3", speakOutputFormatFor(WearRelayProtocol.RESPONSE_FORMAT_MP3))
    }

  @Test
  fun startTranscript_fallbackSynthesisRequestsOpusForOggOpusWatch() =
    runTest {
      // The gateway only transcodes to Opus for the exact "opus" token, so the
      // negotiated ogg_opus Wear format must map to "opus", not "ogg_opus".
      assertEquals("opus", speakOutputFormatFor(WearRelayProtocol.RESPONSE_FORMAT_OGG_OPUS))
    }

  @Test
  fun startTranscript_fallbackSynthesisRequestsOpusForPcmWatch() =
    runTest {
      // PCM watches still ask the gateway for opus and decode locally.
      assertEquals("opus", speakOutputFormatFor(WearRelayProtocol.RESPONSE_FORMAT_PCM_24K))
    }

  private suspend fun TestScope.speakOutputFormatFor(negotiatedFormat: String): String {
    val gateway = FakeWearGateway(finalAudioPayloadJson = """{"found":false}""")
    val session =
      WearSttTtsSession(
        scope = this,
        gateway = gateway,
        sessionKey = "main",
        responseFormat = negotiatedFormat,
        onAudioResponse = {},
        onStatus = {},
        onError = { error("unexpected error: $it") },
        onComplete = {},
      )

    session.startTranscript("hello sky")
    runCurrent()
    session.handleGatewayEvent(
      "chat",
      """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"hi back"}}""",
    )
    waitForGatewayMethod(gateway, "talk.speak")
    runCurrent()

    val speakParams =
      gateway.requests
        .single { it.method == "talk.speak" }
        .paramsJson
        .orEmpty()
    return Json.parseToJsonElement(speakParams).jsonObject["outputFormat"]?.jsonPrimitive?.content.orEmpty()
  }

  @Test
  fun startTranscript_errorsWhenNoRunScopedTextOrAudioIsAvailable() =
    runTest {
      // chat final arrives with no assistant text and chat.finalAudio.get reports
      // no audio: the run-scoped recovery path is exhausted, so the turn must
      // error instead of speaking another run's history.
      val gateway = FakeWearGateway(finalAudioPayloadJson = """{"found":false}""")
      val errors = mutableListOf<String>()
      val completed = mutableListOf<WearSttTtsSession>()
      val session =
        WearSttTtsSession(
          scope = this,
          gateway = gateway,
          sessionKey = "main",
          onAudioResponse = { error("unexpected audio response") },
          onStatus = {},
          onError = { errors += it },
          onComplete = { completed += it },
        )

      session.startTranscript("hello sky")
      runCurrent()
      session.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":""}}""",
      )
      waitForGatewayMethod(gateway, "chat.finalAudio.get")
      runCurrent()

      assertEquals(listOf("No assistant response received"), errors)
      assertEquals(listOf(session), completed)
      assertFalse(gateway.methods.contains("chat.history"))
      assertFalse(gateway.methods.contains("talk.speak"))
    }

  @Test
  fun startTranscript_blankTranscriptDoesNotSendChat() =
    runTest {
      val gateway = FakeWearGateway()
      val errors = mutableListOf<String>()
      val session =
        WearSttTtsSession(
          scope = this,
          gateway = gateway,
          sessionKey = "main",
          onAudioResponse = {},
          onStatus = {},
          onError = { errors += it },
          onComplete = {},
        )

      session.startTranscript("   ")
      runCurrent()

      assertEquals(listOf("No transcript received"), errors)
      assertFalse(gateway.methods.contains("chat.send"))
    }

  @Test
  fun startTranscript_abortsPendingChatRunWhenSpeechSynthesisFails() =
    runTest {
      val gateway = FakeWearGateway(finalAudioPayloadJson = """{"found":false}""", failTalkSpeak = true)
      val errors = mutableListOf<String>()
      val session =
        WearSttTtsSession(
          scope = this,
          gateway = gateway,
          sessionKey = "main",
          onAudioResponse = { error("unexpected audio response") },
          onStatus = {},
          onError = { errors += it },
          onComplete = {},
        )

      session.startTranscript("hello sky")
      runCurrent()
      session.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"hi back"}}""",
      )
      waitForGatewayMethod(gateway, "chat.abort")

      assertTrue(errors.any { it.contains("synthesis failed") })
      assertTrue(gateway.methods.contains("chat.abort"))
    }

  @Test
  fun startTranscript_forwardsChatErrorWithoutWaitingForTimeout() =
    runTest {
      val gateway = FakeWearGateway()
      val errors = mutableListOf<String>()
      val completed = mutableListOf<WearSttTtsSession>()
      val session =
        WearSttTtsSession(
          scope = this,
          gateway = gateway,
          sessionKey = "main",
          onAudioResponse = { error("unexpected audio response") },
          onStatus = {},
          onError = { errors += it },
          onComplete = { completed += it },
        )

      session.startTranscript("hello sky")
      runCurrent()
      session.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"error","errorMessage":"All models failed"}""",
      )
      runCurrent()

      assertEquals(listOf("Voice failed: All models failed"), errors)
      assertEquals(listOf(session), completed)
      assertTrue(gateway.methods.contains("chat.abort"))
      assertFalse(gateway.methods.contains("talk.speak"))
    }

  @Test
  fun startAudioStillCreatesTranscriptionSession() =
    runTest {
      val gateway = FakeWearGateway()
      val session =
        WearSttTtsSession(
          scope = this,
          gateway = gateway,
          sessionKey = "main",
          onAudioResponse = {},
          onStatus = {},
          onError = { error("unexpected error: $it") },
          onComplete = {},
        )

      session.start(listOf(ByteArray(960) { index -> if (index % 2 == 0) 1 else 0 }))
      waitForGatewayMethod(gateway, "talk.session.appendAudio")
      session.handleGatewayEvent(
        "talk.event",
        """{"sessionId":"stt-1","type":"transcript","text":"hello sky"}""",
      )
      waitForGatewayMethod(gateway, "chat.send")
      session.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"hi back"}}""",
      )
      waitForGatewayMethod(gateway, "talk.speak")

      assertTrue(gateway.methods.contains("talk.session.create"))
      assertTrue(gateway.methods.contains("talk.session.appendAudio"))
      assertTrue(gateway.methods.contains("talk.session.close"))
      assertTrue(gateway.methods.contains("chat.send"))
    }

  @Test
  fun startAudio_retriesTranscriptionCloseWhenFirstCloseFails() =
    runTest {
      // A failed talk.session.close must not be recorded as success; the close
      // guard is released so the start job's finally block retries instead of
      // leaking the gateway transcription session until its TTL.
      val gateway = FakeWearGateway(failFirstTranscriptionClose = true)
      val errors = mutableListOf<String>()
      val session =
        WearSttTtsSession(
          scope = this,
          gateway = gateway,
          sessionKey = "main",
          onAudioResponse = { error("unexpected audio response") },
          onStatus = {},
          onError = { errors += it },
          onComplete = {},
        )

      session.start(listOf(ByteArray(960) { index -> if (index % 2 == 0) 1 else 0 }))
      // The first close throws inside transcribeAudioFrames before the transcript
      // is awaited, which fails the turn and triggers the finally-block retry.
      waitForGatewayMethodCount(gateway, "talk.session.close", 2)

      assertEquals(2, gateway.methods.count { it == "talk.session.close" })
      assertTrue(errors.any { it.contains("close failed") })
    }

  @Test
  fun startAudio_forwardsPartialTranscriptAsRawStatus() =
    runTest {
      val gateway = FakeWearGateway()
      val statuses = mutableListOf<String>()
      val session =
        WearSttTtsSession(
          scope = this,
          gateway = gateway,
          sessionKey = "main",
          onAudioResponse = {},
          onStatus = { statuses += it },
          onError = { error("unexpected error: $it") },
          onComplete = {},
        )

      session.start(listOf(ByteArray(960) { index -> if (index % 2 == 0) 1 else 0 }))
      waitForGatewayMethod(gateway, "talk.session.appendAudio")
      session.handleGatewayEvent(
        "talk.event",
        """{"sessionId":"stt-1","type":"partial","text":"hello sky"}""",
      )
      runCurrent()

      assertEquals(listOf("hello sky"), statuses)
      session.handleGatewayEvent(
        "talk.event",
        """{"sessionId":"stt-1","type":"transcript","text":"hello sky"}""",
      )
      waitForGatewayMethod(gateway, "chat.send")
      session.handleGatewayEvent(
        "chat",
        """{"runId":"run-1","state":"final","message":{"role":"assistant","content":"hi back"}}""",
      )
      waitForGatewayMethod(gateway, "talk.speak")
    }
}

private suspend fun waitForGatewayMethod(
  gateway: FakeWearGateway,
  method: String,
) {
  withTimeout(2_000) {
    while (!gateway.methods.contains(method)) {
      delay(10)
    }
  }
}

private suspend fun waitForGatewayMethodCount(
  gateway: FakeWearGateway,
  method: String,
  count: Int,
) {
  withTimeout(2_000) {
    while (gateway.methods.count { it == method } < count) {
      delay(10)
    }
  }
}

private class FakeWearGateway(
  private val finalAudioPayloadJson: String = """{"found":false}""",
  private val failTalkSpeak: Boolean = false,
  private val failFirstTranscriptionClose: Boolean = false,
) : WearGateway {
  val requests = mutableListOf<Request>()

  private var transcriptionCloseAttempts = 0

  val methods: List<String>
    get() = requests.map { it.method }

  override suspend fun request(
    method: String,
    paramsJson: String?,
    timeoutMs: Long,
  ): String {
    requests += Request(method = method, paramsJson = paramsJson)
    return when (method) {
      "talk.session.create" -> """{"sessionId":"stt-1"}"""
      "talk.session.appendAudio" -> "{}"
      "talk.session.close" -> {
        transcriptionCloseAttempts += 1
        if (failFirstTranscriptionClose && transcriptionCloseAttempts == 1) {
          error("close failed")
        }
        "{}"
      }
      "chat.send" -> """{"runId":"run-1"}"""
      "talk.speak" -> {
        if (failTalkSpeak) error("synthesis failed")
        """{"audioBase64":"${Base64.getEncoder().encodeToString(byteArrayOf(1, 0, 2, 0))}","outputFormat":"pcm_24000"}"""
      }
      else -> "{}"
    }
  }

  override suspend fun requestDetailed(
    method: String,
    paramsJson: String?,
    timeoutMs: Long,
  ): GatewaySession.RpcResult {
    requests += Request(method = method, paramsJson = paramsJson)
    return GatewaySession.RpcResult(ok = true, payloadJson = finalAudioPayloadJson, error = null)
  }

  data class Request(
    val method: String,
    val paramsJson: String?,
  )
}
