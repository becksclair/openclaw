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

  // Terminal latch: once a stream completes or breaks, further chunks/done are
  // ignored until the caller reset()s for a new turn. Without it, a late chunk
  // arriving after done would start a phantom stream and emit stray audio.
  private var closed = false

  fun reset() {
    expectedChunkIndex = 0
    expectedChunkTotal = null
    closed = false
    pendingChunks.clear()
  }

  // Latch the stream terminal and free buffered data; the caller resets counters
  // when it starts the next turn.
  private fun finish() {
    closed = true
    pendingChunks.clear()
  }

  fun acceptChunk(
    index: Int,
    data: ByteArray,
  ) {
    if (closed) return
    when {
      index < expectedChunkIndex -> Unit
      index == expectedChunkIndex -> {
        emitChunk(data)
        flushContiguousChunks()
        completeIfReady()
      }
      pendingChunks.size >= MAX_PENDING_CHUNKS -> {
        // Capture the missing-chunk count BEFORE finish() so the callback gets a
        // real signal of how broken the stream was, not 0.
        val missing = incompleteChunkCount().coerceAtLeast(1)
        finish()
        onIncomplete(StreamBreakReason.TooManyPendingChunks(missingChunks = missing))
      }
      else -> pendingChunks[index] = data
    }
  }

  fun acceptDone(chunkCount: Int) {
    if (closed) return
    if (chunkCount < expectedChunkIndex) {
      val extra = expectedChunkIndex - chunkCount
      finish()
      onIncomplete(StreamBreakReason.DoneCountBehind(extraChunksEmitted = extra))
      return
    }
    // A buffered index at/beyond the announced total can never be emitted
    // without over-shooting the count, so the stream is structurally broken.
    // Includes done(0) with any buffered data. Report the over-shoot count.
    val maxBufferedIndex = pendingChunks.keys.maxOrNull()
    if (maxBufferedIndex != null && maxBufferedIndex >= chunkCount) {
      val extra = maxBufferedIndex - chunkCount + 1
      finish()
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

  fun hasOpenStream(): Boolean = !closed && (expectedChunkIndex > 0 || expectedChunkTotal != null || pendingChunks.isNotEmpty())

  private fun emitChunk(data: ByteArray) {
    if (data.isNotEmpty()) onChunk(data)
    expectedChunkIndex++
  }

  private fun flushContiguousChunks() {
    // Never advance past the announced total: once enough chunks are emitted,
    // any later-indexed buffered chunk is a protocol break handled by acceptDone.
    while (expectedChunkTotal == null || expectedChunkIndex < expectedChunkTotal!!) {
      val next = pendingChunks.remove(expectedChunkIndex) ?: return
      emitChunk(next)
    }
  }

  private fun completeIfReady() {
    val total = expectedChunkTotal ?: return
    // Strict equality: flushContiguousChunks() is bounded by total, so the index
    // can land exactly on total and never beyond. Over-shoot is impossible here.
    if (expectedChunkIndex != total) return
    finish()
    onComplete(total)
  }
}
