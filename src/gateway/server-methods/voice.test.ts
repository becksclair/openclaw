import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { voiceHandlers } from "./voice.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn<() => OpenClawConfig>(),
  resolveDefaultAgentId: vi.fn(() => "main"),
  resolveAgentDir: vi.fn(() => "/tmp/agent-main"),
  transcribeAudioFile: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
}));

vi.mock("openclaw/plugin-sdk/agent-runtime", () => ({
  resolveAgentDir: mocks.resolveAgentDir,
}));

vi.mock("openclaw/plugin-sdk/media-understanding-runtime", () => ({
  transcribeAudioFile: mocks.transcribeAudioFile,
}));

describe("voice.transcribe handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({} as OpenClawConfig);
  });

  it("transcribes PCM turns through the media understanding runtime", async () => {
    mocks.transcribeAudioFile.mockResolvedValue({ text: "open the latest PR comments" });
    const respond = vi.fn();
    const pcm = Buffer.from([0, 0, 1, 0, 2, 0, 3, 0]);

    await voiceHandlers["voice.transcribe"]({
      req: { type: "req", id: "1", method: "voice.transcribe" },
      params: {
        audioBase64: pcm.toString("base64"),
        sampleRate: 16_000,
        channels: 1,
        format: "pcm16",
      },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(mocks.resolveDefaultAgentId).toHaveBeenCalled();
    expect(mocks.resolveAgentDir).toHaveBeenCalledWith({}, "main");
    expect(mocks.transcribeAudioFile).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: {},
        agentDir: "/tmp/agent-main",
        mime: "audio/wav",
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        transcript: "open the latest PR comments",
        durationMs: 0,
      },
      undefined,
    );
  });

  it("rejects empty audio payloads", async () => {
    const respond = vi.fn();

    await voiceHandlers["voice.transcribe"]({
      req: { type: "req", id: "2", method: "voice.transcribe" },
      params: {
        audioBase64: "",
        sampleRate: 16_000,
        channels: 1,
      },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(respond.mock.calls[0]?.[2]).toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("fails deterministically when transcription returns no text", async () => {
    mocks.transcribeAudioFile.mockResolvedValue({ text: "   " });
    const respond = vi.fn();

    await voiceHandlers["voice.transcribe"]({
      req: { type: "req", id: "3", method: "voice.transcribe" },
      params: {
        audioBase64: Buffer.from([0, 1]).toString("base64"),
        sampleRate: 16_000,
        channels: 1,
      },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(respond.mock.calls[0]?.[2]).toMatchObject({
      code: "UNAVAILABLE",
      message: "voice.transcribe returned no transcript",
    });
  });
});
