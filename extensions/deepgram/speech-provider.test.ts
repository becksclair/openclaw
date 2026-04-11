import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDeepgramSpeechProvider } from "./speech-provider.js";

const originalFetch = globalThis.fetch;

describe("deepgram speech provider output format", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const provider = buildDeepgramSpeechProvider();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal(
      "fetch",
      fetchMock.mockResolvedValue(
        new Response(Buffer.from("audio-bytes"), {
          status: 200,
          headers: { "content-type": "audio/ogg" },
        }),
      ),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("defaults voice-note synthesis to opus artifacts", async () => {
    const result = await provider.synthesize({
      text: "Hello from Deepgram",
      cfg: {} as OpenClawConfig,
      providerConfig: {
        apiKey: "dg-key",
      },
      target: "voice-note",
      timeoutMs: 5_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.deepgram.com/v1/speak?model=aura-2-luna-en&encoding=opus",
    );
    expect(result).toMatchObject({
      outputFormat: "opus",
      fileExtension: ".opus",
      voiceCompatible: true,
    });
  });

  it("defaults audio-file synthesis to mp3 artifacts", async () => {
    const result = await provider.synthesize({
      text: "Hello from Deepgram",
      cfg: {} as OpenClawConfig,
      providerConfig: {
        apiKey: "dg-key",
      },
      target: "audio-file",
      timeoutMs: 5_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.deepgram.com/v1/speak?model=aura-2-luna-en&encoding=mp3",
    );
    expect(result).toMatchObject({
      outputFormat: "mp3",
      fileExtension: ".mp3",
      voiceCompatible: false,
    });
  });

  it("reflects a configured non-opus response format in the saved artifact metadata", async () => {
    const result = await provider.synthesize({
      text: "Hello from Deepgram",
      cfg: {} as OpenClawConfig,
      providerConfig: {
        apiKey: "dg-key",
        responseFormat: "wav",
      },
      target: "voice-note",
      timeoutMs: 5_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.deepgram.com/v1/speak?model=aura-2-luna-en&encoding=wav",
    );
    expect(result).toMatchObject({
      outputFormat: "wav",
      fileExtension: ".wav",
      voiceCompatible: false,
    });
  });
});
