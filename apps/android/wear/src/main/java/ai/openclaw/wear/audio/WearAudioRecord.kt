package ai.openclaw.wear.audio

import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import java.util.concurrent.Executor

/**
 * Narrow abstraction over [AudioRecord] so [AudioCapture] can be unit-tested
 * without shadowing the Android audio stack.
 */
interface WearAudioRecord {
  val state: Int
  val audioSessionId: Int

  fun read(
    buffer: ByteArray,
    offset: Int,
    size: Int,
  ): Int

  fun startRecording()

  fun stop()

  fun release()

  fun registerAudioRecordingCallback(
    executor: Executor,
    callback: AudioManager.AudioRecordingCallback,
  )

  fun unregisterAudioRecordingCallback(callback: AudioManager.AudioRecordingCallback)
}

internal class RealWearAudioRecord(
  private val record: AudioRecord,
) : WearAudioRecord {
  override val state: Int get() = record.state
  override val audioSessionId: Int get() = record.audioSessionId

  override fun read(
    buffer: ByteArray,
    offset: Int,
    size: Int,
  ): Int = record.read(buffer, offset, size)

  override fun startRecording() = record.startRecording()

  override fun stop() = record.stop()

  override fun release() = record.release()

  override fun registerAudioRecordingCallback(
    executor: Executor,
    callback: AudioManager.AudioRecordingCallback,
  ) = record.registerAudioRecordingCallback(executor, callback)

  override fun unregisterAudioRecordingCallback(callback: AudioManager.AudioRecordingCallback) = record.unregisterAudioRecordingCallback(callback)
}

interface WearAudioRecordFactory {
  fun minBufferSize(sampleRateHz: Int): Int

  fun create(
    sampleRateHz: Int,
    bufferSize: Int,
  ): WearAudioRecord?
}

internal object DefaultWearAudioRecordFactory : WearAudioRecordFactory {
  override fun minBufferSize(sampleRateHz: Int): Int =
    AudioRecord.getMinBufferSize(
      sampleRateHz,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )

  override fun create(
    sampleRateHz: Int,
    bufferSize: Int,
  ): WearAudioRecord? {
    val record =
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        sampleRateHz,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufferSize,
      )
    return if (record.state == AudioRecord.STATE_INITIALIZED) {
      RealWearAudioRecord(record)
    } else {
      record.release()
      null
    }
  }
}
