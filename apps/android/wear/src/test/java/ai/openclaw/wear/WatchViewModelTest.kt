package ai.openclaw.wear

import ai.openclaw.wear.audio.AudioEndpointEvent
import ai.openclaw.wear.audio.AudioEndpointReason
import ai.openclaw.wear.audio.AudioEndpointingConfig
import ai.openclaw.wear.audio.WearAudioCapture
import ai.openclaw.wear.client.PhoneRelayAudioResponse
import ai.openclaw.wear.client.PhoneRelayAudioStreamEvent
import ai.openclaw.wear.client.WearPhoneRelay
import ai.openclaw.wear.speech.SpeechDictationEvent
import ai.openclaw.wear.speech.WatchSpeechDictation
import android.app.Application
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class WatchViewModelTest {
  private val dispatcher = UnconfinedTestDispatcher()

  @Before
  fun setUp() {
    Dispatchers.setMain(dispatcher)
  }

  @After
  fun tearDown() {
    Dispatchers.resetMain()
  }

  @Test
  fun `active turn states keep the watch screen awake`() {
    assertFalse(WatchViewModel.WatchState.Idle.keepsScreenAwake)
    assertFalse(WatchViewModel.WatchState.CheckingPhone.keepsScreenAwake)
    assertTrue(WatchViewModel.WatchState.Recording.keepsScreenAwake)
    assertTrue(WatchViewModel.WatchState.Processing.keepsScreenAwake)
    assertTrue(WatchViewModel.WatchState.Playing.keepsScreenAwake)
    assertFalse(WatchViewModel.WatchState.Error.keepsScreenAwake)
  }

  @Test
  fun `auto endpoint sends end once and transitions to processing`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val viewModel = WatchViewModel(Application(), capture, relay)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      assertNotNull(capture.endpointingConfig)

      capture.endpointCallback?.invoke(endpoint())
      viewModel.onMicButtonUp()

      assertEquals(listOf("turn-1"), relay.endTurnIds)
      assertEquals(WatchViewModel.WatchState.Processing, viewModel.state.value)
    }

  @Test
  fun `dictation final transcript sends text turn and transitions to processing`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.PartialTranscript("hello"))
      runCurrent()
      assertEquals("Heard: hello", viewModel.statusText.value)
      speech.emit(SpeechDictationEvent.FinalTranscript("hello sky"))
      runCurrent()

      assertFalse(capture.started)
      assertEquals(listOf("hello sky"), relay.textTurns)
      assertEquals(1, speech.destroyCount)
      assertEquals(WatchViewModel.WatchState.Processing, viewModel.state.value)
    }

  @Test
  fun `dictation speech end waits for final transcript`() =
    runTest(dispatcher) {
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), FakeAudioCapture(), relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.SpeechEnded)
      runCurrent()

      assertEquals(emptyList<String>(), relay.textTurns)
      assertEquals("Processing speech...", viewModel.statusText.value)
      assertEquals(WatchViewModel.WatchState.Recording, viewModel.state.value)
    }

  @Test
  fun `manual release stops active dictation`() =
    runTest(dispatcher) {
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), FakeAudioCapture(), FakePhoneRelay(), speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      viewModel.onMicButtonUp()

      assertEquals(1, speech.stopListeningCount)
      assertEquals("Processing speech...", viewModel.statusText.value)
    }

  @Test
  fun `unavailable dictation falls back to raw pcm capture`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = false)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()

      assertTrue(capture.started)
      assertEquals("turn-1", capture.turnId)
      assertEquals(emptyList<String>(), relay.textTurns)
    }

  @Test
  fun `dictation error returns to idle without raw fallback`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.Error("No speech recognized"))
      runCurrent()

      assertFalse(capture.started)
      assertEquals(1, speech.destroyCount)
      assertEquals(WatchViewModel.WatchState.Error, viewModel.state.value)
      advanceTimeBy(1_300)
      assertEquals(WatchViewModel.WatchState.Idle, viewModel.state.value)
    }

  @Test
  fun `retry cancels dictation and active phone turn`() =
    runTest(dispatcher) {
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), FakeAudioCapture(), relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.FinalTranscript("hello sky"))
      runCurrent()
      viewModel.onRetry()

      assertEquals(1, speech.cancelCount)
      assertEquals(1, relay.cancelCount)
      assertEquals(WatchViewModel.WatchState.Idle, viewModel.state.value)
    }

  @Test
  fun `processing turn times out and cancels active phone turn`() =
    runTest(dispatcher) {
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), FakeAudioCapture(), relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.FinalTranscript("hello sky"))
      runCurrent()

      assertEquals(WatchViewModel.WatchState.Processing, viewModel.state.value)
      advanceTimeBy(60_001)
      runCurrent()

      assertEquals(WatchViewModel.WatchState.Error, viewModel.state.value)
      assertEquals("Voice failed: response timed out", viewModel.statusText.value)
      assertEquals(1, relay.cancelCount)
    }

  @Test
  fun `retry cancels processing timeout`() =
    runTest(dispatcher) {
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), FakeAudioCapture(), relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.FinalTranscript("hello sky"))
      runCurrent()
      viewModel.onRetry()
      advanceTimeBy(60_001)
      runCurrent()

      assertEquals(WatchViewModel.WatchState.Idle, viewModel.state.value)
      assertEquals(1, relay.cancelCount)
    }

  @Test
  fun `manual done sends end once`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val viewModel = WatchViewModel(Application(), capture, relay)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      viewModel.onMicButtonUp()
      capture.endpointCallback?.invoke(endpoint())

      assertEquals(listOf("turn-1"), relay.endTurnIds)
      assertEquals(WatchViewModel.WatchState.Processing, viewModel.state.value)
    }

  @Test
  fun `no speech endpoint cancels instead of sending noise`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val viewModel = WatchViewModel(Application(), capture, relay)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()

      capture.endpointCallback?.invoke(
        AudioEndpointEvent.Endpoint(
          reason = AudioEndpointReason.NoSpeech,
          totalAudioMs = 4_000,
          speechMs = 0,
          trailingSilenceMs = 0,
        ),
      )

      assertEquals(emptyList<String?>(), relay.endTurnIds)
      assertEquals(1, relay.cancelCount)
      assertEquals(WatchViewModel.WatchState.Idle, viewModel.state.value)
    }

  private fun endpoint(): AudioEndpointEvent.Endpoint =
    AudioEndpointEvent.Endpoint(
      reason = AudioEndpointReason.TrailingSilence,
      totalAudioMs = 1_500,
      speechMs = 500,
      trailingSilenceMs = 1_000,
    )
}

private class FakeAudioCapture : WearAudioCapture {
  var endpointingConfig: AudioEndpointingConfig? = null
  var endpointCallback: ((AudioEndpointEvent.Endpoint) -> Unit)? = null
  var started = false
  var turnId: String? = null

  override fun start(
    turnId: String?,
    onChunk: (ByteArray) -> Unit,
    endpointingConfig: AudioEndpointingConfig?,
    onEndpoint: ((AudioEndpointEvent.Endpoint) -> Unit)?,
  ): Boolean {
    started = true
    this.turnId = turnId
    this.endpointingConfig = endpointingConfig
    endpointCallback = onEndpoint
    onChunk(byteArrayOf(1, 2))
    return true
  }

  override fun stop(
    discardPending: Boolean,
    onStopped: (() -> Unit)?,
  ) {
    onStopped?.invoke()
  }
}

private class FakePhoneRelay : WearPhoneRelay {
  override val phoneConnected: StateFlow<Boolean> = MutableStateFlow(true)
  override val statusUpdates: SharedFlow<String> = MutableSharedFlow()
  override val audioResponses: SharedFlow<PhoneRelayAudioResponse> = MutableSharedFlow()
  override val audioStreamEvents: SharedFlow<PhoneRelayAudioStreamEvent> = MutableSharedFlow()
  override val errors: SharedFlow<String> = MutableSharedFlow()

  val endTurnIds = mutableListOf<String?>()
  val textTurns = mutableListOf<String>()
  var cancelCount = 0

  override fun isPhoneConnected(): Boolean = true

  override fun sendStartRecording(): String? = "turn-1"

  override fun sendTextTurn(text: String): String? {
    textTurns += text
    return "text-turn-1"
  }

  override fun sendEndRecording(turnId: String?) {
    endTurnIds += turnId
  }

  override fun sendCancel() {
    cancelCount++
  }

  override fun sendAudioChunk(
    turnId: String?,
    chunk: ByteArray,
  ) {}

  override fun disconnect() {}
}

private class FakeSpeechDictation(
  private val available: Boolean,
) : WatchSpeechDictation {
  private var onEvent: ((SpeechDictationEvent) -> Unit)? = null
  var stopListeningCount = 0
  var cancelCount = 0
  var destroyCount = 0

  override fun isAvailable(): Boolean = available

  override fun start(onEvent: (SpeechDictationEvent) -> Unit): Boolean {
    if (!available) return false
    this.onEvent = onEvent
    onEvent(SpeechDictationEvent.Listening)
    return true
  }

  override fun stopListening() {
    stopListeningCount++
  }

  override fun cancel() {
    cancelCount++
  }

  override fun destroy() {
    destroyCount++
  }

  fun emit(event: SpeechDictationEvent) {
    onEvent?.invoke(event)
  }
}
