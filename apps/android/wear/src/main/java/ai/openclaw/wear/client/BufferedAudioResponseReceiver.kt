package ai.openclaw.wear.client

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream

internal class BufferedAudioResponseReceiver(
  private val scope: CoroutineScope,
  private val activeTurnId: () -> String?,
  private val completeActiveTurn: (String?) -> Unit,
  private val emitAudioResponse: (String?, PhoneRelayClient.AudioResponse) -> Unit,
  private val emitError: suspend (String) -> Unit,
) {
  companion object {
    private const val TAG = "OpenClawWearRelay"
    private const val MAX_AUDIO_ACCUMULATOR_BYTES = 50 * 1024 * 1024
    private const val AUDIO_CHUNK_COMPLETION_TIMEOUT_MS = 3_000L
  }

  private val lock = Any()
  private val accumulator = ByteArrayOutputStream()
  private val assembler =
    AudioStreamAssembler(
      onChunk = ::onAssemblerChunk,
      onComplete = ::onAssemblerComplete,
      onIncomplete = ::onAssemblerIncomplete,
    )
  private var format: String = PhoneRelayClient.RESPONSE_FORMAT_PCM_24K
  private var aborted = false
  private var completionTimeoutJob: Job? = null

  private data class CompletionTimeoutResult(
    val missingChunks: Int,
    val turnId: String?,
  )

  fun reset() {
    cancelCompletionTimeout()
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
    }
  }

  fun acceptDone(
    turnId: String?,
    chunkCount: Int?,
    format: String,
  ) {
    if (chunkCount == null) {
      failMalformedDone(turnId)
      return
    }
    synchronized(lock) {
      if (aborted) return@synchronized
      this.format = format
      assembler.acceptDone(chunkCount)
      if (!aborted && assembler.hasOpenStream()) {
        scheduleCompletionTimeout()
      }
    }
  }

  private fun failMalformedDone(turnId: String?) {
    Log.w(TAG, "invalid audio done payload, resetting (${StreamBreakReason.MalformedDonePayload})")
    synchronized(lock) {
      if (aborted) return@synchronized
      aborted = true
      assembler.reset()
      accumulator.reset()
      format = PhoneRelayClient.RESPONSE_FORMAT_PCM_24K
    }
    cancelCompletionTimeout()
    completeActiveTurn(turnId)
    scope.launch { emitError("Audio response incomplete") }
  }

  private fun onAssemblerChunk(chunk: ByteArray) {
    if (aborted) return
    val nextSize = accumulator.size().toLong() + chunk.size
    if (nextSize > MAX_AUDIO_ACCUMULATOR_BYTES) {
      Log.e(TAG, "audio accumulator limit reached at ${nextSize}B / ${MAX_AUDIO_ACCUMULATOR_BYTES}B, resetting")
      val turnId = activeTurnId()
      aborted = true
      assembler.reset()
      accumulator.reset()
      format = PhoneRelayClient.RESPONSE_FORMAT_PCM_24K
      cancelCompletionTimeout()
      completeActiveTurn(turnId)
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
    val turnId = activeTurnId()
    accumulator.reset()
    format = PhoneRelayClient.RESPONSE_FORMAT_PCM_24K
    cancelCompletionTimeout()
    emitAudioResponse(
      turnId,
      PhoneRelayClient.AudioResponse(turnId = null, audioBytes = bytes, format = completedFormat),
    )
  }

  private fun onAssemblerIncomplete(reason: StreamBreakReason) {
    if (aborted) return
    Log.w(TAG, "buffered audio response incomplete: $reason")
    val turnId = activeTurnId()
    aborted = true
    accumulator.reset()
    format = PhoneRelayClient.RESPONSE_FORMAT_PCM_24K
    cancelCompletionTimeout()
    completeActiveTurn(turnId)
    scope.launch { emitError("Audio response incomplete") }
  }

  private fun scheduleCompletionTimeout() {
    if (completionTimeoutJob?.isActive == true) return
    completionTimeoutJob =
      scope.launch {
        delay(AUDIO_CHUNK_COMPLETION_TIMEOUT_MS)
        val timeoutResult =
          synchronized(lock) {
            val missing = assembler.incompleteChunkCount()
            if (missing <= 0 || aborted) return@synchronized null
            val turnId = activeTurnId()
            aborted = true
            assembler.reset()
            accumulator.reset()
            format = PhoneRelayClient.RESPONSE_FORMAT_PCM_24K
            CompletionTimeoutResult(missing, turnId)
          }
        if (timeoutResult == null) return@launch
        Log.w(TAG, "timed out waiting for ${timeoutResult.missingChunks} audio chunk(s)")
        completionTimeoutJob = null
        completeActiveTurn(timeoutResult.turnId)
        emitError("Audio response incomplete")
      }
  }

  private fun cancelCompletionTimeout() {
    completionTimeoutJob?.cancel()
    completionTimeoutJob = null
  }

  private fun resetLocked() {
    accumulator.reset()
    format = PhoneRelayClient.RESPONSE_FORMAT_PCM_24K
    aborted = false
    assembler.reset()
  }
}
