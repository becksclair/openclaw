package ai.openclaw.wear

import ai.openclaw.audio.PcmAudio
import ai.openclaw.common.wear.WearReasoningLevel
import ai.openclaw.wear.audio.AudioEndpointEvent
import ai.openclaw.wear.audio.AudioEndpointReason
import ai.openclaw.wear.audio.AudioEndpointingConfig
import ai.openclaw.wear.audio.WearAudioCapture
import ai.openclaw.wear.client.PhoneRelayAudioResponse
import ai.openclaw.wear.client.WearPhoneRelay
import ai.openclaw.wear.speech.DictationErrorKind
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
import org.robolectric.RuntimeEnvironment

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
    assertTrue(WatchViewModel.WatchState.CheckingPhone.keepsScreenAwake)
    assertTrue(WatchViewModel.WatchState.Recording.keepsScreenAwake)
    // Remote Processing has no local activity, so the screen may sleep.
    assertFalse(WatchViewModel.WatchState.Processing.keepsScreenAwake)
    assertTrue(WatchViewModel.WatchState.Playing.keepsScreenAwake)
    assertFalse(WatchViewModel.WatchState.Error.keepsScreenAwake)
  }

  @Test
  fun `final tts playback gain boosts pcm before playback`() {
    val pcm = ByteArray(4)
    PcmAudio.writePcm16Sample(pcm, 0, 100)
    PcmAudio.writePcm16Sample(pcm, 2, -100)

    val boosted = applyFinalTtsPlaybackGain(pcm)

    assertEquals(150, PcmAudio.readPcm16Sample(boosted, 0))
    assertEquals(-150, PcmAudio.readPcm16Sample(boosted, 2))
    assertEquals(150, peakAbsPcm16(boosted))
  }

  @Test
  fun `pcm peak meter handles full scale negative sample`() {
    val pcm = ByteArray(2)
    PcmAudio.writePcm16Sample(pcm, 0, Short.MIN_VALUE.toInt())

    assertEquals(Short.MAX_VALUE.toInt(), peakAbsPcm16(pcm))
  }

  @Test
  fun `reasoning level defaults to low and persists selected value`() {
    val app = RuntimeEnvironment.getApplication()
    app
      .getSharedPreferences("openclaw.watch.settings", Application.MODE_PRIVATE)
      .edit()
      .clear()
      .commit()
    val firstViewModel = WatchViewModel(app, FakeAudioCapture(), FakePhoneRelay())

    assertEquals(WearReasoningLevel.LOW, firstViewModel.reasoningLevel.value)

    firstViewModel.setReasoningLevel(WearReasoningLevel.HIGH)
    val secondViewModel = WatchViewModel(app, FakeAudioCapture(), FakePhoneRelay())

    assertEquals(WearReasoningLevel.HIGH, firstViewModel.reasoningLevel.value)
    assertEquals(WearReasoningLevel.HIGH, secondViewModel.reasoningLevel.value)
  }

  @Test
  fun `invalid reasoning level normalizes to low`() {
    val viewModel = WatchViewModel(Application(), FakeAudioCapture(), FakePhoneRelay())

    viewModel.setReasoningLevel("unsupported")

    assertEquals(WearReasoningLevel.LOW, viewModel.reasoningLevel.value)
  }

  @Test
  fun `auto endpoint sends end once and transitions to processing`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val viewModel = WatchViewModel(Application(), capture, relay)

      viewModel.setReasoningLevel(WearReasoningLevel.MEDIUM)
      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      assertNotNull(capture.endpointingConfig)
      assertEquals(1_200, capture.endpointingConfig?.endSilenceMs)

      capture.endpointCallback?.invoke(endpoint())

      assertEquals(listOf("turn-1"), relay.endTurnIds)
      assertEquals(listOf(WearReasoningLevel.MEDIUM), relay.startReasoningLevels)
      assertEquals(WatchViewModel.WatchState.Processing, viewModel.state.value)
    }

  @Test
  fun `dictation final transcript sends text turn and transitions to processing`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.setReasoningLevel(WearReasoningLevel.HIGH)
      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.PartialTranscript("hello"))
      runCurrent()
      assertEquals("hello", viewModel.statusText.value)
      speech.emit(SpeechDictationEvent.FinalTranscript("hello sky"))
      runCurrent()

      assertFalse(capture.started)
      assertEquals(listOf("hello sky"), relay.textTurns)
      assertEquals(listOf(WearReasoningLevel.HIGH), relay.textReasoningLevels)
      assertEquals(1, speech.destroyCount)
      assertEquals(WatchViewModel.WatchState.Processing, viewModel.state.value)
    }

  @Test
  fun `empty final transcript after partial sends partial text turn`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.PartialTranscript("hello from the watch"))
      speech.emit(SpeechDictationEvent.FinalTranscript(""))
      runCurrent()

      assertFalse(capture.started)
      assertEquals(listOf("hello from the watch"), relay.textTurns)
      assertEquals(WatchViewModel.WatchState.Processing, viewModel.state.value)
    }

  @Test
  fun `assistant invocation final transcript sends text turn and transitions to processing`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onAssistantInvocation()
      speech.emit(SpeechDictationEvent.FinalTranscript("assistant launch"))
      runCurrent()

      assertFalse(capture.started)
      assertEquals(listOf("assistant launch"), relay.textTurns)
      assertEquals(WatchViewModel.WatchState.Processing, viewModel.state.value)
    }

  @Test
  fun `assistant invocation waits for phone discovery before dictation`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay(connected = false)
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onAssistantInvocation()
      runCurrent()

      assertFalse(capture.started)
      assertEquals(emptyList<String>(), relay.textTurns)
      assertEquals("Checking phone...", viewModel.statusText.value)
      assertEquals(WatchViewModel.WatchState.CheckingPhone, viewModel.state.value)

      relay.setConnected(true)
      advanceTimeBy(500)
      runCurrent()

      assertFalse(capture.started)
      assertEquals(WatchViewModel.WatchState.Recording, viewModel.state.value)
    }

  @Test
  fun `assistant invocation without phone times out without starting capture`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay(connected = false)
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onAssistantInvocation()
      advanceTimeBy(10_001)
      runCurrent()

      assertFalse(capture.started)
      assertEquals(emptyList<String>(), relay.textTurns)
      assertEquals("Phone not connected", viewModel.statusText.value)
      assertEquals(WatchViewModel.WatchState.Idle, viewModel.state.value)
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
  fun `cancel aborts active dictation without sending text`() =
    runTest(dispatcher) {
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), FakeAudioCapture(), relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.PartialTranscript("hello"))
      runCurrent()
      viewModel.onCancelTurn()

      assertEquals(emptyList<String>(), relay.textTurns)
      assertEquals(1, speech.cancelCount)
      assertEquals(1, relay.cancelCount)
      assertEquals(WatchViewModel.WatchState.Idle, viewModel.state.value)
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
  fun `cancel aborts raw pcm capture without sending end`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = false)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      viewModel.onCancelTurn()

      assertEquals(emptyList<String?>(), relay.endTurnIds)
      assertEquals(1, relay.cancelCount)
      assertEquals(true, capture.discardedOnStop)
      assertEquals(WatchViewModel.WatchState.Idle, viewModel.state.value)
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
      speech.emit(SpeechDictationEvent.Error("No speech recognized", DictationErrorKind.NoSpeech))
      runCurrent()

      assertFalse(capture.started)
      assertEquals(1, speech.destroyCount)
      assertEquals(WatchViewModel.WatchState.Error, viewModel.state.value)
      advanceTimeBy(1_300)
      assertEquals(WatchViewModel.WatchState.Idle, viewModel.state.value)
    }

  @Test
  fun `dictation error after partial sends partial text turn`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.PartialTranscript("send this to sky"))
      speech.emit(SpeechDictationEvent.Error("No speech recognized", DictationErrorKind.NoSpeech))
      runCurrent()

      assertFalse(capture.started)
      assertEquals(listOf("send this to sky"), relay.textTurns)
      assertEquals(1, speech.destroyCount)
      assertEquals(WatchViewModel.WatchState.Processing, viewModel.state.value)
    }

  @Test
  fun `phone disconnect while recording fails the turn`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = false)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      assertEquals(WatchViewModel.WatchState.Recording, viewModel.state.value)

      relay.setConnected(false)
      runCurrent()

      assertEquals(WatchViewModel.WatchState.Error, viewModel.state.value)
      assertEquals("Phone disconnected", viewModel.statusText.value)
      assertEquals(1, relay.cancelCount)
    }

  @Test
  fun `phone disconnect while processing fails the turn`() =
    runTest(dispatcher) {
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), FakeAudioCapture(), relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.FinalTranscript("hello sky"))
      runCurrent()
      assertEquals(WatchViewModel.WatchState.Processing, viewModel.state.value)

      relay.setConnected(false)
      runCurrent()

      assertEquals(WatchViewModel.WatchState.Error, viewModel.state.value)
      assertEquals(1, relay.cancelCount)
    }

  @Test
  fun `phone disconnect while playing does not fail local playback`() =
    runTest(dispatcher) {
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), FakeAudioCapture(), relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.FinalTranscript("hello sky"))
      runCurrent()
      // Whole-buffer PCM response transitions straight into local playback.
      relay.emitAudioResponse(PhoneRelayAudioResponse(turnId = "text-turn-1", audioBytes = byteArrayOf(1, 2, 3, 4)))
      runCurrent()
      assertEquals(WatchViewModel.WatchState.Playing, viewModel.state.value)

      relay.setConnected(false)
      runCurrent()

      // Playback is fully local: a disconnect must not cancel it or surface an error.
      assertFalse(WatchViewModel.WatchState.Error == viewModel.state.value)
      assertEquals(0, relay.cancelCount)
    }

  @Test
  fun `transient dictation error does not submit truncated partial`() =
    runTest(dispatcher) {
      val capture = FakeAudioCapture()
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), capture, relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.PartialTranscript("send this to sky"))
      speech.emit(SpeechDictationEvent.Error("Network error", DictationErrorKind.Transient))
      runCurrent()

      assertFalse(capture.started)
      assertEquals(emptyList<String>(), relay.textTurns)
      assertEquals(1, speech.destroyCount)
      assertEquals(WatchViewModel.WatchState.Error, viewModel.state.value)
    }

  @Test
  fun `cancel aborts submitted phone turn`() =
    runTest(dispatcher) {
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), FakeAudioCapture(), relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.FinalTranscript("hello sky"))
      runCurrent()
      viewModel.onCancelTurn()

      assertEquals(1, speech.cancelCount)
      assertEquals(1, relay.cancelCount)
      assertEquals(WatchViewModel.WatchState.Idle, viewModel.state.value)
    }

  @Test
  fun `cancel ignores stale relay status and error events`() =
    runTest(dispatcher) {
      val relay = FakePhoneRelay()
      val speech = FakeSpeechDictation(available = true)
      val viewModel = WatchViewModel(Application(), FakeAudioCapture(), relay, speech)

      viewModel.onPermissionGranted()
      viewModel.onMicButtonDown()
      speech.emit(SpeechDictationEvent.FinalTranscript("hello sky"))
      runCurrent()
      viewModel.onCancelTurn()
      relay.emitStatus("Working...")
      relay.emitError("Should not surface")
      runCurrent()

      assertEquals(WatchViewModel.WatchState.Idle, viewModel.state.value)
      assertEquals("Tap mic to speak", viewModel.statusText.value)
      assertEquals(1, relay.cancelCount)
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
      advanceTimeBy(180_001)
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
  var discardedOnStop = false

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
    discardedOnStop = discardPending
    onStopped?.invoke()
  }
}

private class FakePhoneRelay(
  connected: Boolean = true,
) : WearPhoneRelay {
  private val connectedFlow = MutableStateFlow(connected)
  override val phoneConnected: StateFlow<Boolean> = connectedFlow
  private val mutableStatusUpdates = MutableSharedFlow<String>(extraBufferCapacity = 4)
  override val statusUpdates: SharedFlow<String> = mutableStatusUpdates
  private val mutableAudioResponses = MutableSharedFlow<PhoneRelayAudioResponse>(extraBufferCapacity = 4)
  override val audioResponses: SharedFlow<PhoneRelayAudioResponse> = mutableAudioResponses
  private val mutableErrors = MutableSharedFlow<String>(extraBufferCapacity = 4)
  override val errors: SharedFlow<String> = mutableErrors

  val endTurnIds = mutableListOf<String?>()
  val textTurns = mutableListOf<String>()
  val startReasoningLevels = mutableListOf<String>()
  val textReasoningLevels = mutableListOf<String>()
  var cancelCount = 0

  override fun isPhoneConnected(): Boolean = connectedFlow.value

  fun setConnected(connected: Boolean) {
    connectedFlow.value = connected
  }

  fun emitStatus(status: String) {
    mutableStatusUpdates.tryEmit(status)
  }

  fun emitError(error: String) {
    mutableErrors.tryEmit(error)
  }

  fun emitAudioResponse(response: PhoneRelayAudioResponse) {
    mutableAudioResponses.tryEmit(response)
  }

  override fun sendStartRecording(reasoningLevel: String): String? {
    startReasoningLevels += reasoningLevel
    return "turn-1"
  }

  override fun sendTextTurn(
    text: String,
    reasoningLevel: String,
  ): String? {
    textTurns += text
    textReasoningLevels += reasoningLevel
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
  var cancelCount = 0
  var destroyCount = 0

  override fun isAvailable(): Boolean = available

  override fun start(onEvent: (SpeechDictationEvent) -> Unit): Boolean {
    if (!available) return false
    this.onEvent = onEvent
    onEvent(SpeechDictationEvent.Listening)
    return true
  }

  override fun stopListening() {}

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
