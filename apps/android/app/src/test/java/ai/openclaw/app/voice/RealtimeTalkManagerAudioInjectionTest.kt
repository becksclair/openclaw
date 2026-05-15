package ai.openclaw.app.voice

import ai.openclaw.app.gateway.DeviceAuthEntry
import ai.openclaw.app.gateway.DeviceAuthTokenStore
import ai.openclaw.app.gateway.DeviceIdentityStore
import ai.openclaw.app.gateway.GatewayClientInfo
import ai.openclaw.app.gateway.GatewayConnectOptions
import ai.openclaw.app.gateway.GatewayEndpoint
import ai.openclaw.app.gateway.GatewaySession
import android.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger

private const val REALTIME_AUDIO_TEST_TIMEOUT_MS = 8_000L
private const val REALTIME_CONNECT_CHALLENGE_FRAME =
  """{"type":"event","event":"connect.challenge","payload":{"nonce":"android-realtime-audio-test"}}"""

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RealtimeTalkManagerAudioInjectionTest {
  @Test
  fun adaptiveJitterStartsAtCurrentSmoothBaseline() {
    val controller = RealtimePlaybackJitterController()

    val targets = controller.currentTargets()

    assertEquals(1_600, targets.prebufferMs)
    assertEquals(1_300L, targets.drainIdleMs)
  }

  @Test
  fun adaptiveJitterRaisesBufferForLongProviderBurstGaps() {
    val controller = RealtimePlaybackJitterController()

    controller.observeAudioChunk(1_000)
    val targets = controller.observeAudioChunk(2_350)

    assertEquals(1_350L, targets.observedGapMs)
    assertTrue(targets.prebufferMs > 1_900)
    assertTrue(targets.drainIdleMs > 1_600)
  }

  @Test
  fun adaptiveJitterDoesNotDecayBelowSmoothBaseline() {
    val controller = RealtimePlaybackJitterController()
    var now = 1_000L
    var targets = controller.observeAudioChunk(now)

    repeat(40) {
      now += 100
      targets = controller.observeAudioChunk(now)
    }

    assertEquals(1_600, targets.prebufferMs)
    assertEquals(1_300L, targets.drainIdleMs)
  }

  @Test
  fun adaptiveJitterDoesNotReportStaleObservedGap() {
    val controller = RealtimePlaybackJitterController()

    controller.observeAudioChunk(1_000)
    val observed = controller.observeAudioChunk(1_306)
    val ignored = controller.observeAudioChunk(1_307)

    assertEquals(306L, observed.observedGapMs)
    assertEquals(null, ignored.observedGapMs)
    assertEquals(observed.prebufferMs, ignored.prebufferMs)
    assertEquals(observed.drainIdleMs, ignored.drainIdleMs)
  }

  @Test
  fun activeRelaySessionReflectsCurrentRelayState() =
    runBlocking {
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = {},
          onListening = {},
          onSpeaking = {},
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = NoopRealtimeAudioCapture(),
          player = NoopRealtimeAudioPlayback(),
        )

      try {
        assertFalse(manager.hasActiveRelaySession())
        setRelaySessionId(manager, "relay-active")
        assertTrue(manager.hasActiveRelaySession())
        manager.stop(notifyGateway = false)
        assertFalse(manager.hasActiveRelaySession())
      } finally {
        manager.stop(notifyGateway = false)
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
      }
    }

  @Test
  fun relayAudioPlaybackPreservesEventOrder() =
    runBlocking {
      val playback = OrderedRecordingAudioPlayback()
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = {},
          onListening = {},
          onSpeaking = {},
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = NoopRealtimeAudioCapture(),
          player = playback,
        )

      try {
        setRelaySessionId(manager, "relay-order")

        manager.handleRelayEvent("relay-order", RealtimeTalkRelayEvent.Audio("first"))
        manager.handleRelayEvent("relay-order", RealtimeTalkRelayEvent.Audio("second"))

        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.awaitWriteCount(2) }
        assertEquals(listOf("first", "second"), playback.writesSnapshot())
      } finally {
        manager.stop(notifyGateway = false)
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
      }
    }

  @Test
  fun relayClearDropsStaleQueuedPlayback() =
    runBlocking {
      val playback = GatedRecordingAudioPlayback(blockedChunk = "blocking")
      val speakingValues = Collections.synchronizedList(mutableListOf<Boolean>())
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = {},
          onListening = {},
          onSpeaking = { speakingValues.add(it) },
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = NoopRealtimeAudioCapture(),
          player = playback,
        )

      try {
        setRelaySessionId(manager, "relay-clear")

        manager.handleRelayEvent("relay-clear", RealtimeTalkRelayEvent.Audio("blocking"))
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.blockedWriteStarted.await() }
        manager.handleRelayEvent("relay-clear", RealtimeTalkRelayEvent.Audio("stale"))
        manager.handleRelayEvent("relay-clear", RealtimeTalkRelayEvent.Clear)
        manager.handleRelayEvent("relay-clear", RealtimeTalkRelayEvent.Audio("fresh"))

        delay(100)
        assertEquals(emptyList<String>(), playback.writesSnapshot())
        playback.releaseBlockedWrite.complete(Unit)
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.awaitWriteCount(2) }

        assertEquals(listOf("blocking", "fresh"), playback.writesSnapshot())
        assertEquals(1, playback.clearCount)
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) {
          while (speakingValues.lastOrNull() != false) {
            delay(10)
          }
        }
        assertEquals(listOf(true, true, true, false), speakingValues.toList())
      } finally {
        manager.stop(notifyGateway = false)
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
      }
    }

  @Test
  fun relayMarkWaitsForQueuedPlaybackToDrain() =
    runBlocking {
      val playback = BlockingAudioPlayback()
      val relayMarkReceived = CompletableDeferred<Unit>()
      val connected = CompletableDeferred<Unit>()
      val statusRealtimeConnecting = CompletableDeferred<Unit>()
      val json = Json { ignoreUnknownKeys = true }
      val server =
        startRealtimeGatewayServer(json) { webSocket, id, method, _frame ->
          when (method) {
            "connect" -> webSocket.send(connectResponseFrame(id))
            "talk.realtime.session" ->
              webSocket.send(
                """{"type":"res","id":"$id","ok":true,"payload":{"relaySessionId":"relay-mark"}}""",
              )
            "talk.realtime.relayMark" -> {
              relayMarkReceived.complete(Unit)
              webSocket.send("""{"type":"res","id":"$id","ok":true,"payload":{"ok":true}}""")
              webSocket.close(1000, "marked")
            }
            "talk.realtime.relayStop" ->
              webSocket.send("""{"type":"res","id":"$id","ok":true,"payload":{"ok":true}}""")
          }
        }
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> if (!connected.isCompleted) connected.complete(Unit) },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = { status ->
            if (status == "Realtime connecting…" && !statusRealtimeConnecting.isCompleted) {
              statusRealtimeConnecting.complete(Unit)
            }
          },
          onListening = {},
          onSpeaking = {},
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = NoopRealtimeAudioCapture(),
          player = playback,
        )

      try {
        connectSession(session = session, port = server.port)
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { connected.await() }
        manager.start(
          config = RealtimeTalkConfig(provider = "openai", model = null, voice = null),
          sessionKey = "voice-main",
        )
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { statusRealtimeConnecting.await() }
        manager.handleRelayEvent("relay-mark", RealtimeTalkRelayEvent.Ready)
        manager.handleRelayEvent("relay-mark", RealtimeTalkRelayEvent.Audio("chunk"))
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.writeStarted.await() }

        manager.handleRelayEvent("relay-mark", RealtimeTalkRelayEvent.Mark)
        delay(100)
        assertEquals(false, relayMarkReceived.isCompleted)

        playback.releaseWrite.complete(Unit)
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { relayMarkReceived.await() }
        assertEquals(true, playback.waitUntilDrainedCalled.isCompleted)
      } finally {
        manager.stop(notifyGateway = false)
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
        server.shutdown()
      }
    }

  @Test
  fun speakingStateWaitsForPlaybackDrain() =
    runBlocking {
      val playback = DrainingRecordingAudioPlayback()
      val speakingValues = Collections.synchronizedList(mutableListOf<Boolean>())
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = {},
          onListening = {},
          onSpeaking = { speakingValues.add(it) },
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = NoopRealtimeAudioCapture(),
          player = playback,
        )

      try {
        setRelaySessionId(manager, "relay-drain")

        manager.handleRelayEvent("relay-drain", RealtimeTalkRelayEvent.Audio("chunk"))
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.awaitWriteCount(1) }
        delay(100)

        assertEquals(listOf(true), speakingValues.toList())
        playback.releaseDrain.complete(Unit)
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) {
          while (speakingValues.lastOrNull() != false) {
            delay(10)
          }
        }
        assertEquals(listOf(true, false), speakingValues.toList())
      } finally {
        manager.stop(notifyGateway = false)
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
      }
    }

  @Test
  fun playbackDrainWaitsForStreamingIdleBeforeDraining() =
    runBlocking {
      val playback = DrainingRecordingAudioPlayback()
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = {},
          onListening = {},
          onSpeaking = {},
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = NoopRealtimeAudioCapture(),
          player = playback,
        )

      try {
        setRelaySessionId(manager, "relay-streaming")

        manager.handleRelayEvent("relay-streaming", RealtimeTalkRelayEvent.Audio("first"))
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.awaitWriteCount(1) }
        assertEquals(null, withTimeoutOrNull(150) { playback.waitUntilDrainedCalled.await() })

        manager.handleRelayEvent("relay-streaming", RealtimeTalkRelayEvent.Audio("second"))
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.awaitWriteCount(2) }
        assertEquals(null, withTimeoutOrNull(1_100) { playback.waitUntilDrainedCalled.await() })

        playback.releaseDrain.complete(Unit)
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.waitUntilDrainedCalled.await() }
      } finally {
        playback.releaseDrain.complete(Unit)
        manager.stop(notifyGateway = false)
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
      }
    }

  @Test
  fun recorderFramesAreSuppressedWhileRelayPlaybackIsActive() =
    runBlocking {
      val playback = BlockingAudioPlayback()
      val recorder = ControllableRealtimeAudioCapture()
      val relayAudioCount = AtomicInteger(0)
      val connected = CompletableDeferred<Unit>()
      val json = Json { ignoreUnknownKeys = true }
      val server =
        startRealtimeGatewayServer(json) { webSocket, id, method, _frame ->
          when (method) {
            "connect" -> webSocket.send(connectResponseFrame(id))
            "talk.realtime.relayAudio" -> {
              relayAudioCount.incrementAndGet()
              webSocket.send("""{"type":"res","id":"$id","ok":true,"payload":{"ok":true}}""")
              webSocket.close(1000, "captured")
            }
            "talk.realtime.relayStop" ->
              webSocket.send("""{"type":"res","id":"$id","ok":true,"payload":{"ok":true}}""")
          }
        }
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> if (!connected.isCompleted) connected.complete(Unit) },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = {},
          onListening = {},
          onSpeaking = {},
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = recorder,
          player = playback,
        )

      try {
        connectSession(session = session, port = server.port)
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { connected.await() }
        setRelaySessionId(manager, "relay-input-gate")

        manager.handleRelayEvent("relay-input-gate", RealtimeTalkRelayEvent.Ready)
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { recorder.started.await() }
        manager.handleRelayEvent("relay-input-gate", RealtimeTalkRelayEvent.Audio("output"))
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.writeStarted.await() }

        recorder.emit(nonSilentPcmBase64())
        delay(100)
        assertEquals(0, relayAudioCount.get())

        playback.releaseWrite.complete(Unit)
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.waitUntilDrainedCalled.await() }
        recorder.emit(nonSilentPcmBase64())
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) {
          while (relayAudioCount.get() != 1) {
            delay(10)
          }
        }
      } finally {
        playback.releaseWrite.complete(Unit)
        manager.stop()
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
        server.shutdown()
      }
    }

  @Test
  fun localMicEchoDoesNotClearOrDropRelayPlayback() =
    runBlocking {
      val playback = DrainingRecordingAudioPlayback()
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = {},
          onListening = {},
          onSpeaking = {},
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = NoopRealtimeAudioCapture(),
          player = playback,
        )

      try {
        setRelaySessionId(manager, "relay-local-input")

        manager.handleRelayEvent("relay-local-input", RealtimeTalkRelayEvent.Audio("playing"))
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.awaitWriteCount(1) }

        manager.injectInputAudioBase64(nonSilentPcmBase64())
        delay(100)
        manager.handleRelayEvent("relay-local-input", RealtimeTalkRelayEvent.Audio("next"))
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.awaitWriteCount(2) }

        assertEquals(listOf("playing", "next"), playback.writesSnapshot())
        assertEquals(0, playback.clearCount)
      } finally {
        playback.releaseDrain.complete(Unit)
        manager.stop(notifyGateway = false)
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
      }
    }

  @Test
  fun relayAudioAfterLocalInputStillPlaysUntilProviderClears() =
    runBlocking {
      val playback = OrderedRecordingAudioPlayback()
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = {},
          onListening = {},
          onSpeaking = {},
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = NoopRealtimeAudioCapture(),
          player = playback,
        )

      try {
        setRelaySessionId(manager, "relay-held-input")

        manager.injectInputAudioBase64(nonSilentPcmBase64())
        delay(100)
        manager.handleRelayEvent("relay-held-input", RealtimeTalkRelayEvent.Audio("fresh"))

        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.awaitWriteCount(1) }
        assertEquals(listOf("fresh"), playback.writesSnapshot())
      } finally {
        manager.stop(notifyGateway = false)
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
      }
    }

  @Test
  fun relayClearFailureDoesNotStopPlaybackActor() =
    runBlocking {
      val playback = ClearFailingRecordingAudioPlayback()
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = {},
          onListening = {},
          onSpeaking = {},
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = NoopRealtimeAudioCapture(),
          player = playback,
        )

      try {
        setRelaySessionId(manager, "relay-clear-failure")

        manager.handleRelayEvent("relay-clear-failure", RealtimeTalkRelayEvent.Clear)
        manager.handleRelayEvent("relay-clear-failure", RealtimeTalkRelayEvent.Audio("fresh"))

        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { playback.awaitWriteCount(1) }
        assertEquals(listOf("fresh"), playback.writesSnapshot())
      } finally {
        manager.stop(notifyGateway = false)
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
      }
    }

  @Test
  fun readyRelayStreamsTtsSampleFromRecorderBoundary() =
    runBlocking {
      val fixtureBytes = readFixtureBytes()
      val capturedAudio = CompletableDeferred<ByteArray>()
      val relaySessionParams = CompletableDeferred<JsonObject>()
      val connected = CompletableDeferred<Unit>()
      val statusRealtimeConnecting = CompletableDeferred<Unit>()
      val statusValues = Collections.synchronizedList(mutableListOf<String>())
      val listeningValues = Collections.synchronizedList(mutableListOf<Boolean>())
      val captured = ByteArrayOutputStream()
      val capturedLock = Any()
      val json = Json { ignoreUnknownKeys = true }
      val server =
        startRealtimeGatewayServer(json) { webSocket, id, method, frame ->
          when (method) {
            "connect" -> {
              webSocket.send(connectResponseFrame(id))
            }
            "talk.realtime.session" -> {
              if (!relaySessionParams.isCompleted) {
                relaySessionParams.complete(frame["params"]?.jsonObject ?: JsonObject(emptyMap()))
              }
              webSocket.send(
                """{"type":"res","id":"$id","ok":true,"payload":{"relaySessionId":"relay-fixture"}}""",
              )
            }
            "talk.realtime.relayAudio" -> {
              val params = frame["params"]?.jsonObject ?: JsonObject(emptyMap())
              assertEquals("relay-fixture", params["relaySessionId"]?.jsonPrimitive?.content)
              val audioBytes = Base64.decode(params["audioBase64"]?.jsonPrimitive?.content.orEmpty(), Base64.DEFAULT)
              var shouldClose = false
              synchronized(capturedLock) {
                captured.write(audioBytes, 0, audioBytes.size)
                if (captured.size() >= fixtureBytes.size && !capturedAudio.isCompleted) {
                  capturedAudio.complete(captured.toByteArray())
                  shouldClose = true
                }
              }
              webSocket.send("""{"type":"res","id":"$id","ok":true,"payload":{"ok":true}}""")
              if (shouldClose) {
                webSocket.close(1000, "captured")
              }
            }
            "talk.realtime.relayStop" -> {
              webSocket.send("""{"type":"res","id":"$id","ok":true,"payload":{"ok":true}}""")
            }
          }
        }
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> if (!connected.isCompleted) connected.complete(Unit) },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = { status ->
            statusValues.add(status)
            if (status == "Realtime connecting…" && !statusRealtimeConnecting.isCompleted) {
              statusRealtimeConnecting.complete(Unit)
            }
          },
          onListening = { listeningValues.add(it) },
          onSpeaking = {},
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = FixtureRealtimeAudioCapture(managerScope, fixtureBytes),
          player = NoopRealtimeAudioPlayback(),
        )

      try {
        connectSession(session = session, port = server.port)
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { connected.await() }

        manager.start(
          config = RealtimeTalkConfig(provider = "openai", model = "gpt-realtime", voice = "tts-fixture"),
          sessionKey = "voice-main",
        )

        val sessionParams = withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { relaySessionParams.await() }
        assertEquals("voice-main", sessionParams["sessionKey"]?.jsonPrimitive?.content)
        assertEquals("openai", sessionParams["provider"]?.jsonPrimitive?.content)
        assertEquals("gateway-relay", sessionParams["transport"]?.jsonPrimitive?.content)
        assertEquals("gpt-realtime", sessionParams["model"]?.jsonPrimitive?.content)
        assertEquals("tts-fixture", sessionParams["voice"]?.jsonPrimitive?.content)

        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { statusRealtimeConnecting.await() }
        manager.handleRelayEvent("relay-fixture", RealtimeTalkRelayEvent.Ready)

        val capturedBytes = withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { capturedAudio.await() }
        assertArrayEquals(fixtureBytes, capturedBytes)
        assertTrue(capturedBytes.any { it.toInt() != 0 })
        assertTrue(listeningValues.contains(true))
        assertTrue(statusValues.contains("Listening"))
      } finally {
        manager.stop()
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
        server.shutdown()
      }
    }

  @Test
  fun injectedTextTurnSendsRelayUserMessage() =
    runBlocking {
      val relayUserMessageParams = CompletableDeferred<JsonObject>()
      val connected = CompletableDeferred<Unit>()
      val statusRealtimeConnecting = CompletableDeferred<Unit>()
      val json = Json { ignoreUnknownKeys = true }
      val server =
        startRealtimeGatewayServer(json) { webSocket, id, method, frame ->
          when (method) {
            "connect" -> webSocket.send(connectResponseFrame(id))
            "talk.realtime.session" ->
              webSocket.send(
                """{"type":"res","id":"$id","ok":true,"payload":{"relaySessionId":"relay-text"}}""",
              )
            "talk.realtime.relayUserMessage" -> {
              if (!relayUserMessageParams.isCompleted) {
                relayUserMessageParams.complete(frame["params"]?.jsonObject ?: JsonObject(emptyMap()))
              }
              webSocket.send("""{"type":"res","id":"$id","ok":true,"payload":{"ok":true}}""")
              webSocket.close(1000, "captured")
            }
            "talk.realtime.relayStop" ->
              webSocket.send("""{"type":"res","id":"$id","ok":true,"payload":{"ok":true}}""")
          }
        }
      val sessionJob = SupervisorJob()
      val session =
        GatewaySession(
          scope = CoroutineScope(sessionJob + Dispatchers.Default),
          identityStore = DeviceIdentityStore(RuntimeEnvironment.getApplication()),
          deviceAuthStore = RealtimeTestDeviceAuthStore(),
          onConnected = { _, _, _ -> if (!connected.isCompleted) connected.complete(Unit) },
          onDisconnected = {},
          onEvent = { _, _ -> },
        )
      val managerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
      val manager =
        RealtimeTalkManager(
          context = RuntimeEnvironment.getApplication(),
          scope = managerScope,
          session = session,
          isConnected = { true },
          onStatus = { status ->
            if (status == "Realtime connecting…" && !statusRealtimeConnecting.isCompleted) {
              statusRealtimeConnecting.complete(Unit)
            }
          },
          onListening = {},
          onSpeaking = {},
          onConsult = { error("consult should not be called") },
          onUnavailable = { error("realtime should stay available") },
          recorder = NoopRealtimeAudioCapture(),
          player = NoopRealtimeAudioPlayback(),
        )

      try {
        connectSession(session = session, port = server.port)
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { connected.await() }

        manager.start(
          config = RealtimeTalkConfig(provider = "google", model = "gemini-live", voice = null),
          sessionKey = "voice-main",
        )
        withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { statusRealtimeConnecting.await() }
        manager.sendUserMessage(" Hello Sky. ")

        val params = withTimeout(REALTIME_AUDIO_TEST_TIMEOUT_MS) { relayUserMessageParams.await() }
        assertEquals("relay-text", params["relaySessionId"]?.jsonPrimitive?.content)
        assertEquals("Hello Sky.", params["text"]?.jsonPrimitive?.content)
      } finally {
        manager.stop()
        managerScope.coroutineContext[Job]?.cancelAndJoin()
        session.disconnect()
        sessionJob.cancelAndJoin()
        server.shutdown()
      }
    }

  private fun readFixtureBytes(): ByteArray {
    val stream =
      requireNotNull(javaClass.classLoader?.getResourceAsStream("voice/realtime-tts-sample-24k-s16le.raw")) {
        "missing realtime TTS fixture"
      }
    return stream.use { it.readBytes() }
  }

  private fun connectSession(
    session: GatewaySession,
    port: Int,
  ) {
    session.connect(
      endpoint =
        GatewayEndpoint(
          stableId = "manual|127.0.0.1|$port",
          name = "test",
          host = "127.0.0.1",
          port = port,
          tlsEnabled = false,
        ),
      token = "test-token",
      bootstrapToken = null,
      password = null,
      options =
        GatewayConnectOptions(
          role = "node",
          scopes = listOf("node:invoke"),
          caps = emptyList(),
          commands = emptyList(),
          permissions = emptyMap(),
          client =
            GatewayClientInfo(
              id = "openclaw-android-realtime-test",
              displayName = "Android Realtime Test",
              version = "1.0.0-test",
              platform = "android",
              mode = "node",
              instanceId = "android-realtime-test-instance",
              deviceFamily = "android",
              modelIdentifier = "test",
            ),
        ),
      tls = null,
    )
  }

  private fun connectResponseFrame(id: String): String = """{"type":"res","id":"$id","ok":true,"payload":{"snapshot":{"sessionDefaults":{"mainSessionKey":"main"}}}}"""

  private fun startRealtimeGatewayServer(
    json: Json,
    onRequestFrame: (webSocket: WebSocket, id: String, method: String, frame: JsonObject) -> Unit,
  ): MockWebServer =
    MockWebServer().apply {
      dispatcher =
        object : Dispatcher() {
          override fun dispatch(request: RecordedRequest): MockResponse =
            MockResponse().withWebSocketUpgrade(
              object : WebSocketListener() {
                override fun onOpen(
                  webSocket: WebSocket,
                  response: Response,
                ) {
                  webSocket.send(REALTIME_CONNECT_CHALLENGE_FRAME)
                }

                override fun onMessage(
                  webSocket: WebSocket,
                  text: String,
                ) {
                  val frame = json.parseToJsonElement(text).jsonObject
                  if (frame["type"]?.jsonPrimitive?.content != "req") return
                  val id = frame["id"]?.jsonPrimitive?.content ?: return
                  val method = frame["method"]?.jsonPrimitive?.content ?: return
                  onRequestFrame(webSocket, id, method, frame)
                }
              },
            )
        }
      start()
    }
}

private class FixtureRealtimeAudioCapture(
  private val scope: CoroutineScope,
  private val fixtureBytes: ByteArray,
  private val chunkSizeBytes: Int = 1_280,
) : RealtimeAudioCapture {
  private var job: Job? = null

  override fun start(onAudioBase64: suspend (String) -> Unit) {
    if (job != null) return
    job =
      scope.launch {
        var offset = 0
        while (offset < fixtureBytes.size) {
          val end = minOf(offset + chunkSizeBytes, fixtureBytes.size)
          val chunk = fixtureBytes.copyOfRange(offset, end)
          onAudioBase64(Base64.encodeToString(chunk, Base64.NO_WRAP))
          offset = end
        }
      }
  }

  override fun stop() {
    job?.cancel()
    job = null
  }
}

private class ControllableRealtimeAudioCapture : RealtimeAudioCapture {
  val started = CompletableDeferred<Unit>()

  private var onAudioBase64: (suspend (String) -> Unit)? = null

  override fun start(onAudioBase64: suspend (String) -> Unit) {
    this.onAudioBase64 = onAudioBase64
    started.complete(Unit)
  }

  suspend fun emit(audioBase64: String) {
    onAudioBase64?.invoke(audioBase64)
  }

  override fun stop() {
    onAudioBase64 = null
  }
}

private class NoopRealtimeAudioPlayback : RealtimeAudioPlayback {
  override suspend fun start() = Unit

  override suspend fun writeBase64(audioBase64: String) = Unit

  override suspend fun clear() = Unit

  override suspend fun waitUntilDrained(timeoutMs: Long) = Unit

  override fun stop() = Unit
}

private class OrderedRecordingAudioPlayback : RealtimeAudioPlayback {
  private val writes = Collections.synchronizedList(mutableListOf<String>())

  @Volatile var clearCount = 0
    private set

  override suspend fun start() = Unit

  override suspend fun writeBase64(audioBase64: String) {
    if (audioBase64 == "first") {
      delay(100)
    }
    writes.add(audioBase64)
  }

  override suspend fun clear() {
    clearCount += 1
  }

  override suspend fun waitUntilDrained(timeoutMs: Long) = Unit

  override fun stop() = Unit

  suspend fun awaitWriteCount(count: Int) {
    while (writes.size < count) {
      delay(10)
    }
  }

  fun writesSnapshot(): List<String> = synchronized(writes) { writes.toList() }
}

private class GatedRecordingAudioPlayback(
  private val blockedChunk: String,
) : RealtimeAudioPlayback {
  private val writes = Collections.synchronizedList(mutableListOf<String>())

  val blockedWriteStarted = CompletableDeferred<Unit>()
  val releaseBlockedWrite = CompletableDeferred<Unit>()

  @Volatile var clearCount = 0
    private set

  override suspend fun start() = Unit

  override suspend fun writeBase64(audioBase64: String) {
    if (audioBase64 == blockedChunk) {
      blockedWriteStarted.complete(Unit)
      releaseBlockedWrite.await()
    }
    writes.add(audioBase64)
  }

  override suspend fun clear() {
    clearCount += 1
  }

  override suspend fun waitUntilDrained(timeoutMs: Long) = Unit

  override fun stop() = Unit

  suspend fun awaitWriteCount(count: Int) {
    while (writes.size < count) {
      delay(10)
    }
  }

  fun writesSnapshot(): List<String> = synchronized(writes) { writes.toList() }
}

private class BlockingAudioPlayback : RealtimeAudioPlayback {
  val writeStarted = CompletableDeferred<Unit>()
  val releaseWrite = CompletableDeferred<Unit>()
  val waitUntilDrainedCalled = CompletableDeferred<Unit>()

  override suspend fun start() = Unit

  override suspend fun writeBase64(audioBase64: String) {
    writeStarted.complete(Unit)
    releaseWrite.await()
  }

  override suspend fun clear() = Unit

  override suspend fun waitUntilDrained(timeoutMs: Long) {
    waitUntilDrainedCalled.complete(Unit)
  }

  override fun stop() = Unit
}

private class DrainingRecordingAudioPlayback : RealtimeAudioPlayback {
  private val writes = Collections.synchronizedList(mutableListOf<String>())

  val releaseDrain = CompletableDeferred<Unit>()
  val waitUntilDrainedCalled = CompletableDeferred<Unit>()

  @Volatile var clearCount = 0
    private set

  override suspend fun start() = Unit

  override suspend fun writeBase64(audioBase64: String) {
    writes.add(audioBase64)
  }

  override suspend fun clear() {
    clearCount += 1
  }

  override suspend fun waitUntilDrained(timeoutMs: Long) {
    waitUntilDrainedCalled.complete(Unit)
    releaseDrain.await()
  }

  override fun stop() = Unit

  suspend fun awaitWriteCount(count: Int) {
    while (writes.size < count) {
      delay(10)
    }
  }

  fun writesSnapshot(): List<String> = synchronized(writes) { writes.toList() }
}

private class ClearFailingRecordingAudioPlayback : RealtimeAudioPlayback {
  private val writes = Collections.synchronizedList(mutableListOf<String>())

  override suspend fun start() = Unit

  override suspend fun writeBase64(audioBase64: String) {
    writes.add(audioBase64)
  }

  override suspend fun clear(): Unit = throw IllegalStateException("clear failed")

  override suspend fun waitUntilDrained(timeoutMs: Long) = Unit

  override fun stop() = Unit

  suspend fun awaitWriteCount(count: Int) {
    while (writes.size < count) {
      delay(10)
    }
  }

  fun writesSnapshot(): List<String> = synchronized(writes) { writes.toList() }
}

private class NoopRealtimeAudioCapture : RealtimeAudioCapture {
  override fun start(onAudioBase64: suspend (String) -> Unit) = Unit

  override fun stop() = Unit
}

private fun setRelaySessionId(
  manager: RealtimeTalkManager,
  relaySessionId: String,
) {
  RealtimeTalkManager::class.java.getDeclaredField("relaySessionId").apply {
    isAccessible = true
    set(manager, relaySessionId)
  }
}

private fun nonSilentPcmBase64(): String {
  val bytes = ByteArray(960)
  var index = 0
  while (index + 1 < bytes.size) {
    bytes[index] = 0x00
    bytes[index + 1] = 0x20
    index += 2
  }
  return Base64.encodeToString(bytes, Base64.NO_WRAP)
}

private class RealtimeTestDeviceAuthStore : DeviceAuthTokenStore {
  override fun loadEntry(
    deviceId: String,
    role: String,
  ): DeviceAuthEntry? = null

  override fun saveToken(
    deviceId: String,
    role: String,
    token: String,
    scopes: List<String>,
  ) = Unit

  override fun clearToken(
    deviceId: String,
    role: String,
  ) = Unit
}
