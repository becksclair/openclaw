import { describe, expect, it } from "vitest";
import { REALTIME_AUDIO_SAMPLE_RATE, convertInterleavedPcm16ToMono24k } from "./audio.js";

function pcm16(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => {
    buffer.writeInt16LE(value, index * 2);
  });
  return buffer;
}

function readPcm16(buffer: Buffer): number[] {
  return Array.from({ length: Math.floor(buffer.length / 2) }, (_, index) =>
    buffer.readInt16LE(index * 2),
  );
}

describe("convertInterleavedPcm16ToMono24k", () => {
  it("downmixes stereo pcm to mono when already at 24kHz", () => {
    const input = pcm16([1000, -1000, 2000, 2000, -3000, 1000]);

    const result = convertInterleavedPcm16ToMono24k({
      pcm: input,
      inputSampleRate: REALTIME_AUDIO_SAMPLE_RATE,
      channels: 2,
    });

    expect(readPcm16(result)).toEqual([0, 2000, -1000]);
  });

  it("downsamples 48kHz mono pcm to 24kHz mono pcm", () => {
    const input = pcm16([1000, 2000, 3000, 4000]);

    const result = convertInterleavedPcm16ToMono24k({
      pcm: input,
      inputSampleRate: 48000,
      channels: 1,
    });

    expect(readPcm16(result)).toEqual([1000, 3000]);
  });

  it("downmixes and downsamples stereo 48kHz transport audio for realtime providers", () => {
    const input = pcm16([1000, 3000, 2000, 4000, 3000, 5000, 4000, 6000]);

    const result = convertInterleavedPcm16ToMono24k({
      pcm: input,
      inputSampleRate: 48000,
      channels: 2,
    });

    expect(readPcm16(result)).toEqual([2000, 4000]);
  });
});
