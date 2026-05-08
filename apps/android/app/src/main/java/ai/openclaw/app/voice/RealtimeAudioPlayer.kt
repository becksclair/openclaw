package ai.openclaw.app.voice

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal interface RealtimeAudioPlayback {
  suspend fun start()

  suspend fun writeBase64(audioBase64: String)

  suspend fun clear()

  suspend fun waitUntilDrained(timeoutMs: Long = 10_000)

  fun stop()
}

internal class RealtimeAudioPlayer(
  private val sampleRateHz: Int = 24_000,
) : RealtimeAudioPlayback {
  private val lock = Any()
  private val writeMutex = Mutex()
  private var track: AudioTrack? = null
  private var framesWritten = 0L

  override suspend fun start() {
    withContext(Dispatchers.IO) {
      synchronized(lock) {
        if (track != null) return@withContext
        framesWritten = 0L
        val minBufferSize =
          AudioTrack.getMinBufferSize(
            sampleRateHz,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
          )
        if (minBufferSize <= 0) {
          throw IllegalStateException("Realtime AudioTrack buffer unavailable")
        }
        val active =
          AudioTrack
            .Builder()
            .setAudioAttributes(
              AudioAttributes
                .Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
            ).setAudioFormat(
              AudioFormat
                .Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRateHz)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build(),
            ).setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(minBufferSize * 4)
            .build()
        if (active.state != AudioTrack.STATE_INITIALIZED) {
          active.release()
          throw IllegalStateException("Realtime AudioTrack unavailable")
        }
        try {
          active.play()
        } catch (err: Throwable) {
          active.release()
          throw err
        }
        track = active
      }
    }
  }

  override suspend fun writeBase64(audioBase64: String) {
    val bytes = Base64.decode(audioBase64, Base64.DEFAULT)
    if (bytes.isEmpty()) return
    withContext(Dispatchers.IO) {
      writeMutex.withLock {
        val active = synchronized(lock) { track } ?: throw CancellationException("realtime playback stopped")
        var offset = 0
        while (offset < bytes.size) {
          val written = active.write(bytes, offset, bytes.size - offset)
          if (written < 0) throw IllegalStateException("Realtime AudioTrack write failed")
          if (written == 0) throw CancellationException("realtime playback stalled")
          offset += written
        }
        synchronized(lock) {
          if (track === active) {
            framesWritten += bytes.size / 2L
          }
        }
      }
    }
  }

  override suspend fun clear() {
    withContext(Dispatchers.IO) {
      writeMutex.withLock {
        synchronized(lock) {
          track?.let {
            it.pause()
            it.flush()
            framesWritten = it.playbackHeadPosition.toLong()
            it.play()
          }
        }
      }
    }
  }

  override suspend fun waitUntilDrained(timeoutMs: Long) {
    val startedAt = System.currentTimeMillis()
    while (true) {
      val snapshot = synchronized(lock) { track to framesWritten }
      val active = snapshot.first ?: return
      val targetFrames = snapshot.second
      if (active.playbackHeadPosition.toLong() >= targetFrames) {
        return
      }
      if (System.currentTimeMillis() - startedAt >= timeoutMs) {
        return
      }
      delay(20)
    }
  }

  override fun stop() {
    val active = synchronized(lock) { track.also { track = null } }
    active?.let {
      runCatching { it.pause() }
      runCatching { it.flush() }
      runCatching { it.stop() }
      it.release()
    }
  }
}
