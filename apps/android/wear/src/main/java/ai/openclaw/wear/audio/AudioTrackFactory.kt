package ai.openclaw.wear.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack

internal class AudioTrackFactory(
  private val sampleRateHz: Int,
) {
  fun minBufferSize(): Int =
    AudioTrack.getMinBufferSize(
      sampleRateHz,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )

  fun create(bufferSizeBytes: Int): AudioTrack =
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
      .setBufferSizeInBytes(bufferSizeBytes)
      .build()
}
