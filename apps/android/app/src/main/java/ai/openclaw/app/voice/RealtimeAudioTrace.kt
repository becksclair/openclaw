package ai.openclaw.app.voice

import android.content.Context
import android.os.SystemClock
import android.util.Log
import java.io.File
import java.io.RandomAccessFile

internal object RealtimeAudioTrace {
  private const val tag = "RealtimeAudioTrace"
  private const val sampleRateHz = 24_000
  private const val channels = 1
  private const val bitsPerSample = 16
  private const val wavHeaderBytes = 44L

  private val lock = Any()
  private var active: ActiveTrace? = null

  fun start(
    context: Context,
    name: String? = null,
  ): TraceFiles {
    synchronized(lock) {
      stopLocked()
      val dir = File(context.filesDir, "debug-audio").apply { mkdirs() }
      val baseName = "realtime-${System.currentTimeMillis()}-${safeName(name)}"
      val wavFile = File(dir, "$baseName.wav")
      val metadataFile = File(dir, "$baseName.jsonl")
      val wav = RandomAccessFile(wavFile, "rw")
      wav.setLength(0)
      writeWavHeader(wav, dataBytes = 0)
      metadataFile.writeText(
        """{"type":"start","elapsedRealtimeNanos":${SystemClock.elapsedRealtimeNanos()}}""" + "\n",
      )
      active = ActiveTrace(wavFile = wavFile, metadataFile = metadataFile, wav = wav)
      Log.i(tag, "started wav=${wavFile.absolutePath} metadata=${metadataFile.absolutePath}")
      return TraceFiles(wavFile = wavFile, metadataFile = metadataFile)
    }
  }

  fun recordAudioChunk(bytes: ByteArray) {
    if (bytes.isEmpty()) return
    val now = SystemClock.elapsedRealtimeNanos()
    synchronized(lock) {
      val trace = active ?: return
      val offset = trace.dataBytes
      trace.wav.seek(wavHeaderBytes + offset)
      trace.wav.write(bytes)
      trace.dataBytes += bytes.size
      trace.chunks += 1
      trace.metadataFile.appendText(
        """{"type":"audio","chunk":${trace.chunks},"offsetBytes":$offset,"bytes":${bytes.size},"elapsedRealtimeNanos":$now}""" +
          "\n",
      )
    }
  }

  fun recordEvent(
    type: String,
    fields: Map<String, String> = emptyMap(),
  ) {
    val now = SystemClock.elapsedRealtimeNanos()
    synchronized(lock) {
      val trace = active ?: return
      val fieldJson =
        fields.entries.joinToString(separator = "") { (key, value) ->
          ",\"${escapeJson(key)}\":\"${escapeJson(value)}\""
        }
      trace.metadataFile.appendText(
        """{"type":"${escapeJson(type)}","elapsedRealtimeNanos":$now$fieldJson}""" + "\n",
      )
    }
  }

  fun stop(): TraceFiles? =
    synchronized(lock) {
      stopLocked()
    }

  private fun stopLocked(): TraceFiles? {
    val trace = active ?: return null
    active = null
    writeWavHeader(trace.wav, trace.dataBytes)
    trace.wav.close()
    trace.metadataFile.appendText(
      """{"type":"stop","chunks":${trace.chunks},"bytes":${trace.dataBytes},"elapsedRealtimeNanos":${SystemClock.elapsedRealtimeNanos()}}""" +
        "\n",
    )
    Log.i(tag, "stopped wav=${trace.wavFile.absolutePath} metadata=${trace.metadataFile.absolutePath}")
    return TraceFiles(wavFile = trace.wavFile, metadataFile = trace.metadataFile)
  }

  private fun safeName(name: String?): String {
    val safe =
      name
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.map { char -> if (char.isLetterOrDigit() || char == '-' || char == '_' || char == '.') char else '_' }
        ?.joinToString(separator = "")
        ?.take(48)
    return safe ?: "capture"
  }

  private fun escapeJson(value: String): String =
    buildString {
      for (char in value) {
        when (char) {
          '\\' -> append("\\\\")
          '"' -> append("\\\"")
          '\n' -> append("\\n")
          '\r' -> append("\\r")
          '\t' -> append("\\t")
          else -> append(char)
        }
      }
    }

  private fun writeWavHeader(
    wav: RandomAccessFile,
    dataBytes: Long,
  ) {
    wav.seek(0)
    wav.writeBytes("RIFF")
    wav.writeIntLe((36L + dataBytes).coerceAtMost(UInt.MAX_VALUE.toLong()).toInt())
    wav.writeBytes("WAVE")
    wav.writeBytes("fmt ")
    wav.writeIntLe(16)
    wav.writeShortLe(1)
    wav.writeShortLe(channels)
    wav.writeIntLe(sampleRateHz)
    wav.writeIntLe(sampleRateHz * channels * bitsPerSample / 8)
    wav.writeShortLe(channels * bitsPerSample / 8)
    wav.writeShortLe(bitsPerSample)
    wav.writeBytes("data")
    wav.writeIntLe(dataBytes.coerceAtMost(UInt.MAX_VALUE.toLong()).toInt())
  }

  private fun RandomAccessFile.writeIntLe(value: Int) {
    write(value and 0xff)
    write((value ushr 8) and 0xff)
    write((value ushr 16) and 0xff)
    write((value ushr 24) and 0xff)
  }

  private fun RandomAccessFile.writeShortLe(value: Int) {
    write(value and 0xff)
    write((value ushr 8) and 0xff)
  }

  data class TraceFiles(
    val wavFile: File,
    val metadataFile: File,
  )

  private data class ActiveTrace(
    val wavFile: File,
    val metadataFile: File,
    val wav: RandomAccessFile,
    var dataBytes: Long = 0,
    var chunks: Int = 0,
  )
}
