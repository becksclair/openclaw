package ai.openclaw.audio

import java.io.ByteArrayOutputStream

object PcmAudio {
  private const val BYTES_PER_SAMPLE = 2
  private const val PCMU_BIAS = 0x84
  private const val PCMU_CLIP = 32635

  fun readPcm16Sample(
    bytes: ByteArray,
    offset: Int,
  ): Int = ((bytes[offset].toInt() and 0xff) or (bytes[offset + 1].toInt() shl 8)).toShort().toInt()

  fun writePcm16Sample(
    bytes: ByteArray,
    offset: Int,
    sample: Int,
  ) {
    bytes[offset] = (sample and 0xff).toByte()
    bytes[offset + 1] = ((sample shr 8) and 0xff).toByte()
  }

  fun resamplePcm16ToMono(
    pcm: ByteArray,
    sampleRateHz: Int,
    channels: Int,
    targetSampleRateHz: Int,
  ): ByteArray {
    if (channels <= 0 || sampleRateHz <= 0 || targetSampleRateHz <= 0) {
      throw IllegalStateException("Invalid decoded audio format")
    }
    val evenSize = pcm.size - (pcm.size % BYTES_PER_SAMPLE)
    if (channels == 1 && sampleRateHz == targetSampleRateHz) return pcm.copyOf(evenSize)
    val inputFrames = evenSize / (BYTES_PER_SAMPLE * channels)
    if (inputFrames <= 0) return ByteArray(0)
    val mono = IntArray(inputFrames)
    for (frame in 0 until inputFrames) {
      var total = 0
      for (channel in 0 until channels) {
        total += readPcm16Sample(pcm, (frame * channels + channel) * BYTES_PER_SAMPLE)
      }
      mono[frame] = total / channels
    }
    val outputFrames = ((inputFrames.toLong() * targetSampleRateHz) / sampleRateHz).toInt().coerceAtLeast(1)
    val out = ByteArray(outputFrames * BYTES_PER_SAMPLE)
    for (frame in 0 until outputFrames) {
      val sourcePosition = frame.toDouble() * sampleRateHz.toDouble() / targetSampleRateHz.toDouble()
      val left = sourcePosition.toInt().coerceIn(0, inputFrames - 1)
      val right = (left + 1).coerceAtMost(inputFrames - 1)
      val fraction = sourcePosition - left
      val sample =
        (mono[left] + ((mono[right] - mono[left]) * fraction))
          .toInt()
          .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
      writePcm16Sample(out, frame * BYTES_PER_SAMPLE, sample)
    }
    return out
  }

  fun pcm16MonoFramesToPcmu(
    frames: List<ByteArray>,
    inputSampleRateHz: Int,
    targetSampleRateHz: Int,
  ): ByteArray {
    if (inputSampleRateHz <= 0 || targetSampleRateHz <= 0) {
      throw IllegalStateException("Invalid PCM sample rate")
    }
    val pcm = ByteArrayOutputStream()
    for (frame in frames) {
      if (frame.isNotEmpty()) pcm.write(frame)
    }
    val input = pcm.toByteArray()
    val inputSamples = input.size / BYTES_PER_SAMPLE
    val sampleRatio = (inputSampleRateHz / targetSampleRateHz).coerceAtLeast(1)
    val output = ByteArrayOutputStream(inputSamples / sampleRatio + 1)
    var sampleIndex = 0
    while (sampleIndex < inputSamples) {
      var total = 0
      var count = 0
      while (count < sampleRatio && sampleIndex < inputSamples) {
        total += readPcm16Sample(input, sampleIndex * BYTES_PER_SAMPLE)
        count++
        sampleIndex++
      }
      if (count > 0) {
        output.write(linear16ToPcmu(total / count).toInt())
      }
    }
    return output.toByteArray()
  }

  fun extractPcm16MonoWav(
    wav: ByteArray,
    expectedSampleRateHz: Int,
  ): ByteArray {
    if (wav.size < 44 || wav.ascii(0, 4) != "RIFF" || wav.ascii(8, 12) != "WAVE") {
      throw IllegalStateException("Invalid WAV audio")
    }
    var offset = 12
    var channels: Int? = null
    var sampleRate: Int? = null
    var bitsPerSample: Int? = null
    var dataStart = -1
    var dataSize = 0
    while (offset + 8 <= wav.size) {
      val chunkId = wav.ascii(offset, offset + 4)
      val chunkSize = readUInt32Le(wav, offset + 4)
      val chunkDataStart = offset + 8
      val chunkDataEnd = chunkDataStart + chunkSize
      if (chunkDataEnd > wav.size) break
      when (chunkId) {
        "fmt " -> {
          if (chunkSize < 16) throw IllegalStateException("Invalid WAV fmt chunk")
          val audioFormat = readUInt16Le(wav, chunkDataStart)
          channels = readUInt16Le(wav, chunkDataStart + 2)
          sampleRate = readUInt32Le(wav, chunkDataStart + 4)
          bitsPerSample = readUInt16Le(wav, chunkDataStart + 14)
          if (audioFormat != 1) {
            throw IllegalStateException("Compressed WAV audio is unsupported")
          }
        }
        "data" -> {
          dataStart = chunkDataStart
          dataSize = chunkSize
        }
      }
      offset = chunkDataEnd + (chunkSize and 1)
    }
    if (channels != 1 || sampleRate != expectedSampleRateHz || bitsPerSample != 16 || dataStart < 0) {
      throw IllegalStateException("WAV audio is not PCM16 mono $expectedSampleRateHz Hz")
    }
    val evenSize = dataSize - (dataSize % BYTES_PER_SAMPLE)
    return wav.copyOfRange(dataStart, dataStart + evenSize)
  }

  private fun linear16ToPcmu(sample: Int): Byte {
    var sign = 0
    var magnitude = sample
    if (magnitude < 0) {
      sign = 0x80
      magnitude = -magnitude
    }
    if (magnitude > PCMU_CLIP) {
      magnitude = PCMU_CLIP
    }
    magnitude += PCMU_BIAS

    var exponent = 7
    var mask = 0x4000
    while ((magnitude and mask) == 0 && exponent > 0) {
      exponent -= 1
      mask = mask shr 1
    }
    val mantissa = (magnitude shr (exponent + 3)) and 0x0f
    return (sign or (exponent shl 4) or mantissa).inv().toByte()
  }

  private fun readUInt16Le(
    bytes: ByteArray,
    offset: Int,
  ): Int = (bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8)

  private fun readUInt32Le(
    bytes: ByteArray,
    offset: Int,
  ): Int =
    (bytes[offset].toInt() and 0xff) or
      ((bytes[offset + 1].toInt() and 0xff) shl 8) or
      ((bytes[offset + 2].toInt() and 0xff) shl 16) or
      ((bytes[offset + 3].toInt() and 0xff) shl 24)

  private fun ByteArray.ascii(
    start: Int,
    end: Int,
  ): String = copyOfRange(start, end).toString(Charsets.US_ASCII)
}
