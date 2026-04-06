import { describe, expect, it } from "vitest";
import { validateVoiceTranscribeParams, validateVoiceTranscribeResult } from "./index.js";

describe("voice protocol validators", () => {
  it("accepts valid voice.transcribe params and result payloads", () => {
    expect(
      validateVoiceTranscribeParams({
        audioBase64: Buffer.from([0, 1, 2, 3]).toString("base64"),
        sampleRate: 16_000,
        channels: 1,
        format: "pcm16",
      }),
    ).toBe(true);

    expect(
      validateVoiceTranscribeResult({
        transcript: "open the latest PR comments",
        durationMs: 1820,
      }),
    ).toBe(true);
  });

  it("rejects empty audio and invalid PCM metadata", () => {
    expect(
      validateVoiceTranscribeParams({
        audioBase64: "",
        sampleRate: 16_000,
        channels: 1,
      }),
    ).toBe(false);

    expect(
      validateVoiceTranscribeParams({
        audioBase64: Buffer.from([0, 1]).toString("base64"),
        sampleRate: 0,
        channels: 1,
      }),
    ).toBe(false);

    expect(
      validateVoiceTranscribeParams({
        audioBase64: Buffer.from([0, 1]).toString("base64"),
        sampleRate: 16_000,
        channels: 0,
      }),
    ).toBe(false);
  });
});
