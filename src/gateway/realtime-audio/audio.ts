export const REALTIME_AUDIO_SAMPLE_RATE = 24_000;

export function convertInterleavedPcm16ToMono24k(params: {
  pcm: Buffer;
  inputSampleRate: number;
  channels: number;
}): Buffer {
  const mono = params.channels === 1 ? params.pcm : downmixToMono(params.pcm, params.channels);
  return params.inputSampleRate === REALTIME_AUDIO_SAMPLE_RATE
    ? mono
    : resamplePcm16Mono(mono, params.inputSampleRate, REALTIME_AUDIO_SAMPLE_RATE);
}

function downmixToMono(input: Buffer, channels: number): Buffer {
  if (channels <= 1) {
    return input;
  }
  const frameCount = Math.floor(input.length / (channels * 2));
  const output = Buffer.alloc(frameCount * 2);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += input.readInt16LE((frame * channels + channel) * 2);
    }
    output.writeInt16LE(clamp16(Math.round(sum / channels)), frame * 2);
  }
  return output;
}

function resamplePcm16Mono(input: Buffer, inputRate: number, outputRate: number): Buffer {
  if (inputRate === outputRate) {
    return input;
  }
  const inputSamples = Math.floor(input.length / 2);
  if (inputSamples === 0) {
    return Buffer.alloc(0);
  }
  const ratio = inputRate / outputRate;
  const outputSamples = Math.max(1, Math.floor(inputSamples / ratio));
  const output = Buffer.alloc(outputSamples * 2);
  for (let i = 0; i < outputSamples; i += 1) {
    const src = i * ratio;
    const low = Math.floor(src);
    const high = Math.min(inputSamples - 1, low + 1);
    const fraction = src - low;
    const lowSample = input.readInt16LE(low * 2);
    const highSample = input.readInt16LE(high * 2);
    const sample = Math.round(lowSample + (highSample - lowSample) * fraction);
    output.writeInt16LE(clamp16(sample), i * 2);
  }
  return output;
}

function clamp16(value: number): number {
  return Math.max(-32768, Math.min(32767, value));
}
