package ai.openclaw.wear.audio

import ai.openclaw.audio.AndroidCompressedAudioDecoder
import ai.openclaw.audio.PcmAudio

class CompressedAudioDecoder {
  internal companion object {
    fun readPcm16Sample(
      bytes: ByteArray,
      offset: Int,
    ): Int = PcmAudio.readPcm16Sample(bytes, offset)
  }

  data class DecodedPcm(
    val pcm48kMono: ByteArray,
    val sourceSampleRateHz: Int,
    val sourceChannels: Int,
  )

  suspend fun decodeToPcm48kMono(
    audioBytes: ByteArray,
    fileExtension: String,
    volumeGain: Double = 1.0,
  ): DecodedPcm {
    val decoded =
      AndroidCompressedAudioDecoder.decodeToPcmMono(
        audioBytes = audioBytes,
        fileExtension = fileExtension,
        targetSampleRateHz = AudioPlayer.PLAYBACK_SAMPLE_RATE,
        tempFilePrefix = "openclaw-watch-audio-",
        errorContext = "compressed debug audio",
      )
    return DecodedPcm(
      pcm48kMono = PcmAudio.applyPcm16VolumeGain(decoded.pcmMono, volumeGain),
      sourceSampleRateHz = decoded.sourceSampleRateHz,
      sourceChannels = decoded.sourceChannels,
    )
  }
}
