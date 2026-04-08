import { ChannelType } from "@buape/carbon";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceCaptureState } from "./capture-state.js";

const {
  createConnectionMock,
  joinVoiceChannelMock,
  entersStateMock,
  createAudioPlayerMock,
  resolveAgentRouteMock,
  agentCommandMock,
  transcribeAudioFileMock,
  textToSpeechMock,
  createManagedRealtimeConversationRuntimeMock,
  appendTextMessagesToSessionTranscriptMock,
  discordRuntimeMock,
} = vi.hoisted(() => {
  type EventHandler = (...args: unknown[]) => unknown;
  type MockConnection = {
    destroy: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    receiver: {
      speaking: {
        on: ReturnType<typeof vi.fn>;
        off: ReturnType<typeof vi.fn>;
      };
      subscribe: ReturnType<typeof vi.fn>;
    };
    state: {
      status: string;
      networking: {
        state: {
          code: string;
          dave: {
            session: {
              setPassthroughMode: ReturnType<typeof vi.fn>;
            };
          };
        };
      };
    };
    handlers: Map<string, EventHandler>;
  };

  const appendTextMessagesToSessionTranscriptMock = vi.fn(
    async (): Promise<
      { ok: true; sessionFile: string; messageIds: string[] } | { ok: false; reason: string }
    > => ({
      ok: true,
      sessionFile: "/tmp/session.jsonl",
      messageIds: ["msg-1", "msg-2"],
    }),
  );

  const createConnectionMock = (): MockConnection => {
    const handlers = new Map<string, EventHandler>();
    const connection: MockConnection = {
      destroy: vi.fn(),
      subscribe: vi.fn(),
      on: vi.fn((event: string, handler: EventHandler) => {
        handlers.set(event, handler);
      }),
      off: vi.fn(),
      receiver: {
        speaking: {
          on: vi.fn(),
          off: vi.fn(),
        },
        subscribe: vi.fn(() => ({
          on: vi.fn(),
          destroy: vi.fn(),
          [Symbol.asyncIterator]: async function* () {},
        })),
      },
      state: {
        status: "ready",
        networking: {
          state: {
            code: "networking-ready",
            dave: {
              session: {
                setPassthroughMode: vi.fn(),
              },
            },
          },
        },
      },
      handlers,
    };
    return connection;
  };

  const transcribeAudioFileMock = vi.fn(async () => ({ text: "hello from voice" }));
  const textToSpeechMock = vi.fn(async () => ({ success: true, audioPath: "/tmp/reply.wav" }));
  const discordRuntimeMock = {
    mediaUnderstanding: {
      transcribeAudioFile: transcribeAudioFileMock,
    },
    tts: {
      textToSpeech: textToSpeechMock,
    },
  };

  return {
    createConnectionMock,
    joinVoiceChannelMock: vi.fn(() => createConnectionMock()),
    entersStateMock: vi.fn(async (_target?: unknown, _state?: string, _timeoutMs?: number) => {
      return undefined;
    }),
    createAudioPlayerMock: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
      stop: vi.fn(),
      play: vi.fn(),
      state: { status: "idle" },
    })),
    resolveAgentRouteMock: vi.fn(() => ({ agentId: "agent-1", sessionKey: "discord:g1:c1" })),
    agentCommandMock: vi.fn(async (_opts?: unknown, _runtime?: unknown) => ({ payloads: [] })),
    transcribeAudioFileMock,
    textToSpeechMock,
    createManagedRealtimeConversationRuntimeMock: vi.fn(() => {
      throw new Error("realtime unavailable");
    }),
    appendTextMessagesToSessionTranscriptMock,
    discordRuntimeMock,
  };
});

vi.mock("./sdk-runtime.js", () => ({
  loadDiscordVoiceSdk: () => ({
    AudioPlayerStatus: { Playing: "playing", Idle: "idle" },
    EndBehaviorType: { AfterSilence: "AfterSilence", Manual: "Manual" },
    VoiceConnectionStatus: {
      Ready: "ready",
      Disconnected: "disconnected",
      Destroyed: "destroyed",
      Signalling: "signalling",
      Connecting: "connecting",
    },
    NetworkingStatusCode: {
      Ready: "networking-ready",
      Resuming: "networking-resuming",
    },
    createAudioPlayer: createAudioPlayerMock,
    createAudioResource: vi.fn(),
    entersState: entersStateMock,
    joinVoiceChannel: joinVoiceChannelMock,
  }),
}));

vi.mock("openclaw/plugin-sdk/routing", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/routing")>(
    "openclaw/plugin-sdk/routing",
  );
  return {
    ...actual,
    resolveAgentRoute: resolveAgentRouteMock,
  };
});

vi.mock("openclaw/plugin-sdk/agent-runtime", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/agent-runtime")>(
    "openclaw/plugin-sdk/agent-runtime",
  );
  return {
    ...actual,
    agentCommandFromIngress: agentCommandMock,
  };
});

vi.mock("openclaw/plugin-sdk/session-store-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/session-store-runtime")>();
  return {
    ...actual,
    appendTextMessagesToSessionTranscript: appendTextMessagesToSessionTranscriptMock,
  };
});

vi.mock("../runtime.js", () => ({
  getDiscordRuntime: () => discordRuntimeMock,
}));

vi.mock("openclaw/plugin-sdk/gateway-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/gateway-runtime")>();
  return {
    ...actual,
    createManagedRealtimeConversationRuntime: createManagedRealtimeConversationRuntimeMock,
  };
});

let managerModule: typeof import("./manager.js");

function createClient() {
  return {
    fetchChannel: vi.fn(async (channelId: string) => ({
      id: channelId,
      guildId: "g1",
      guild: { id: "g1", name: "Guild One" },
      type: ChannelType.GuildVoice,
    })),
    fetchGuild: vi.fn(async (guildId: string) => ({
      id: guildId,
      name: "Guild One",
    })),
    getPlugin: vi.fn(() => ({
      getGatewayAdapterCreator: vi.fn(() => vi.fn()),
    })),
    fetchMember: vi.fn(),
    fetchUser: vi.fn(),
  };
}

function createRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

describe("DiscordVoiceManager", () => {
  beforeAll(async () => {
    managerModule = await import("./manager.js");
  });

  beforeEach(() => {
    joinVoiceChannelMock.mockReset();
    joinVoiceChannelMock.mockImplementation(() => createConnectionMock());
    entersStateMock.mockReset();
    entersStateMock.mockResolvedValue(undefined);
    createAudioPlayerMock.mockClear();
    resolveAgentRouteMock.mockClear();
    agentCommandMock.mockReset();
    agentCommandMock.mockResolvedValue({ payloads: [] });
    transcribeAudioFileMock.mockReset();
    transcribeAudioFileMock.mockResolvedValue({ text: "hello from voice" });
    textToSpeechMock.mockReset();
    textToSpeechMock.mockResolvedValue({ success: true, audioPath: "/tmp/reply.wav" });
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
  });

  const createManager = (
    discordConfig: ConstructorParameters<
      typeof managerModule.DiscordVoiceManager
    >[0]["discordConfig"] = {},
    clientOverride?: ReturnType<typeof createClient>,
    cfgOverride: ConstructorParameters<typeof managerModule.DiscordVoiceManager>[0]["cfg"] = {},
  ) =>
    new managerModule.DiscordVoiceManager({
      client: (clientOverride ?? createClient()) as never,
      cfg: cfgOverride,
      discordConfig,
      accountId: "default",
      runtime: createRuntime(),
    });

  const expectConnectedStatus = (
    manager: InstanceType<typeof managerModule.DiscordVoiceManager>,
    channelId: string,
  ) => {
    expect(manager.status()).toEqual([
      {
        ok: true,
        message: `connected: guild g1 channel ${channelId}`,
        guildId: "g1",
        channelId,
      },
    ]);
  };

  const emitDecryptFailure = (manager: InstanceType<typeof managerModule.DiscordVoiceManager>) => {
    const entry = (manager as unknown as { sessions: Map<string, unknown> }).sessions.get("g1");
    expect(entry).toBeDefined();
    (
      manager as unknown as { handleReceiveError: (e: unknown, err: unknown) => void }
    ).handleReceiveError(
      entry,
      new Error("Failed to decrypt: DecryptionFailed(UnencryptedWhenPassthroughDisabled)"),
    );
  };

  type ProcessSegmentInvoker = {
    processSegment: (params: {
      entry: unknown;
      wavPath: string;
      pcm: Buffer;
      userId: string;
      durationSeconds: number;
    }) => Promise<void>;
  };

  const processVoiceSegment = async (
    manager: InstanceType<typeof managerModule.DiscordVoiceManager>,
    userId: string,
    entryOverride?: Record<string, unknown>,
  ) =>
    await (manager as unknown as ProcessSegmentInvoker).processSegment({
      entry: {
        guildId: "g1",
        channelId: "1001",
        route: { sessionKey: "discord:g1:1001", agentId: "agent-1" },
        player: createAudioPlayerMock(),
        playbackQueue: Promise.resolve(),
        realtimeDisabled: false,
        realtimeConnectedOnce: false,
        realtimeEpoch: 0,
        ...entryOverride,
      },
      wavPath: "/tmp/test.wav",
      pcm: Buffer.alloc(1920),
      userId,
      durationSeconds: 1.2,
    });

  it("keeps the new session when an old disconnected handler fires", async () => {
    const oldConnection = createConnectionMock();
    const newConnection = createConnectionMock();
    joinVoiceChannelMock.mockReturnValueOnce(oldConnection).mockReturnValueOnce(newConnection);
    entersStateMock.mockImplementation(async (target: unknown, status?: string) => {
      if (target === oldConnection && (status === "signalling" || status === "connecting")) {
        throw new Error("old disconnected");
      }
      return undefined;
    });

    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });
    await manager.join({ guildId: "g1", channelId: "1002" });

    const oldDisconnected = oldConnection.handlers.get("disconnected");
    expect(oldDisconnected).toBeTypeOf("function");
    await oldDisconnected?.();

    expectConnectedStatus(manager, "1002");
  });

  it("keeps the new session when an old destroyed handler fires", async () => {
    const oldConnection = createConnectionMock();
    const newConnection = createConnectionMock();
    joinVoiceChannelMock.mockReturnValueOnce(oldConnection).mockReturnValueOnce(newConnection);

    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });
    await manager.join({ guildId: "g1", channelId: "1002" });

    const oldDestroyed = oldConnection.handlers.get("destroyed");
    expect(oldDestroyed).toBeTypeOf("function");
    oldDestroyed?.();

    expectConnectedStatus(manager, "1002");
  });

  it("removes voice listeners on leave", async () => {
    const connection = createConnectionMock();
    joinVoiceChannelMock.mockReturnValueOnce(connection);
    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });
    await manager.leave({ guildId: "g1" });

    const player = createAudioPlayerMock.mock.results[0]?.value;
    expect(connection.receiver.speaking.off).toHaveBeenCalledWith("start", expect.any(Function));
    expect(connection.receiver.speaking.off).toHaveBeenCalledWith("end", expect.any(Function));
    expect(connection.off).toHaveBeenCalledWith("disconnected", expect.any(Function));
    expect(connection.off).toHaveBeenCalledWith("destroyed", expect.any(Function));
    expect(player.off).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("passes DAVE options to joinVoiceChannel", async () => {
    const manager = createManager({
      voice: {
        daveEncryption: false,
        decryptionFailureTolerance: 8,
      },
    });

    await manager.join({ guildId: "g1", channelId: "1001" });

    expect(joinVoiceChannelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        daveEncryption: false,
        decryptionFailureTolerance: 8,
      }),
    );
  });

  it("keeps the shorter timeout for initial voice connection readiness", async () => {
    const connection = createConnectionMock();
    joinVoiceChannelMock.mockReturnValueOnce(connection);
    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });

    expect(entersStateMock).toHaveBeenCalledWith(connection, "ready", 15_000);
  });

  it("resolves voice backend overrides from channel config before guild and default config", async () => {
    const manager = createManager({
      voice: {
        backend: "realtime",
      },
      guilds: {
        g1: {
          voiceBackend: "stt-agent-tts",
          channels: {
            "1001": {
              voiceBackend: "realtime",
            },
          },
        },
      },
    });

    await manager.join({ guildId: "g1", channelId: "1001" });

    const entry = (manager as unknown as { sessions: Map<string, unknown> }).sessions.get("g1") as
      | { voiceBackend?: string }
      | undefined;
    expect(entry?.voiceBackend).toBe("realtime");
  });

  it("stores guild metadata on joined voice sessions", async () => {
    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });

    const entry = (manager as unknown as { sessions: Map<string, unknown> }).sessions.get("g1") as
      | { guildName?: string }
      | undefined;
    expect(entry?.guildName).toBe("Guild One");
  });

  it("arms DAVE receive passthrough on decrypt failures that request it", async () => {
    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });

    const entry = (
      manager as unknown as {
        sessions: Map<
          string,
          {
            connection: {
              state: {
                networking: {
                  state: {
                    dave: {
                      session: {
                        setPassthroughMode: ReturnType<typeof vi.fn>;
                      };
                    };
                  };
                };
              };
            };
          }
        >;
      }
    ).sessions.get("g1");
    expect(entry).toBeDefined();

    emitDecryptFailure(manager);

    expect(
      entry?.connection.state.networking.state.dave.session.setPassthroughMode,
    ).toHaveBeenCalledWith(true, 15);
  });

  it("attempts rejoin after repeated decrypt failures", async () => {
    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });

    emitDecryptFailure(manager);
    emitDecryptFailure(manager);
    emitDecryptFailure(manager);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(joinVoiceChannelMock).toHaveBeenCalledTimes(2);
  });

  it("prefers realtime replies over the legacy agent path when available", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined;
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        ({
          start: vi.fn(async () => undefined),
          close: vi.fn(async () => undefined),
          interrupt: vi.fn(async () => undefined),
          submitText: vi.fn(async () => undefined),
          submitAudio: vi.fn(async () => {
            listener?.({
              type: "transcript.updated",
              item: { role: "assistant", status: "final", text: "Realtime hello" },
            });
            listener?.({
              type: "assistant.turn.updated",
              turn: { state: "completed", turnId: "resp-1" },
            });
          }),
          subscribe: vi.fn((next: (event: { type: string; [key: string]: unknown }) => void) => {
            listener = next;
            return () => {
              listener = undefined;
            };
          }),
          listTools: vi.fn(() => []),
        }) as never,
    );

    await processVoiceSegment(manager, "u-guest", { voiceBackend: "realtime" });

    expect(createManagedRealtimeConversationRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: "discord",
        agentId: "agent-1",
      }),
    );
    expect(agentCommandMock).not.toHaveBeenCalled();
  });

  it("falls back to the legacy agent path when realtime runtime startup fails", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );

    await processVoiceSegment(manager, "u-guest");

    expect(agentCommandMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the legacy agent path when realtime audio submission fails after connect", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        ({
          start: vi.fn(async () => undefined),
          close: vi.fn(async () => undefined),
          interrupt: vi.fn(async () => undefined),
          submitText: vi.fn(async () => undefined),
          submitAudio: vi.fn(async () => {
            throw new Error("submit failed");
          }),
          subscribe: vi.fn(() => () => undefined),
          listTools: vi.fn(() => []),
        }) as never,
    );

    await processVoiceSegment(manager, "u-guest");

    expect(agentCommandMock).toHaveBeenCalled();
  });

  it("keeps partial realtime output when audio submission fails after assistant output", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    createManagedRealtimeConversationRuntimeMock.mockImplementation(() => {
      let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined;
      return {
        start: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        interrupt: vi.fn(async () => undefined),
        submitText: vi.fn(async () => undefined),
        submitAudio: vi.fn(async () => {
          listener?.({
            type: "transcript.updated",
            sessionId: "session-1",
            item: { role: "assistant", status: "final", text: "Partial realtime answer" },
          });
          throw new Error("submit failed after output");
        }),
        subscribe: vi.fn((next: (event: { type: string; [key: string]: unknown }) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        }),
        listTools: vi.fn(() => []),
      } as never;
    });

    const result = await (
      manager as unknown as {
        generateVoiceReply: (params: {
          entry: {
            guildId: string;
            channelId: string;
            route: { sessionKey: string; agentId: string };
            player: ReturnType<typeof createAudioPlayerMock>;
            playbackQueue: Promise<void>;
            voiceBackend: "realtime";
            realtimeDisabled: boolean;
            realtimeConnectedOnce: boolean;
            realtimeEpoch: number;
          };
          wavPath: string;
          pcm: Buffer;
          senderLabel: string;
          senderIsOwner: boolean;
        }) => Promise<{ text: string; audioPath?: string; superseded?: boolean }>;
      }
    ).generateVoiceReply({
      entry: {
        guildId: "g1",
        channelId: "1001",
        route: { sessionKey: "discord:g1:1001", agentId: "agent-1" },
        player: createAudioPlayerMock(),
        playbackQueue: Promise.resolve(),
        voiceBackend: "realtime",
        realtimeDisabled: false,
        realtimeConnectedOnce: true,
        realtimeEpoch: 1,
      },
      wavPath: "/tmp/test.wav",
      pcm: Buffer.alloc(1920),
      senderLabel: "u-guest",
      senderIsOwner: false,
    });

    expect(result).toEqual({ text: "Partial realtime answer" });
    expect(agentCommandMock).not.toHaveBeenCalled();
  });

  it("falls back to the legacy agent path when realtime emits a fallback event after connect", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    const closeMock = vi.fn(async () => undefined);
    createManagedRealtimeConversationRuntimeMock.mockImplementation(() => {
      let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined;
      return {
        start: vi.fn(async () => undefined),
        close: closeMock,
        interrupt: vi.fn(async () => undefined),
        submitText: vi.fn(async () => undefined),
        submitAudio: vi.fn(async () => {
          listener?.({
            type: "fallback.changed",
            sessionId: "session-1",
            mode: "fallback",
            reason: "provider_failed",
          });
        }),
        subscribe: vi.fn((next: (event: { type: string; [key: string]: unknown }) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        }),
        listTools: vi.fn(() => []),
      } as never;
    });

    await processVoiceSegment(manager, "u-guest");

    expect(agentCommandMock).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(closeMock).toHaveBeenCalledWith("fallback");
    });
  });

  it("does not interrupt assistant playback for empty Discord captures", async () => {
    const manager = createManager();
    const connection = createConnectionMock();
    const player = createAudioPlayerMock();
    player.state.status = "playing";
    const interruptMock = vi.fn(async () => undefined);

    await (
      manager as unknown as {
        handleSpeakingStart: (entry: unknown, userId: string) => Promise<void>;
      }
    ).handleSpeakingStart(
      {
        guildId: "g1",
        channelId: "1001",
        connection,
        player,
        capture: createVoiceCaptureState(),
        activeSpeakers: new Set<string>(),
        realtime: { interrupt: interruptMock },
      },
      "u-guest",
    );

    expect(interruptMock).not.toHaveBeenCalled();
    expect(player.stop).not.toHaveBeenCalled();
  });

  it("routes legacy transcription through the Discord runtime surface", async () => {
    const manager = createManager();
    agentCommandMock.mockResolvedValueOnce({ payloads: [{ text: "Spoken reply" }] } as never);

    await (
      manager as unknown as {
        generateVoiceReply: (params: {
          entry: {
            guildId: string;
            channelId: string;
            route: { sessionKey: string; agentId: string };
            player: ReturnType<typeof createAudioPlayerMock>;
            playbackQueue: Promise<void>;
            voiceBackend: "stt-agent-tts";
            realtimeDisabled: boolean;
            realtimeConnectedOnce: boolean;
            realtimeEpoch: number;
          };
          wavPath: string;
          pcm: Buffer;
          senderLabel: string;
          senderIsOwner: boolean;
        }) => Promise<{ text: string; audioPath?: string }>;
      }
    ).generateVoiceReply({
      entry: {
        guildId: "g1",
        channelId: "1001",
        route: { sessionKey: "discord:g1:1001", agentId: "agent-1" },
        player: createAudioPlayerMock(),
        playbackQueue: Promise.resolve(),
        voiceBackend: "stt-agent-tts",
        realtimeDisabled: false,
        realtimeConnectedOnce: false,
        realtimeEpoch: 0,
      },
      wavPath: "/tmp/test.wav",
      pcm: Buffer.alloc(1920),
      senderLabel: "u-guest",
      senderIsOwner: false,
    });

    expect(transcribeAudioFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "/tmp/test.wav",
        mime: "audio/wav",
      }),
    );
  });

  it("passes senderIsOwner=true for allowlisted voice speakers", async () => {
    const client = createClient();
    client.fetchMember.mockResolvedValue({
      nickname: "Owner Nick",
      user: {
        id: "u-owner",
        username: "owner",
        globalName: "Owner",
        discriminator: "1234",
      },
    });
    const manager = createManager({ groupPolicy: "open", allowFrom: ["discord:u-owner"] }, client);
    await processVoiceSegment(manager, "u-owner");

    const commandArgs = agentCommandMock.mock.calls.at(-1)?.[0] as
      | { senderIsOwner?: boolean }
      | undefined;
    expect(commandArgs?.senderIsOwner).toBe(true);
  });

  it("passes senderIsOwner=false for non-owner voice speakers", async () => {
    const client = createClient();
    client.fetchMember.mockResolvedValue({
      nickname: "Guest Nick",
      user: {
        id: "u-guest",
        username: "guest",
        globalName: "Guest",
        discriminator: "4321",
      },
    });
    const manager = createManager({ groupPolicy: "open", allowFrom: ["discord:u-owner"] }, client, {
      commands: { useAccessGroups: false },
    });
    await processVoiceSegment(manager, "u-guest");

    const commandArgs = agentCommandMock.mock.calls.at(-1)?.[0] as
      | { senderIsOwner?: boolean }
      | undefined;
    expect(commandArgs?.senderIsOwner).toBe(false);
  });

  it("reuses speaker context cache for repeated segments from the same speaker", async () => {
    const client = createClient();
    client.fetchMember.mockResolvedValue({
      nickname: "Cached Speaker",
      user: {
        id: "u-cache",
        username: "cache",
        globalName: "Cache",
        discriminator: "1111",
      },
    });
    const manager = createManager({ allowFrom: ["discord:u-cache"] }, client);
    const runSegment = async () => await processVoiceSegment(manager, "u-cache");

    await runSegment();
    await runSegment();

    expect(client.fetchMember).toHaveBeenCalledTimes(1);
  });

  it("re-fetches member roles for repeated voice auth checks", async () => {
    const client = createClient();
    client.fetchMember
      .mockResolvedValueOnce({
        nickname: "Role Speaker",
        roles: ["role-voice"],
        user: {
          id: "u-role",
          username: "role",
          globalName: "Role",
          discriminator: "2222",
        },
      })
      .mockResolvedValueOnce({
        nickname: "Role Speaker",
        roles: [],
        user: {
          id: "u-role",
          username: "role",
          globalName: "Role",
          discriminator: "2222",
        },
      })
      .mockResolvedValue({
        nickname: "Role Speaker",
        roles: [],
        user: {
          id: "u-role",
          username: "role",
          globalName: "Role",
          discriminator: "2222",
        },
      });
    const manager = createManager(
      {
        groupPolicy: "allowlist",
        guilds: {
          g1: {
            channels: {
              "1001": {
                roles: ["role:role-voice"],
              },
            },
          },
        },
      },
      client,
    );

    await processVoiceSegment(manager, "u-role");
    await processVoiceSegment(manager, "u-role");

    expect(agentCommandMock).toHaveBeenCalledTimes(1);
    expect(client.fetchMember).toHaveBeenCalledTimes(2);
  });

  it("fetches guild metadata before allowlist checks when the session lacks a guild name", async () => {
    const client = createClient();
    client.fetchGuild.mockResolvedValue({ id: "g1", name: "Guild One" });
    client.fetchMember.mockResolvedValue({
      nickname: "Owner Nick",
      user: {
        id: "u-owner",
        username: "owner",
        globalName: "Owner",
        discriminator: "1234",
      },
    });
    const manager = createManager(
      {
        groupPolicy: "allowlist",
        guilds: {
          "guild-one": {
            channels: {
              "*": {
                users: ["discord:u-owner"],
              },
            },
          },
        },
      },
      client,
    );

    await processVoiceSegment(manager, "u-owner");

    expect(client.fetchGuild).toHaveBeenCalledWith("g1");
    expect(agentCommandMock).toHaveBeenCalledTimes(1);
  });

  it("DiscordVoiceReadyListener: propagates autoJoin errors fire-and-forget without throwing", async () => {
    const manager = createManager();
    vi.spyOn(manager, "autoJoin").mockRejectedValue(new Error("autoJoin rejected"));

    const { DiscordVoiceReadyListener } = managerModule;
    const listener = new DiscordVoiceReadyListener(manager);

    await expect(listener.handle(undefined, undefined as never)).resolves.not.toThrow();
    expect(manager.autoJoin).toHaveBeenCalledTimes(1);
  });
});
