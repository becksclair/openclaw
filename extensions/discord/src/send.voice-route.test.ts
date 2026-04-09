import { ChannelType, Routes } from "discord-api-types/v10";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDiscordRest } from "./send.test-harness.js";

const loadWebMediaRawMock = vi.hoisted(() => vi.fn());
const ensureOggOpusMock = vi.hoisted(() => vi.fn());
const getVoiceMessageMetadataMock = vi.hoisted(() => vi.fn());
const sendDiscordVoiceMessageMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());
const unlinkMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/web-media", () => ({
  loadWebMediaRaw: (...args: unknown[]) => loadWebMediaRawMock(...args),
}));

vi.mock("./voice-message.js", () => ({
  ensureOggOpus: (...args: unknown[]) => ensureOggOpusMock(...args),
  getVoiceMessageMetadata: (...args: unknown[]) => getVoiceMessageMetadataMock(...args),
  sendDiscordVoiceMessage: (...args: unknown[]) => sendDiscordVoiceMessageMock(...args),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: (...args: unknown[]) => writeFileMock(...args),
    readFile: (...args: unknown[]) => readFileMock(...args),
    unlink: (...args: unknown[]) => unlinkMock(...args),
  },
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
  unlink: (...args: unknown[]) => unlinkMock(...args),
}));

vi.mock("openclaw/plugin-sdk/temp-path", () => ({
  resolvePreferredOpenClawTmpDir: () => "/tmp",
}));

let sendVoiceMessageDiscord: typeof import("./send.outbound.js").sendVoiceMessageDiscord;

describe("sendVoiceMessageDiscord", () => {
  beforeAll(async () => {
    ({ sendVoiceMessageDiscord } = await import("./send.outbound.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    loadWebMediaRawMock.mockResolvedValue({
      buffer: Buffer.from("voice-src"),
      fileName: "voice.mp3",
      contentType: "audio/mpeg",
      kind: "audio",
    });
    ensureOggOpusMock.mockResolvedValue({
      path: "/tmp/voice.ogg",
      cleanup: true,
    });
    getVoiceMessageMetadataMock.mockResolvedValue({
      durationSecs: 1.23,
      waveform: "abc",
    });
    sendDiscordVoiceMessageMock.mockResolvedValue({
      id: "voice-1",
      channel_id: "789",
    });
    writeFileMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(Buffer.from("encoded-ogg"));
    unlinkMock.mockResolvedValue(undefined);
  });

  it("loads voice media with outbound local-file access overrides", async () => {
    const { rest, getMock } = makeDiscordRest();
    getMock.mockResolvedValue({ type: ChannelType.GuildText });
    const mediaReadFile = vi.fn(async () => Buffer.from("voice"));

    await sendVoiceMessageDiscord("channel:789", "file:///tmp/voice.mp3", {
      rest,
      token: "t",
      mediaLocalRoots: ["/tmp/agent-root"],
      mediaReadFile,
    });

    expect(loadWebMediaRawMock).toHaveBeenCalledWith(
      "file:///tmp/voice.mp3",
      expect.objectContaining({
        maxBytes: expect.any(Number),
        localRoots: "any",
        readFile: mediaReadFile,
        hostReadCapability: true,
      }),
    );
  });

  it("creates a thread before sending voice bubbles to forum-like parents", async () => {
    const { rest, getMock, postMock } = makeDiscordRest();
    getMock.mockResolvedValue({ type: ChannelType.GuildForum });
    postMock.mockResolvedValue({ id: "thread-1" });
    sendDiscordVoiceMessageMock.mockResolvedValueOnce({
      id: "voice-1",
      channel_id: "thread-1",
    });

    const result = await sendVoiceMessageDiscord("channel:789", "https://example.com/voice.ogg", {
      rest,
      token: "t",
      threadStarterText: "Read this out loud",
    });

    expect(postMock).toHaveBeenCalledWith(
      Routes.threads("789"),
      expect.objectContaining({
        body: {
          name: "Read this out loud",
          message: {
            content: "Read this out loud",
          },
        },
      }),
    );
    expect(sendDiscordVoiceMessageMock).toHaveBeenCalledWith(
      rest,
      "thread-1",
      Buffer.from("encoded-ogg"),
      {
        durationSecs: 1.23,
        waveform: "abc",
      },
      undefined,
      expect.any(Function),
      undefined,
      "t",
    );
    expect(result).toEqual({
      messageId: "voice-1",
      channelId: "thread-1",
    });
  });
});
