import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateDiscordRealtimeReply,
  type DiscordRealtimeVoiceEntry,
} from "./realtime-runtime.js";

const {
  createManagedRealtimeConversationRuntimeMock,
  appendTextMessagesToSessionTranscriptMock,
  writeDiscordVoicePcmWavFileMock,
} = vi.hoisted(() => ({
  createManagedRealtimeConversationRuntimeMock: vi.fn(() => {
    throw new Error("realtime unavailable");
  }),
  appendTextMessagesToSessionTranscriptMock: vi.fn(
    async (): Promise<
      { ok: true; sessionFile: string; messageIds: string[] } | { ok: false; reason: string }
    > => ({
      ok: true,
      sessionFile: "/tmp/session.jsonl",
      messageIds: ["msg-1", "msg-2"],
    }),
  ),
  writeDiscordVoicePcmWavFileMock: vi.fn(async () => ({
    path: "/tmp/realtime.wav",
    durationSeconds: 0.2,
  })),
}));

vi.mock("openclaw/plugin-sdk/gateway-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/gateway-runtime")>();
  return {
    ...actual,
    createManagedRealtimeConversationRuntime: createManagedRealtimeConversationRuntimeMock,
  };
});

vi.mock("openclaw/plugin-sdk/session-store-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/session-store-runtime")>();
  return {
    ...actual,
    appendTextMessagesToSessionTranscript: appendTextMessagesToSessionTranscriptMock,
  };
});

vi.mock("./audio-processing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./audio-processing.js")>();
  return {
    ...actual,
    writeDiscordVoicePcmWavFile: writeDiscordVoicePcmWavFileMock,
  };
});

type RuntimeTestEvent = { type: string; [key: string]: unknown };

function createRealtimeRuntimeMock(params: {
  close?: ReturnType<typeof vi.fn>;
  onSubmitAudio?: (emit: (event: RuntimeTestEvent) => void) => void | Promise<void>;
}) {
  let listener: ((event: RuntimeTestEvent) => void) | undefined;
  return {
    start: vi.fn(async () => undefined),
    close: params.close ?? vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    submitText: vi.fn(async () => undefined),
    submitAudio: vi.fn(async () => {
      await params.onSubmitAudio?.((event) => {
        listener?.(event);
      });
    }),
    subscribe: vi.fn((next: (event: RuntimeTestEvent) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    }),
    listTools: vi.fn(() => []),
  };
}

const buildRealtimeTranscriptIdempotencyKey = (turnId: string, role: "user" | "assistant") =>
  `discord-voice:discord:g1:1001:${turnId}:${role}`;

const createRealtimeVoiceEntry = (
  entryOverride: Partial<DiscordRealtimeVoiceEntry> = {},
): DiscordRealtimeVoiceEntry => ({
  guildId: "g1",
  channelId: "1001",
  route: { sessionKey: "discord:g1:1001", agentId: "agent-1" },
  voiceBackend: "realtime",
  realtimeDisabled: false,
  realtimeConnectedOnce: true,
  realtimeEpoch: 1,
  realtimeReplayHistory: [],
  ...entryOverride,
});

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
};

async function invokeGenerateRealtimeReply(
  entry: DiscordRealtimeVoiceEntry,
  params: { senderLabel?: string; senderIsOwner?: boolean } = {},
) {
  return await generateDiscordRealtimeReply({
    entry,
    cfg: {
      channels: { discord: { voice: { backend: "realtime" } } },
    },
    pcm: Buffer.alloc(1920),
    senderLabel: params.senderLabel ?? "u-guest",
    senderIsOwner: params.senderIsOwner ?? false,
    logger,
    logVerbose: vi.fn(),
    replyTimeoutMs: 60_000,
    firstOutputTimeoutMs: 12_000,
  });
}

describe("discord realtime runtime seam", () => {
  beforeEach(() => {
    createManagedRealtimeConversationRuntimeMock.mockReset();
    createManagedRealtimeConversationRuntimeMock.mockImplementation(() => {
      throw new Error("realtime unavailable");
    });
    appendTextMessagesToSessionTranscriptMock.mockReset();
    appendTextMessagesToSessionTranscriptMock.mockResolvedValue({
      ok: true,
      sessionFile: "/tmp/session.jsonl",
      messageIds: ["msg-1", "msg-2"],
    });
    writeDiscordVoicePcmWavFileMock.mockReset();
    writeDiscordVoicePcmWavFileMock.mockResolvedValue({
      path: "/tmp/realtime.wav",
      durationSeconds: 0.2,
    });
    logger.info.mockReset();
    logger.warn.mockReset();
  });

  it("persists completed realtime turns into the shared session transcript", async () => {
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          onSubmitAudio: async (emit) => {
            emit({
              type: "transcript.updated",
              item: { role: "user", status: "final", text: "hello there" },
            });
            emit({
              type: "transcript.updated",
              item: { role: "assistant", status: "final", text: "General Kenobi" },
            });
            emit({
              type: "assistant.turn.updated",
              turn: { state: "completed", turnId: "resp-1" },
            });
          },
        }) as never,
    );

    const entry = createRealtimeVoiceEntry();
    const result = await invokeGenerateRealtimeReply(entry);

    expect(result.text).toBe("General Kenobi");
    expect(appendTextMessagesToSessionTranscriptMock).toHaveBeenCalledWith({
      agentId: "agent-1",
      sessionKey: "discord:g1:1001",
      assistantModel: "realtime-voice",
      messages: [
        {
          role: "user",
          text: 'Voice transcript from speaker "u-guest":\nhello there',
          idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "user"),
        },
        {
          role: "assistant",
          text: "General Kenobi",
          idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "assistant"),
        },
      ],
    });
    expect(entry.realtimeReplayHistory).toEqual([]);
  });

  it("keeps realtime replay history when transcript persistence fails", async () => {
    appendTextMessagesToSessionTranscriptMock.mockResolvedValue({
      ok: false,
      reason: "disk sad",
    });
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          onSubmitAudio: async (emit) => {
            emit({
              type: "transcript.updated",
              item: { role: "user", status: "final", text: "hello there" },
            });
            emit({
              type: "transcript.updated",
              item: { role: "assistant", status: "final", text: "General Kenobi" },
            });
            emit({
              type: "assistant.turn.updated",
              turn: { state: "completed", turnId: "resp-1" },
            });
          },
        }) as never,
    );

    const entry = createRealtimeVoiceEntry();
    await invokeGenerateRealtimeReply(entry);

    expect(entry.realtimeReplayHistory).toEqual([
      {
        role: "user",
        text: 'Voice transcript from speaker "u-guest":\nhello there',
        idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "user"),
      },
      {
        role: "assistant",
        text: "General Kenobi",
        idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "assistant"),
      },
    ]);
  });

  it("reuses a stable local turn id when the provider never sends turnId", async () => {
    appendTextMessagesToSessionTranscriptMock.mockRejectedValue(new Error("boom"));
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          onSubmitAudio: async (emit) => {
            emit({
              type: "transcript.updated",
              item: { role: "user", status: "final", text: "hello there" },
            });
            emit({
              type: "transcript.updated",
              item: { role: "assistant", status: "final", text: "General Kenobi" },
            });
            emit({
              type: "assistant.turn.updated",
              turn: { state: "completed" },
            });
          },
        }) as never,
    );

    const entry = createRealtimeVoiceEntry();
    await invokeGenerateRealtimeReply(entry);

    expect(entry.realtimeReplayHistory).toHaveLength(2);
    const [userItem, assistantItem] = entry.realtimeReplayHistory;
    expect(userItem).toMatchObject({
      role: "user",
      text: 'Voice transcript from speaker "u-guest":\nhello there',
    });
    expect(assistantItem).toMatchObject({
      role: "assistant",
      text: "General Kenobi",
    });
    expect(userItem?.idempotencyKey).toMatch(/^discord-voice:discord:g1:1001:local-[^:]+:user$/);
    expect(assistantItem?.idempotencyKey).toMatch(
      /^discord-voice:discord:g1:1001:local-[^:]+:assistant$/,
    );
    expect(userItem?.idempotencyKey?.replace(/:user$/, "")).toBe(
      assistantItem?.idempotencyKey?.replace(/:assistant$/, ""),
    );
  });

  it("returns text-only when writing realtime audio output fails", async () => {
    writeDiscordVoicePcmWavFileMock.mockRejectedValue(new Error("disk sad"));
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          onSubmitAudio: async (emit) => {
            emit({
              type: "transcript.updated",
              item: { role: "assistant", status: "final", text: "General Kenobi" },
            });
            emit({
              type: "audio.output",
              audio: {
                itemId: "assistant-1",
                chunk: Buffer.from([0, 1, 2, 3]),
                sampleRate: 24000,
                mimeType: "audio/pcm;rate=24000",
              },
            });
            emit({
              type: "assistant.turn.updated",
              turn: { state: "completed", turnId: "resp-1" },
            });
          },
        }) as never,
    );

    const entry = createRealtimeVoiceEntry();
    const result = await invokeGenerateRealtimeReply(entry);

    expect(result).toEqual({ text: "General Kenobi" });
  });

  it("treats interrupted empty realtime turns as superseded", async () => {
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          onSubmitAudio: async (emit) => {
            emit({
              type: "assistant.turn.updated",
              turn: { state: "interrupted", turnId: "resp-1" },
            });
          },
        }) as never,
    );

    const entry = createRealtimeVoiceEntry();
    const result = await invokeGenerateRealtimeReply(entry);

    expect(result).toEqual({ text: "", superseded: true });
  });

  it("falls back when reconnect startup fails before any new output", async () => {
    createManagedRealtimeConversationRuntimeMock.mockImplementation(() => {
      throw new Error("realtime unavailable");
    });

    const entry = createRealtimeVoiceEntry({
      realtimeConnectedOnce: true,
      realtime: undefined,
      realtimeReady: undefined,
    });
    const result = await invokeGenerateRealtimeReply(entry);

    expect(result).toEqual({ text: "", fallbackToLegacy: false });
  });

  it("replays completed turns when a later glitch recreates the runtime", async () => {
    let recreatedOptions: Record<string, unknown> | undefined;
    let firstRuntimeListener: ((event: RuntimeTestEvent) => void) | undefined;
    let firstRuntimeSubmissions = 0;
    const firstRuntimeClose = vi.fn(async () => undefined);
    const firstRuntime = {
      start: vi.fn(async () => undefined),
      close: firstRuntimeClose,
      interrupt: vi.fn(async () => undefined),
      submitText: vi.fn(async () => undefined),
      submitAudio: vi.fn(async () => {
        firstRuntimeSubmissions += 1;
        if (firstRuntimeSubmissions === 1) {
          firstRuntimeListener?.({
            type: "transcript.updated",
            item: {
              role: "user",
              status: "final",
              text: "First question",
            },
          });
          firstRuntimeListener?.({
            type: "transcript.updated",
            item: {
              role: "assistant",
              status: "final",
              text: "First answer",
            },
          });
          firstRuntimeListener?.({
            type: "audio.output",
            audio: {
              itemId: "assistant-1",
              chunk: Buffer.from([0, 1, 2, 3]),
              sampleRate: 24000,
              mimeType: "audio/pcm;rate=24000",
            },
          });
          firstRuntimeListener?.({
            type: "assistant.turn.updated",
            turn: { state: "completed", turnId: "resp-1" },
          });
          return;
        }
        firstRuntimeListener?.({
          type: "session.error",
          code: "provider_failed",
          message: "socket boom",
        });
      }),
      subscribe: vi.fn((next: (event: RuntimeTestEvent) => void) => {
        firstRuntimeListener = next;
        return () => {
          firstRuntimeListener = undefined;
        };
      }),
      listTools: vi.fn(() => []),
    };

    let secondRuntimeListener: ((event: RuntimeTestEvent) => void) | undefined;
    const secondRuntime = {
      start: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      interrupt: vi.fn(async () => undefined),
      submitText: vi.fn(async () => undefined),
      submitAudio: vi.fn(async () => {
        secondRuntimeListener?.({
          type: "transcript.updated",
          item: {
            role: "assistant",
            status: "final",
            text: "Recovered answer",
          },
        });
        secondRuntimeListener?.({
          type: "audio.output",
          audio: {
            itemId: "assistant-2",
            chunk: Buffer.from([4, 5, 6, 7]),
            sampleRate: 24000,
            mimeType: "audio/pcm;rate=24000",
          },
        });
        secondRuntimeListener?.({
          type: "assistant.turn.updated",
          turn: { state: "completed", turnId: "resp-2" },
        });
      }),
      subscribe: vi.fn((next: (event: RuntimeTestEvent) => void) => {
        secondRuntimeListener = next;
        return () => {
          secondRuntimeListener = undefined;
        };
      }),
      listTools: vi.fn(() => []),
    };

    createManagedRealtimeConversationRuntimeMock
      .mockImplementationOnce(() => firstRuntime as never)
      .mockImplementationOnce(() => {
        recreatedOptions = (
          createManagedRealtimeConversationRuntimeMock.mock.calls as unknown as Array<
            [Record<string, unknown>]
          >
        )[1]?.[0];
        return secondRuntime as never;
      });

    const entry = createRealtimeVoiceEntry({
      realtimeConnectedOnce: false,
      realtimeEpoch: 1,
      realtimeReplayHistory: [],
    });
    appendTextMessagesToSessionTranscriptMock.mockResolvedValueOnce({
      ok: false,
      reason: "disk sad",
    });

    const firstResult = await invokeGenerateRealtimeReply(entry);
    expect(firstResult.text).toBe("First answer");
    expect(entry.realtimeReplayHistory).toEqual([
      {
        role: "user",
        text: 'Voice transcript from speaker "u-guest":\nFirst question',
        idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "user"),
      },
      {
        role: "assistant",
        text: "First answer",
        idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "assistant"),
      },
    ]);

    const secondResult = await invokeGenerateRealtimeReply(entry);
    expect(secondResult.fallbackToLegacy).toBe(true);
    expect(firstRuntimeClose).toHaveBeenCalledWith("session error");

    const thirdResult = await invokeGenerateRealtimeReply(entry);
    expect(recreatedOptions?.historyOverlay).toEqual([
      { role: "user", text: 'Voice transcript from speaker "u-guest":\nFirst question' },
      { role: "assistant", text: "First answer" },
    ]);
    expect(thirdResult.text).toBe("Recovered answer");
  });

  it("waits for post-tool continuation instead of falling back early", async () => {
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          onSubmitAudio: async (emit) => {
            emit({
              type: "tool.updated",
              update: {
                toolCallId: "call-1",
                toolName: "read",
                status: "running",
              },
            });
            emit({
              type: "assistant.turn.updated",
              turn: { state: "completed", turnId: "resp-1" },
            });
            queueMicrotask(() => {
              emit({
                type: "tool.updated",
                update: {
                  toolCallId: "call-1",
                  toolName: "read",
                  status: "completed",
                },
              });
              emit({
                type: "transcript.updated",
                item: {
                  role: "assistant",
                  status: "final",
                  text: "Tool continuation reply",
                  revision: 1,
                },
              });
              emit({
                type: "audio.output",
                audio: {
                  itemId: "assistant-1",
                  chunk: Buffer.from([1, 2, 3, 4]),
                  sampleRate: 24000,
                  mimeType: "audio/pcm;rate=24000",
                },
              });
              emit({
                type: "assistant.turn.updated",
                turn: { state: "completed", turnId: "resp-2" },
              });
            });
          },
        }) as never,
    );

    const entry = createRealtimeVoiceEntry();
    const result = await invokeGenerateRealtimeReply(entry);

    expect(result.fallbackToLegacy).not.toBe(true);
    expect(result.text).toBe("Tool continuation reply");
  });
});
