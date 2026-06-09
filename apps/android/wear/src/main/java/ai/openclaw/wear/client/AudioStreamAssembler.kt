package ai.openclaw.wear.client

internal sealed interface StreamBreakReason {
  /**
   * The stream had to be reset because too many out-of-order chunks were
   * buffered before the contiguous prefix could advance. [missingChunks] is
   * the count of chunks the assembler is still waiting for at the time of
   * the reset (>= 1).
   */
  data class TooManyPendingChunks(
    val missingChunks: Int,
  ) : StreamBreakReason

  /**
   * The server-supplied done.chunkCount is less than the number of chunks the
   * assembler has already emitted. [extraChunksEmitted] is the count of
   * already-emitted chunks beyond the server's claimed total (>= 1).
   */
  data class DoneCountBehind(
    val extraChunksEmitted: Int,
  ) : StreamBreakReason

  /**
   * The wire-level done payload could not be parsed (missing/malformed
   * `chunkCount`). The assembler itself never emits this — the wire-decoder
   * detects it before calling [AudioStreamAssembler.acceptDone] — but it
   * lives in the same taxonomy so callers can route every "stream broke"
   * branch through the same reporter.
   */
  data object MalformedDonePayload : StreamBreakReason
}

internal class AudioStreamAssembler(
  private val onChunk: (ByteArray) -> Unit,
  private val onComplete: (Int) -> Unit,
  private val onIncomplete: (StreamBreakReason) -> Unit,
) {
  companion object {
    private const val MAX_PENDING_CHUNKS = 256
  }

  private var expectedChunkIndex = 0
  private var expectedChunkTotal: Int? = null
  private val pendingChunks = mutableMapOf<Int, ByteArray>()

  fun reset() {
    expectedChunkIndex = 0
    expectedChunkTotal = null
    pendingChunks.clear()
  }

  fun acceptChunk(
    index: Int,
    data: ByteArray,
  ) {
    when {
      index < expectedChunkIndex -> Unit
      index == expectedChunkIndex -> {
        emitChunk(data)
        flushContiguousChunks()
        completeIfReady()
      }
      pendingChunks.size >= MAX_PENDING_CHUNKS -> {
        // Capture the missing-chunk count BEFORE reset() zeros the underlying
        // counters; otherwise the callback receives 0 and the operator log
        // loses the only signal of how broken the stream was.
        val missing = incompleteChunkCount().coerceAtLeast(1)
        reset()
        onIncomplete(StreamBreakReason.TooManyPendingChunks(missingChunks = missing))
      }
      else -> pendingChunks[index] = data
    }
  }

  fun acceptDone(chunkCount: Int) {
    if (chunkCount < expectedChunkIndex) {
      val extra = expectedChunkIndex - chunkCount
      reset()
      onIncomplete(StreamBreakReason.DoneCountBehind(extraChunksEmitted = extra))
      return
    }
    expectedChunkTotal = chunkCount
    completeIfReady()
  }

  fun missingChunkCount(): Int {
    val total = expectedChunkTotal ?: return 0
    return maxOf(0, total - expectedChunkIndex)
  }

  fun incompleteChunkCount(): Int =
    missingChunkCount().takeIf { it > 0 }
      ?: if (hasOpenStream()) 1 else 0

  fun hasOpenStream(): Boolean = expectedChunkIndex > 0 || expectedChunkTotal != null || pendingChunks.isNotEmpty()

  private fun emitChunk(data: ByteArray) {
    if (data.isNotEmpty()) onChunk(data)
    expectedChunkIndex++
  }

  private fun flushContiguousChunks() {
    while (true) {
      val next = pendingChunks.remove(expectedChunkIndex) ?: return
      emitChunk(next)
    }
  }

  private fun completeIfReady() {
    val total = expectedChunkTotal ?: return
    if (expectedChunkIndex < total) return
    reset()
    onComplete(total)
  }
}
