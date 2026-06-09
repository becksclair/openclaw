package ai.openclaw.audio

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

object AndroidCompressedAudioDecoder {
  data class DecodedPcm(
    val pcmMono: ByteArray,
    val sourceSampleRateHz: Int,
    val sourceChannels: Int,
  )

  suspend fun decodeToPcmMono(
    audioBytes: ByteArray,
    fileExtension: String,
    targetSampleRateHz: Int,
    tempFilePrefix: String = "openclaw-audio-",
    errorContext: String = "compressed audio",
  ): DecodedPcm =
    withContext(Dispatchers.IO) {
      val suffix = fileExtension.takeIf { it.startsWith(".") } ?: ".$fileExtension"
      val tempFile = File.createTempFile(tempFilePrefix, suffix)
      try {
        tempFile.writeBytes(audioBytes)
        decodeFileToPcmMono(tempFile, targetSampleRateHz, errorContext)
      } finally {
        tempFile.delete()
      }
    }

  private suspend fun decodeFileToPcmMono(
    file: File,
    targetSampleRateHz: Int,
    errorContext: String,
  ): DecodedPcm {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(file.absolutePath)
      val trackIndex =
        (0 until extractor.trackCount).firstOrNull { index ->
          extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: throw IllegalStateException("$errorContext has no audio track")
      extractor.selectTrack(trackIndex)
      val inputFormat = extractor.getTrackFormat(trackIndex)
      val mime = inputFormat.getString(MediaFormat.KEY_MIME) ?: throw IllegalStateException("$errorContext has no MIME type")
      codec = MediaCodec.createDecoderByType(mime)
      codec.configure(inputFormat, null, null, 0)
      codec.start()

      val info = MediaCodec.BufferInfo()
      val decoded = ByteArrayOutputStream()
      var inputDone = false
      var outputDone = false
      var outputSampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var outputChannels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

      while (!outputDone) {
        if (!inputDone) {
          val inputIndex = codec.dequeueInputBuffer(10_000)
          if (inputIndex >= 0) {
            val inputBuffer = codec.getInputBuffer(inputIndex) ?: throw IllegalStateException("Audio decoder input buffer unavailable")
            inputBuffer.clear()
            val sampleSize = extractor.readSampleData(inputBuffer, 0)
            if (sampleSize < 0) {
              codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(inputIndex, 0, sampleSize, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }

        when (val outputIndex = codec.dequeueOutputBuffer(info, 10_000)) {
          MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
          MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val outputFormat = codec.outputFormat
            outputSampleRate = outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            outputChannels = outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val pcmEncoding =
              if (outputFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                outputFormat.getInteger(MediaFormat.KEY_PCM_ENCODING)
              } else {
                AudioFormat.ENCODING_PCM_16BIT
              }
            if (pcmEncoding != AudioFormat.ENCODING_PCM_16BIT) {
              throw IllegalStateException("$errorContext decoded to unsupported PCM encoding")
            }
          }
          else -> {
            if (outputIndex >= 0) {
              val outputBuffer = codec.getOutputBuffer(outputIndex) ?: throw IllegalStateException("Audio decoder output buffer unavailable")
              if (info.size > 0) {
                outputBuffer.position(info.offset)
                outputBuffer.limit(info.offset + info.size)
                val chunk = ByteArray(info.size)
                outputBuffer.get(chunk)
                decoded.write(chunk)
              }
              outputDone = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
              codec.releaseOutputBuffer(outputIndex, false)
            }
          }
        }
      }
      return withContext(Dispatchers.Default) {
        DecodedPcm(
          pcmMono = PcmAudio.resamplePcm16ToMono(decoded.toByteArray(), outputSampleRate, outputChannels, targetSampleRateHz),
          sourceSampleRateHz = outputSampleRate,
          sourceChannels = outputChannels,
        )
      }
    } finally {
      runCatching { codec?.stop() }
      codec?.release()
      extractor.release()
    }
  }
}
