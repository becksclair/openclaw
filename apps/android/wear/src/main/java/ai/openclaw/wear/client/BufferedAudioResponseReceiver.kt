package ai.openclaw.wear.client

import ai.openclaw.common.wear.WearRelayProtocol
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream

internal class BufferedAudioResponseReceiver(
  private val scope: CoroutineScope,
  private val activeTurnId: () -> String?,
  private val completeActiveTurn: (String) -> Unit,
  private val emitAudioResponse: (String, PhoneRelayAudioResponse) -> Unit,
  private val emitError: suspend (String) -> Unit,
) {
  companion object {
    private const val TAG = "OpenClawWearRelay"
    private const val MAX_AUDIO_ACCUMULATOR_BYTES = 50 * 1024 * 1024

    // Abort only after this long with no forward progress (no accepted chunk and
    // no done). Sized for chunked MP3 over the Data Layer, where late chunks are
    // healthy; a fixed post-done deadline would reject slow-but-live streams.
    private const val AUDIO_IDLE_TIMEOUT_MS = 10_000L
  }

  private val lock = Any()
  private val accumulator = ByteArrayOutputStream()
  private val assembler =
    AudioStreamAssembler(
      onChunk = ::onAssemblerChunk,
      onComplete = ::onAssemblerComplete,
      onIncomplete = ::onAssemblerIncomplete,
    )
  private var format: String = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K
  private var aborted = false
  private var idleTimeoutJob: Job? = null
  private var lastProgressAtMs = 0L

  private data class IdleTimeoutResult(
    val missingChunks: Int,
    val turnId: String,
  )

  // Complete the watch's own active turn if one is set; no active turn means
  // there is nothing to tear down.
  private fun completeActiveTurnIfPresent() {
    activeTurnId()?.let(completeActiveTurn)
  }

  fun reset() {
    cancelIdleTimeout()
    synchronized(lock) {
      resetLocked()
    }
  }

  fun acceptChunk(
    chunkIndex: Int?,
    data: ByteArray,
  ) {
    if (chunkIndex == null) return
    synchronized(lock) {
      if (aborted) return@synchronized
      assembler.acceptChunk(index = chunkIndex, data = data)
      // Forward progress: refresh the deadline. Arming on the first chunk means
      // a lost `done` no longer hangs until the global 180s watchdog.
      if (!aborted && assembler.hasOpenStream()) {
        recordProgress()
        scheduleIdleTimeout()
      }
    }
  }

  fun acceptDone(
    chunkCount: Int?,
    format: String,
  ) {
    if (chunkCount == null) {
      failMalformedDone()
      return
    }
    synchronized(lock) {
      if (aborted) return@synchronized
      this.format = format
      assembler.acceptDone(chunkCount)
      // `done` is progress too; keep the stream alive while waiting for missing
      // chunks rather than starting a fixed post-done countdown.
      if (!aborted && assembler.hasOpenStream()) {
        recordProgress()
        scheduleIdleTimeout()
      }
    }
  }

  private fun failMalformedDone() {
    Log.w(TAG, "invalid audio done payload, resetting (${StreamBreakReason.MalformedDonePayload})")
    synchronized(lock) {
      if (aborted) return@synchronized
      aborted = true
      assembler.reset()
      accumulator.reset()
      format = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K
    }
    cancelIdleTimeout()
    completeActiveTurnIfPresent()
    scope.launch { emitError("Audio response incomplete") }
  }

  private fun onAssemblerChunk(chunk: ByteArray) {
    if (aborted) return
    val nextSize = accumulator.size().toLong() + chunk.size
    if (nextSize > MAX_AUDIO_ACCUMULATOR_BYTES) {
      Log.e(TAG, "audio accumulator limit reached at ${nextSize}B / ${MAX_AUDIO_ACCUMULATOR_BYTES}B, resetting")
      aborted = true
      assembler.reset()
      accumulator.reset()
      format = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K
      cancelIdleTimeout()
      completeActiveTurnIfPresent()
      scope.launch { emitError("Audio response incomplete") }
      return
    }
    accumulator.write(chunk)
  }

  private fun onAssemblerComplete(
    @Suppress("UNUSED_PARAMETER") chunkCount: Int,
  ) {
    if (aborted) return
    val bytes = accumulator.toByteArray()
    val completedFormat = format
    accumulator.reset()
    format = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K
    // Clear the assembler's terminal latch so the next turn starts fresh, matching
    // the incomplete handlers; the assembler no longer self-resets on complete.
    assembler.reset()
    cancelIdleTimeout()
    // No active turn means the response arrived for a turn already cancelled or
    // completed; drop it rather than emitting against a wildcard.
    val turnId = activeTurnId() ?: return
    emitAudioResponse(
      turnId,
      PhoneRelayAudioResponse(turnId = turnId, audioBytes = bytes, format = completedFormat),
    )
  }

  private fun onAssemblerIncomplete(reason: StreamBreakReason) {
    if (aborted) return
    Log.w(TAG, "buffered audio response incomplete: $reason")
    aborted = true
    accumulator.reset()
    format = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K
    cancelIdleTimeout()
    completeActiveTurnIfPresent()
    scope.launch { emitError("Audio response incomplete") }
  }

  // Monotonic; survives wall-clock adjustments. Caller holds [lock].
  private fun recordProgress() {
    lastProgressAtMs = SystemClock.elapsedRealtime()
  }

  private fun scheduleIdleTimeout() {
    if (idleTimeoutJob?.isActive == true) return
    idleTimeoutJob =
      scope.launch {
        while (true) {
          // Sleep only until the current deadline could elapse, then re-check.
          // A chunk received meanwhile pushed lastProgressAtMs forward, so we
          // wait out the remaining window instead of aborting a slow-but-live
          // stream.
          val remaining =
            synchronized(lock) { lastProgressAtMs + AUDIO_IDLE_TIMEOUT_MS - SystemClock.elapsedRealtime() }
          if (remaining > 0) {
            delay(remaining)
            continue
          }
          val timeoutResult = abortForIdleLocked()
          // Stream resolved (completed/aborted) before the window; the resolving
          // path already cancelled this job, so just exit.
          if (timeoutResult == null) {
            idleTimeoutJob = null
            return@launch
          }
          idleTimeoutJob = null
          Log.w(TAG, "no audio progress for ${AUDIO_IDLE_TIMEOUT_MS}ms; ${timeoutResult.missingChunks} chunk(s) missing")
          completeActiveTurn(timeoutResult.turnId)
          emitError("Audio response incomplete")
          return@launch
        }
      }
  }

  private fun abortForIdleLocked(): IdleTimeoutResult? =
    synchronized(lock) {
      val missing = assembler.incompleteChunkCount()
      val turnId = activeTurnId()
      if (missing <= 0 || aborted || turnId == null) return@synchronized null
      aborted = true
      assembler.reset()
      accumulator.reset()
      format = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K
      IdleTimeoutResult(missing, turnId)
    }

  private fun cancelIdleTimeout() {
    idleTimeoutJob?.cancel()
    idleTimeoutJob = null
  }

  private fun resetLocked() {
    accumulator.reset()
    format = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K
    aborted = false
    assembler.reset()
  }
}
