package ai.openclaw.wear.client

import ai.openclaw.common.wear.WearRelayProtocol
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowSystemClock
import java.time.Duration

// The receiver drives an idle timer off SystemClock.elapsedRealtime() plus
// scope.launch{delay(...)}. Under Robolectric the kotlinx TestScheduler clock
// (advanceTimeBy/currentTime) and ShadowSystemClock are independent: advancing
// virtual time alone never moves elapsedRealtime(), so the idle loop's
// `lastProgressAtMs + TIMEOUT - elapsedRealtime()` window never elapses. These
// tests advance both clocks in lockstep so the timeout math is real, mirroring
// how WatchViewModelTest uses UnconfinedTestDispatcher + advanceTimeBy.
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class BufferedAudioResponseReceiverTest {
  private val dispatcher = UnconfinedTestDispatcher()

  // 10s idle window from BufferedAudioResponseReceiver.AUDIO_IDLE_TIMEOUT_MS.
  private val idleTimeoutMs = 10_000L

  private class Sink {
    var activeTurn: String? = "turn-1"
    val completedTurns = mutableListOf<String>()
    val audioResponses = mutableListOf<PhoneRelayAudioResponse>()
    val errors = mutableListOf<String>()
  }

  private fun TestScope.newReceiver(sink: Sink): BufferedAudioResponseReceiver =
    BufferedAudioResponseReceiver(
      scope = this,
      activeTurnId = { sink.activeTurn },
      completeActiveTurn = { sink.completedTurns += it },
      emitAudioResponse = { _, response -> sink.audioResponses += response },
      emitError = { sink.errors += it },
    )

  // Advance both the coroutine scheduler and ShadowSystemClock together so the
  // receiver's delay() fires AND its elapsedRealtime()-based window math sees the
  // same elapsed time.
  private fun TestScope.advanceClocks(millis: Long) {
    ShadowSystemClock.advanceBy(Duration.ofMillis(millis))
    advanceTimeBy(millis)
    runCurrent()
  }

  @Test
  fun `complete in-order response emits one concatenated audio response and no error`() =
    runTest(dispatcher) {
      val sink = Sink()
      val receiver = newReceiver(sink)

      receiver.acceptChunk(chunkIndex = 0, data = byteArrayOf(1, 2))
      receiver.acceptChunk(chunkIndex = 1, data = byteArrayOf(3, 4))
      receiver.acceptChunk(chunkIndex = 2, data = byteArrayOf(5))
      receiver.acceptDone(chunkCount = 3, format = WearRelayProtocol.RESPONSE_FORMAT_MP3)
      runCurrent()

      assertEquals(1, sink.audioResponses.size)
      val response = sink.audioResponses.single()
      assertEquals("turn-1", response.turnId)
      assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5), response.audioBytes)
      assertEquals(WearRelayProtocol.RESPONSE_FORMAT_MP3, response.format)
      assertEquals(emptyList<String>(), sink.errors)
    }

  @Test
  fun `back-to-back turns both complete proving the terminal latch is cleared per turn`() =
    runTest(dispatcher) {
      val sink = Sink()
      val receiver = newReceiver(sink)

      // Turn A.
      sink.activeTurn = "turn-A"
      receiver.acceptChunk(chunkIndex = 0, data = byteArrayOf(10, 11))
      receiver.acceptDone(chunkCount = 1, format = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K)
      runCurrent()

      // Turn B streams cleanly right after A; reset() opens the next turn the way
      // the relay does between turns.
      sink.activeTurn = "turn-B"
      receiver.reset()
      receiver.acceptChunk(chunkIndex = 0, data = byteArrayOf(20))
      receiver.acceptChunk(chunkIndex = 1, data = byteArrayOf(21, 22))
      receiver.acceptDone(chunkCount = 2, format = WearRelayProtocol.RESPONSE_FORMAT_MP3)
      runCurrent()

      assertEquals(2, sink.audioResponses.size)
      assertEquals("turn-A", sink.audioResponses[0].turnId)
      assertArrayEquals(byteArrayOf(10, 11), sink.audioResponses[0].audioBytes)
      // The first chunk of turn B was NOT swallowed by a stale terminal latch.
      assertEquals("turn-B", sink.audioResponses[1].turnId)
      assertArrayEquals(byteArrayOf(20, 21, 22), sink.audioResponses[1].audioBytes)
      assertEquals(emptyList<String>(), sink.errors)
    }

  @Test
  fun `stalled stream aborts once with complete-turn and error after the idle window`() =
    runTest(dispatcher) {
      val sink = Sink()
      val receiver = newReceiver(sink)

      // First chunk arms the idle timer; `done` never arrives and no further
      // chunks make progress.
      receiver.acceptChunk(chunkIndex = 0, data = byteArrayOf(1))
      runCurrent()
      assertEquals(emptyList<String>(), sink.errors)

      // Push past the 10s window; the idle loop wakes, finds no progress, aborts.
      advanceClocks(idleTimeoutMs)

      assertEquals(listOf("turn-1"), sink.completedTurns)
      assertEquals(listOf("Audio response incomplete"), sink.errors)
      assertEquals(emptyList<PhoneRelayAudioResponse>(), sink.audioResponses)

      // Further clock movement must not produce a second abort.
      advanceClocks(idleTimeoutMs)
      assertEquals(1, sink.completedTurns.size)
      assertEquals(1, sink.errors.size)
    }

  @Test
  fun `slow-but-live stream does not abort when a late chunk lands before the window`() =
    runTest(dispatcher) {
      val sink = Sink()
      val receiver = newReceiver(sink)

      receiver.acceptChunk(chunkIndex = 0, data = byteArrayOf(1))
      runCurrent()

      // Most of the window passes with no progress...
      advanceClocks(idleTimeoutMs - 1_000)
      assertEquals(emptyList<String>(), sink.errors)

      // ...then a late-but-healthy chunk refreshes the deadline.
      receiver.acceptChunk(chunkIndex = 1, data = byteArrayOf(2))
      runCurrent()

      // Crossing the ORIGINAL deadline must not abort, because progress was made.
      advanceClocks(2_000)
      assertEquals(emptyList<String>(), sink.errors)
      assertEquals(emptyList<String>(), sink.completedTurns)

      // The refreshed window can still eventually fire if the stream then stalls.
      advanceClocks(idleTimeoutMs)
      assertEquals(listOf("turn-1"), sink.completedTurns)
      assertEquals(listOf("Audio response incomplete"), sink.errors)
    }

  @Test
  fun `normal complete cancels the idle timer so no spurious error fires later`() =
    runTest(dispatcher) {
      val sink = Sink()
      val receiver = newReceiver(sink)

      receiver.acceptChunk(chunkIndex = 0, data = byteArrayOf(7, 8))
      receiver.acceptDone(chunkCount = 1, format = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K)
      runCurrent()

      assertEquals(1, sink.audioResponses.size)

      // Long after completion the cancelled idle job must not surface an error or
      // re-complete the (already finished) turn.
      advanceClocks(idleTimeoutMs * 3)

      assertEquals(emptyList<String>(), sink.errors)
      assertEquals(emptyList<String>(), sink.completedTurns)
      assertEquals(1, sink.audioResponses.size)
    }

  @Test
  fun `malformed done aborts the turn with a single error`() =
    runTest(dispatcher) {
      val sink = Sink()
      val receiver = newReceiver(sink)

      receiver.acceptDone(chunkCount = null, format = WearRelayProtocol.RESPONSE_FORMAT_MP3)
      runCurrent()

      assertEquals(listOf("turn-1"), sink.completedTurns)
      assertEquals(listOf("Audio response incomplete"), sink.errors)
      assertEquals(emptyList<PhoneRelayAudioResponse>(), sink.audioResponses)
    }

  @Test
  fun `complete with no active turn drops the response without emitting`() =
    runTest(dispatcher) {
      val sink = Sink()
      val receiver = newReceiver(sink)

      // Turn was cancelled/completed elsewhere before the audio arrived.
      sink.activeTurn = null
      receiver.acceptChunk(chunkIndex = 0, data = byteArrayOf(1))
      receiver.acceptDone(chunkCount = 1, format = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K)
      runCurrent()

      assertNull(sink.audioResponses.firstOrNull())
      assertEquals(emptyList<String>(), sink.errors)
    }
}
