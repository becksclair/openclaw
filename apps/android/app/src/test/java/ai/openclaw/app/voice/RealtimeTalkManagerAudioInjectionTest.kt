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
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
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
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream
import java.util.Collections

private const val REALTIME_AUDIO_TEST_TIMEOUT_MS = 8_000L
private const val REALTIME_CONNECT_CHALLENGE_FRAME =
  """{"type":"event","event":"connect.challenge","payload":{"nonce":"android-realtime-audio-test"}}"""

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RealtimeTalkManagerAudioInjectionTest {
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

private class NoopRealtimeAudioPlayback : RealtimeAudioPlayback {
  override suspend fun start() = Unit

  override suspend fun writeBase64(audioBase64: String) = Unit

  override suspend fun clear() = Unit

  override suspend fun waitUntilDrained(timeoutMs: Long) = Unit

  override fun stop() = Unit
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
