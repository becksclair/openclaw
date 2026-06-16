package ai.openclaw.wear.audio

import ai.openclaw.audio.PcmAudio
import android.Manifest
import android.app.Application
import android.media.AudioRecord
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class AudioCaptureTest {
  private val context = ApplicationProvider.getApplicationContext<Application>()

  @Test
  fun startReturnsFalseWhenPermissionDenied() {
    shadowOf(context).denyPermissions(Manifest.permission.RECORD_AUDIO)
    val capture = AudioCapture(context, CoroutineScope(Dispatchers.IO))

    val started = capture.start(onChunk = {})

    assertFalse(started)
  }

  @Test
  fun startReturnsFalseWhenMinBufferSizeInvalid() {
    grantPermission()
    val factory = FakeWearAudioRecordFactory(minBufferSize = -1, record = null)
    val capture = AudioCapture(context, CoroutineScope(Dispatchers.IO), recordFactory = factory)

    val started = capture.start(onChunk = {})

    assertFalse(started)
  }

  @Test
  fun startReturnsFalseWhenRecordCreationFails() {
    grantPermission()
    val factory = FakeWearAudioRecordFactory(record = null)
    val capture = AudioCapture(context, CoroutineScope(Dispatchers.IO), recordFactory = factory)

    val started = capture.start(onChunk = {})

    assertFalse(started)
  }

  @Test
  fun startReturnsFalseWhenStartRecordingThrows() {
    grantPermission()
    val record = FakeWearAudioRecord(throwOnStart = true)
    val factory = FakeWearAudioRecordFactory(record = record)
    val capture = AudioCapture(context, CoroutineScope(Dispatchers.IO), recordFactory = factory)

    val started = capture.start(onChunk = {})

    assertFalse(started)
  }

  @Test
  fun startEmitsAudioChunks() =
    runTest {
      grantPermission()
      val chunkCount = AtomicInteger(0)
      val record = FakeWearAudioRecord(chunks = List(30) { toneChunk() })
      val factory = FakeWearAudioRecordFactory(record = record)
      val scope = CoroutineScope(Dispatchers.IO)
      val capture = AudioCapture(context, scope, recordFactory = factory)

      val started = capture.start(onChunk = { chunkCount.incrementAndGet() })
      assertTrue(started)

      delay(150)
      capture.stop(discardPending = false)
      scope.cancel()

      assertTrue(chunkCount.get() > 0)
    }

  @Test
  fun startReturnsFalseWhenAlreadyRecording() =
    runBlocking {
      grantPermission()
      val record = FakeWearAudioRecord(chunks = List(30) { toneChunk() })
      val factory = FakeWearAudioRecordFactory(record = record)
      val scope = CoroutineScope(Dispatchers.IO)
      val capture = AudioCapture(context, scope, recordFactory = factory)

      val first = capture.start(onChunk = {})
      assertTrue(first)
      val second = capture.start(onChunk = {})
      assertFalse(second)

      capture.stop(discardPending = true)
      scope.cancel()
    }

  private fun grantPermission() {
    shadowOf(context).grantPermissions(Manifest.permission.RECORD_AUDIO)
  }

  private fun toneChunk(): ByteArray {
    val samples = SAMPLE_RATE_HZ * 20 / 1_000
    val bytes = ByteArray(samples * 2)
    for (sample in 0 until samples) {
      val phase = sample % 80
      val value = if (phase < 40) 10_000 else -10_000
      PcmAudio.writePcm16Sample(bytes, sample * 2, value)
    }
    return bytes
  }

  private companion object {
    private const val SAMPLE_RATE_HZ = 24_000
  }
}

private class FakeWearAudioRecordFactory(
  private val minBufferSize: Int = 256,
  private val record: WearAudioRecord?,
) : WearAudioRecordFactory {
  override fun minBufferSize(sampleRateHz: Int): Int = minBufferSize

  override fun create(
    sampleRateHz: Int,
    bufferSize: Int,
  ): WearAudioRecord? = record
}

private class FakeWearAudioRecord(
  chunks: List<ByteArray> = emptyList(),
  private val throwOnStart: Boolean = false,
) : WearAudioRecord {
  private val queue = ArrayBlockingQueue<ByteArray>(chunks.size + 1).apply { addAll(chunks) }
  private var started = false

  override val state: Int = AudioRecord.STATE_INITIALIZED
  override val audioSessionId: Int = 42

  override fun read(
    buffer: ByteArray,
    offset: Int,
    size: Int,
  ): Int {
    if (!started) return 0
    val chunk = queue.poll(50, TimeUnit.MILLISECONDS) ?: return 0
    val toCopy = minOf(chunk.size, size)
    chunk.copyInto(buffer, offset, 0, toCopy)
    return toCopy
  }

  override fun startRecording() {
    if (throwOnStart) throw RuntimeException("startRecording failed")
    started = true
  }

  override fun stop() {
    started = false
  }

  override fun release() {}

  override fun registerAudioRecordingCallback(
    executor: Executor,
    callback: android.media.AudioManager.AudioRecordingCallback,
  ) {}

  override fun unregisterAudioRecordingCallback(callback: android.media.AudioManager.AudioRecordingCallback) {}
}
