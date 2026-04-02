import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTtsSpeaking, speakText, stopTts } from "./speech.ts";

const audioInstances: MockAudio[] = [];
const createObjectURL = vi.fn(() => "blob:test-audio");
const revokeObjectURL = vi.fn();

class MockAudio extends EventTarget {
  paused = true;
  ended = false;
  src: string;

  constructor(src = "") {
    super();
    this.src = src;
    audioInstances.push(this);
  }

  async play() {
    this.paused = false;
    this.ended = false;
  }

  pause() {
    this.paused = true;
  }

  load() {}

  emitEnded() {
    this.paused = true;
    this.ended = true;
    this.dispatchEvent(new Event("ended"));
  }
}

describe("chat speech", () => {
  beforeEach(() => {
    audioInstances.length = 0;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal("Audio", MockAudio as unknown as typeof Audio);
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
  });

  afterEach(() => {
    stopTts();
    vi.unstubAllGlobals();
  });

  it("uses talk.speak and plays returned audio", async () => {
    const request = vi.fn().mockResolvedValue({
      audioBase64: Buffer.from("abc").toString("base64"),
      mimeType: "audio/ogg",
    });
    const onStart = vi.fn();
    const onEnd = vi.fn();

    const started = await speakText(
      "Hello **there**",
      { request },
      {
        onStart,
        onEnd,
      },
    );

    expect(started).toBe(true);
    expect(request).toHaveBeenCalledWith("talk.speak", { text: "Hello there" });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(onStart).toHaveBeenCalledOnce();
    expect(audioInstances).toHaveLength(1);
    expect(isTtsSpeaking()).toBe(true);

    audioInstances[0]?.emitEnded();

    expect(onEnd).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-audio");
    expect(isTtsSpeaking()).toBe(false);
  });

  it("surfaces gateway request errors and does not start playback", async () => {
    const request = vi.fn().mockRejectedValue(new Error("talk offline"));
    const onError = vi.fn();

    const started = await speakText("Hello", { request }, { onError });

    expect(started).toBe(false);
    expect(onError).toHaveBeenCalledWith("talk offline");
    expect(audioInstances).toHaveLength(0);
    expect(isTtsSpeaking()).toBe(false);
  });
});
