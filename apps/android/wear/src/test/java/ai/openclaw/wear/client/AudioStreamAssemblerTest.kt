package ai.openclaw.wear.client

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioStreamAssemblerTest {
  @Test
  fun emitsContiguousChunksInOrderBeforeDone() {
    val chunks = mutableListOf<ByteArray>()
    var doneCount: Int? = null
    val assembler =
      AudioStreamAssembler(
        onChunk = { chunks.add(it) },
        onComplete = { doneCount = it },
        onIncomplete = { error("unexpected incomplete stream: $it") },
      )

    assembler.acceptChunk(index = 1, data = byteArrayOf(2))
    assembler.acceptChunk(index = 0, data = byteArrayOf(1))
    assembler.acceptDone(chunkCount = 2)

    assertEquals(2, chunks.size)
    assertArrayEquals(byteArrayOf(1), chunks[0])
    assertArrayEquals(byteArrayOf(2), chunks[1])
    assertEquals(2, doneCount)
  }

  @Test
  fun waitsForMissingChunksWhenDoneArrivesEarly() {
    val chunks = mutableListOf<ByteArray>()
    var completed = false
    val assembler =
      AudioStreamAssembler(
        onChunk = { chunks.add(it) },
        onComplete = { completed = true },
        onIncomplete = { error("unexpected incomplete stream: $it") },
      )

    assembler.acceptDone(chunkCount = 2)
    assembler.acceptChunk(index = 0, data = byteArrayOf(3))
    assertEquals(false, completed)
    assembler.acceptChunk(index = 1, data = byteArrayOf(4))

    assertTrue(completed)
    assertEquals(2, chunks.size)
    assertArrayEquals(byteArrayOf(3), chunks[0])
    assertArrayEquals(byteArrayOf(4), chunks[1])
  }

  @Test
  fun reportsOpenStreamWhenDoneIsMissing() {
    val assembler =
      AudioStreamAssembler(
        onChunk = {},
        onComplete = { error("unexpected complete stream") },
        onIncomplete = { error("unexpected incomplete stream: $it") },
      )

    assembler.acceptChunk(index = 0, data = byteArrayOf(1))

    assertTrue(assembler.hasOpenStream())
    assertEquals(1, assembler.incompleteChunkCount())
  }

  @Test
  fun reportsMissingChunkCountAfterEarlyDone() {
    val assembler =
      AudioStreamAssembler(
        onChunk = {},
        onComplete = { error("unexpected complete stream") },
        onIncomplete = { error("unexpected incomplete stream: $it") },
      )

    assembler.acceptDone(chunkCount = 3)
    assembler.acceptChunk(index = 0, data = byteArrayOf(1))

    assertTrue(assembler.hasOpenStream())
    assertEquals(2, assembler.incompleteChunkCount())
  }

  @Test
  fun rejectsDoneCountBehindAlreadyEmittedChunks() {
    var reason: StreamBreakReason? = null
    val assembler =
      AudioStreamAssembler(
        onChunk = {},
        onComplete = { error("unexpected complete stream") },
        onIncomplete = { reason = it },
      )

    assembler.acceptChunk(index = 0, data = byteArrayOf(1))
    assembler.acceptChunk(index = 1, data = byteArrayOf(2))
    assembler.acceptDone(chunkCount = 1)

    val captured = reason
    assertTrue("expected DoneCountBehind, got $captured", captured is StreamBreakReason.DoneCountBehind)
    assertEquals(1, (captured as StreamBreakReason.DoneCountBehind).extraChunksEmitted)
    assertEquals(false, assembler.hasOpenStream())
  }

  @Test
  fun rejectsBufferedIndexAtOrBeyondDoneTotal() {
    // A chunk buffered at index 2 cannot fit within done(2) (valid indices are
    // 0..1), so the stream is a protocol break, not a 3-chunk completion.
    val chunks = mutableListOf<ByteArray>()
    var reason: StreamBreakReason? = null
    val assembler =
      AudioStreamAssembler(
        onChunk = { chunks.add(it) },
        onComplete = { error("unexpected complete stream") },
        onIncomplete = { reason = it },
      )

    assembler.acceptChunk(index = 2, data = byteArrayOf(3))
    assembler.acceptDone(chunkCount = 2)
    assembler.acceptChunk(index = 0, data = byteArrayOf(1))
    assembler.acceptChunk(index = 1, data = byteArrayOf(2))

    val captured = reason
    assertTrue("expected DoneCountBehind, got $captured", captured is StreamBreakReason.DoneCountBehind)
    assertEquals(0, chunks.size)
    assertEquals(false, assembler.hasOpenStream())
  }

  @Test
  fun rejectsDoneZeroWithPendingData() {
    // done(0) means an empty stream, but a buffered chunk proves otherwise; do
    // not silently complete empty.
    var reason: StreamBreakReason? = null
    val assembler =
      AudioStreamAssembler(
        onChunk = {},
        onComplete = { error("unexpected complete stream") },
        onIncomplete = { reason = it },
      )

    assembler.acceptChunk(index = 1, data = byteArrayOf(1))
    assembler.acceptDone(chunkCount = 0)

    val captured = reason
    assertTrue("expected DoneCountBehind, got $captured", captured is StreamBreakReason.DoneCountBehind)
    assertEquals(false, assembler.hasOpenStream())
  }

  @Test
  fun overflowReportsNonZeroMissingChunkCount() {
    // Regression test for the prior bug where reset() ran before the
    // missing-chunk count was captured, so onIncomplete always received 0
    // in the overflow path.
    var reason: StreamBreakReason? = null
    val assembler =
      AudioStreamAssembler(
        onChunk = {},
        onComplete = { error("unexpected complete stream") },
        onIncomplete = { reason = it },
      )

    // Buffer MAX_PENDING_CHUNKS (256) future chunks; the next out-of-order
    // chunk must trigger the overflow reset and report missing >= 1.
    for (index in 1..256) {
      assembler.acceptChunk(index = index, data = byteArrayOf(index.toByte()))
    }
    assembler.acceptChunk(index = 257, data = byteArrayOf(0))

    val captured = reason
    assertTrue(
      "expected TooManyPendingChunks, got $captured",
      captured is StreamBreakReason.TooManyPendingChunks,
    )
    assertTrue((captured as StreamBreakReason.TooManyPendingChunks).missingChunks >= 1)
  }
}
