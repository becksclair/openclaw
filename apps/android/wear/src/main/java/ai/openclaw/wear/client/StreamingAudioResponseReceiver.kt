package ai.openclaw.wear.client

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal class StreamingAudioResponseReceiver(
  private val scope: CoroutineScope,
  private val activeTurnId: () -> String?,
  private val completeActiveTurn: (String?) -> Unit,
  private val emitStreamEvent: (PhoneRelayAudioStreamEvent) -> Unit,
  private val emitError: suspend (String) -> Unit,
) {
  companion object {
    private const val TAG = "OpenClawWearRelay"
    private const val AUDIO_STREAM_IDLE_TIMEOUT_MS = 10_000L
  }

  private val lock = Any()
  private val assembler =
    AudioStreamAssembler(
      onChunk = { chunk ->
        val turnId = activeTurnId()
        if (turnId == null) {
          Log.w(TAG, "dropping stream chunk without an active turn")
        } else {
          emitStreamEvent(PhoneRelayAudioStreamEvent.Chunk(turnId = turnId, audioBytes = chunk))
        }
      },
      onComplete = { chunkCount ->
        val turnId = activeTurnId()
        if (turnId == null) {
          Log.w(TAG, "dropping stream completion without an active turn")
        } else {
          completeActiveTurn(turnId)
          cancelCompletionTimeout()
          emitStreamEvent(PhoneRelayAudioStreamEvent.Done(turnId = turnId, chunkCount = chunkCount))
        }
      },
      onIncomplete = ::failIncompleteStream,
    )
  private var completionTimeoutJob: Job? = null

  fun reset() {
    cancelCompletionTimeout()
    synchronized(lock) {
      assembler.reset()
    }
  }

  fun acceptChunk(
    chunkIndex: Int?,
    data: ByteArray,
  ) {
    if (chunkIndex == null) return
    synchronized(lock) {
      assembler.acceptChunk(index = chunkIndex, data = data)
      if (assembler.hasOpenStream()) {
        ensureCompletionTimeout()
      }
    }
  }

  fun acceptDone(chunkCount: Int?) {
    if (chunkCount == null) {
      Log.w(TAG, "invalid stream audio done payload, resetting")
      synchronized(lock) {
        assembler.reset()
      }
      failIncompleteStream(StreamBreakReason.MalformedDonePayload)
      return
    }
    synchronized(lock) {
      assembler.acceptDone(chunkCount)
      if (assembler.hasOpenStream()) {
        ensureCompletionTimeout()
      }
    }
  }

  private fun ensureCompletionTimeout() {
    if (completionTimeoutJob?.isActive == true) return
    completionTimeoutJob =
      scope.launch {
        delay(AUDIO_STREAM_IDLE_TIMEOUT_MS)
        val missingChunks =
          synchronized(lock) {
            val missing = assembler.incompleteChunkCount()
            if (missing > 0) {
              assembler.reset()
            }
            missing
          }
        if (missingChunks <= 0) return@launch
        completionTimeoutJob = null
        failIncompleteStream(StreamBreakReason.TooManyPendingChunks(missingChunks))
      }
  }

  private fun failIncompleteStream(reason: StreamBreakReason) {
    cancelCompletionTimeout()
    completeActiveTurn(activeTurnId())
    Log.w(TAG, "stream audio response incomplete: $reason")
    scope.launch { emitError("Audio response incomplete") }
  }

  private fun cancelCompletionTimeout() {
    completionTimeoutJob?.cancel()
    completionTimeoutJob = null
  }
}
