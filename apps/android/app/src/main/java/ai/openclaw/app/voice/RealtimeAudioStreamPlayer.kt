package ai.openclaw.app.voice

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal class RealtimeAudioStreamPlayer {
  private val lock = Any()
  private var active: ActiveStream? = null

  suspend fun enqueuePcm16(bytes: ByteArray, sampleRate: Int) {
    if (bytes.isEmpty()) return
    withContext(Dispatchers.IO) {
      val track = synchronized(lock) {
        val current = active
        if (current != null && current.sampleRate == sampleRate) {
          current.track
        } else {
          current?.close()
          val created = createTrack(sampleRate)
          created.play()
          active = ActiveStream(track = created, sampleRate = sampleRate)
          created
        }
      }
      val written = track.write(bytes, 0, bytes.size, AudioTrack.WRITE_BLOCKING)
      if (written < 0) {
        throw IllegalStateException("AudioTrack write failed: $written")
      }
    }
  }

  fun stop() {
    synchronized(lock) {
      active?.close()
      active = null
    }
  }

  private fun createTrack(sampleRate: Int): AudioTrack {
    val minBufferSize =
      AudioTrack.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_OUT_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
    if (minBufferSize <= 0) {
      throw IllegalStateException("AudioTrack buffer unavailable")
    }
    return AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(sampleRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
      )
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setBufferSizeInBytes(maxOf(minBufferSize, sampleRate / 2))
      .build()
  }

  private data class ActiveStream(
    val track: AudioTrack,
    val sampleRate: Int,
  ) {
    fun close() {
      runCatching { track.pause() }
      runCatching { track.flush() }
      runCatching { track.stop() }
      track.release()
    }
  }
}
