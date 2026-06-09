function clamp16(value: number): number {
  return Math.max(-32768, Math.min(32767, value));
}

function mulawToLinear(value: number): number {
  const muLaw = ~value & 0xff;
  const sign = muLaw & 0x80;
  const exponent = (muLaw >> 4) & 0x07;
  const mantissa = muLaw & 0x0f;
  let sample = ((mantissa << 3) + 132) << exponent;
  sample -= 132;
  return sign ? -sample : sample;
}

function mulawToPcm(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i += 1) {
    pcm.writeInt16LE(clamp16(mulawToLinear(mulaw[i])), i * 2);
  }
  return pcm;
}

function buildPcm16MonoWav(params: { pcm: Buffer; sampleRateHz: number }): Buffer {
  const evenPcm =
    params.pcm.byteLength % 2 === 0
      ? params.pcm
      : params.pcm.subarray(0, params.pcm.byteLength - 1);
  const wav = Buffer.alloc(44 + evenPcm.byteLength);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + evenPcm.byteLength, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(params.sampleRateHz, 24);
  wav.writeUInt32LE(params.sampleRateHz * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(evenPcm.byteLength, 40);
  evenPcm.copy(wav, 44);
  return wav;
}

export function buildTranscriptionWavAudio(params: {
  mulawAudio: Buffer;
  sampleRateHz: number;
}): Buffer {
  // This is a tight O(n) integer loop (μ-law decode + WAV header).
  // A worker thread costs more in spawn/terminate/structuredClone overhead
  // than the actual CPU work, so we run it on the main event loop.
  // If this ever becomes a heavier codec, revisit a singleton worker pool.
  return buildPcm16MonoWav({
    pcm: mulawToPcm(params.mulawAudio),
    sampleRateHz: params.sampleRateHz,
  });
}
