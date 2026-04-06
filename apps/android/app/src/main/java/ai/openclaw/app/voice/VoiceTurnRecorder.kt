package ai.openclaw.app.voice

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

internal data class VoiceRecordedTurn(
  val pcm16: ByteArray,
  val sampleRate: Int,
  val channels: Int,
  val durationMs: Int,
)

internal class VoiceTurnRecorder(
  private val scope: CoroutineScope,
  private val onInputLevel: (Float) -> Unit,
  private val onTurnReady: suspend (VoiceRecordedTurn) -> Unit,
) {
  companion object {
    private const val tag = "VoiceTurnRecorder"
    private const val sampleRate = 16_000
    private const val channelCount = 1
    private const val bytesPerSample = 2
    private const val minTurnMs = 500
    private const val maxTurnMs = 12_000
    private const val silenceHoldMs = 900
    private const val startThreshold = 0.08f
    private const val continueThreshold = 0.04f
  }

  private var recordJob: Job? = null
  private var audioRecord: AudioRecord? = null

  fun start() {
    if (recordJob?.isActive == true) return
    recordJob =
      scope.launch(Dispatchers.IO) {
        runRecorderLoop()
      }
  }

  suspend fun stop() {
    recordJob?.cancel()
    recordJob = null
    releaseRecorder()
    onInputLevel(0f)
  }

  private suspend fun runRecorderLoop() {
    val minBufferSize =
      AudioRecord.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
    if (minBufferSize <= 0) {
      Log.w(tag, "AudioRecord buffer unavailable")
      onInputLevel(0f)
      return
    }

    val readBuffer = ByteArray(maxOf(minBufferSize, 2048))
    val maxTurnBytes = sampleRate * channelCount * bytesPerSample * maxTurnMs / 1000
    val minTurnBytes = sampleRate * channelCount * bytesPerSample * minTurnMs / 1000
    val record =
      AudioRecord(
        MediaRecorder.AudioSource.MIC,
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(minBufferSize, 4096),
      )
    audioRecord = record

    if (record.state != AudioRecord.STATE_INITIALIZED) {
      Log.w(tag, "AudioRecord failed to initialize")
      releaseRecorder()
      onInputLevel(0f)
      return
    }

    val turnBuffer = ArrayList<Byte>()
    var turnActive = false
    var silenceMs = 0L

    try {
      record.startRecording()
      while (scope.isActive) {
        val bytesRead = record.read(readBuffer, 0, readBuffer.size)
        if (bytesRead <= 0) {
          delay(20)
          continue
        }
        val level = pcmLevel(readBuffer, bytesRead)
        onInputLevel(level)

        val aboveThreshold = if (turnActive) level >= continueThreshold else level >= startThreshold
        if (!turnActive) {
          if (!aboveThreshold) {
            continue
          }
          turnActive = true
          turnBuffer.clear()
          silenceMs = 0L
        }

        for (index in 0 until bytesRead) {
          turnBuffer.add(readBuffer[index])
        }

        val chunkMs = bytesToDurationMs(bytesRead)
        if (aboveThreshold) {
          silenceMs = 0L
        } else {
          silenceMs += chunkMs
        }

        val shouldFlush =
          turnBuffer.size >= maxTurnBytes ||
            (silenceMs >= silenceHoldMs && turnBuffer.size >= minTurnBytes)
        if (!shouldFlush) {
          continue
        }

        val pcm = ByteArray(turnBuffer.size)
        turnBuffer.forEachIndexed { index, byte -> pcm[index] = byte }
        turnBuffer.clear()
        turnActive = false
        silenceMs = 0L
        onInputLevel(0f)
        onTurnReady(
          VoiceRecordedTurn(
            pcm16 = pcm,
            sampleRate = sampleRate,
            channels = channelCount,
            durationMs = bytesToDurationMs(pcm.size),
          ),
        )
      }
    } finally {
      releaseRecorder()
      onInputLevel(0f)
    }
  }

  private fun releaseRecorder() {
    val active = audioRecord ?: return
    audioRecord = null
    runCatching { active.stop() }
    active.release()
  }

  private fun pcmLevel(buffer: ByteArray, length: Int): Float {
    if (length < 2) return 0f
    var total = 0.0
    var samples = 0
    var index = 0
    while (index + 1 < length) {
      val value =
        ((buffer[index + 1].toInt() shl 8) or (buffer[index].toInt() and 0xFF)).toShort().toInt()
      total += abs(value).toDouble()
      samples += 1
      index += 2
    }
    if (samples == 0) return 0f
    val average = total / samples.toDouble()
    return (average / Short.MAX_VALUE.toDouble()).toFloat().coerceIn(0f, 1f)
  }

  private fun bytesToDurationMs(byteCount: Int): Int {
    val bytesPerSecond = sampleRate * channelCount * bytesPerSample
    if (bytesPerSecond <= 0) return 0
    return ((byteCount.toDouble() / bytesPerSecond.toDouble()) * 1000.0).roundToInt()
  }
}
