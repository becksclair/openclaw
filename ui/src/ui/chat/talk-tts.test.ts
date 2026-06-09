import { afterEach, describe, expect, it, vi } from "vitest";
import { speakText, stopTts, type SpeechGatewayClient } from "./talk-tts.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("speakText", () => {
  afterEach(() => {
    stopTts();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not start playback from stale talk.speak responses", async () => {
    const audioInstances: Array<{ play: ReturnType<typeof vi.fn>; pause: () => void }> = [];
    class FakeAudio {
      paused = true;
      ended = false;
      src = "";
      play = vi.fn(async () => {
        this.paused = false;
      });
      pause() {
        this.paused = true;
      }
      load() {}
      addEventListener() {}
    }

    vi.stubGlobal(
      "Audio",
      class extends FakeAudio {
        constructor(src: string) {
          super();
          this.src = src;
          audioInstances.push(this);
        }
      },
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:audio"),
      revokeObjectURL: vi.fn(),
    });

    const requests: Array<ReturnType<typeof deferred<{ audioBase64: string }>>> = [];
    const request: SpeechGatewayClient["request"] = <T = unknown>() => {
      const next = deferred<{ audioBase64: string }>();
      requests.push(next);
      return next.promise as Promise<T>;
    };
    const client: SpeechGatewayClient = { request };
    const staleStart = vi.fn();
    const currentStart = vi.fn();

    const stale = speakText("first", client, { onStart: staleStart });
    await Promise.resolve();
    const current = speakText("second", client, { onStart: currentStart });
    await Promise.resolve();

    requests[0]?.resolve({ audioBase64: "AA==" });
    await expect(stale).resolves.toBe(false);
    expect(staleStart).not.toHaveBeenCalled();

    requests[1]?.resolve({ audioBase64: "AA==" });
    await expect(current).resolves.toBe(true);
    expect(currentStart).toHaveBeenCalledTimes(1);
    expect(audioInstances).toHaveLength(1);
    expect(requests).toHaveLength(2);
  });

  it("strips markup before calling Gateway Talk", async () => {
    vi.stubGlobal(
      "Audio",
      class {
        paused = true;
        ended = false;
        src = "";
        constructor(src: string) {
          this.src = src;
        }
        play = vi.fn(async () => {
          this.paused = false;
        });
        pause() {}
        load() {}
        addEventListener() {}
      },
    );
    const createObjectUrl = vi.fn(() => "blob:audio");
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: vi.fn(),
    });

    const request = vi.fn(async <T = unknown>() => ({ audioBase64: "AA==" }) as T);
    const client: SpeechGatewayClient = { request: request as SpeechGatewayClient["request"] };

    await expect(speakText("**Hello** [docs](https://example.com)", client)).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith("talk.speak", { text: "Hello docs" });
  });

  it("rejects invalid talk.speak responses before playback", async () => {
    const onError = vi.fn();
    vi.stubGlobal(
      "Audio",
      class {
        paused = true;
        ended = false;
        play = vi.fn(async () => {});
        pause() {}
        load() {}
        addEventListener() {}
      },
    );
    const createObjectUrl = vi.fn(() => "blob:audio");
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: vi.fn(),
    });

    const request: SpeechGatewayClient["request"] = async <T = unknown>() =>
      ({ audioBase64: "" }) as T;
    const client: SpeechGatewayClient = { request };

    await expect(speakText("hello", client, { onError })).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith("Talk returned no audio");
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("uses a resumed AudioContext path when available", async () => {
    const resume = vi.fn(async () => {});
    const decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);
    const start = vi.fn();
    const source = {
      buffer: null as AudioBuffer | null,
      addEventListener: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      start,
      stop: vi.fn(),
    } as unknown as AudioBufferSourceNode;
    const createBufferSource = vi.fn(() => source);
    vi.stubGlobal(
      "AudioContext",
      class {
        state: AudioContextState = "suspended";
        destination = {} as AudioDestinationNode;
        resume = resume;
        decodeAudioData = decodeAudioData;
        createBufferSource = createBufferSource;
      },
    );
    function ThrowingAudio() {
      throw new Error("HTMLAudio fallback should not be used");
    }
    vi.stubGlobal("Audio", ThrowingAudio);

    const request = vi.fn(async <T = unknown>() => ({ audioBase64: "AA==" }) as T);
    const client: SpeechGatewayClient = { request: request as SpeechGatewayClient["request"] };

    await expect(speakText("hello", client)).resolves.toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(createBufferSource).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("talk.speak", { text: "hello" });
  });
});
