import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveConfigWithAgentTalk } from "./talk-agent-config.js";

const getSpeechProviderMock = vi.hoisted(() => vi.fn());

vi.mock("../tts/provider-registry.js", () => ({
  getSpeechProvider: getSpeechProviderMock,
}));

describe("agent talk config", () => {
  beforeEach(() => {
    getSpeechProviderMock.mockReset();
  });

  it("also merges agent TTS providers into talk.providers with voice to voiceId mapping", () => {
    const cfg: OpenClawConfig = {
      talk: {
        provider: "openai",
        providers: {
          openai: {
            voiceId: "alloy",
            apiKey: "talk-key",
          },
          elevenlabs: {
            voiceId: "global-eleven-voice",
          },
        },
      },
      messages: {
        tts: {
          provider: "openai",
          providers: {
            openai: {
              voice: "alloy",
              apiKey: "messages-key",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "male-agent",
            tts: {
              providers: {
                openai: {
                  voice: "echo",
                },
              },
            },
          },
        ],
      },
    };

    const resolved = resolveConfigWithAgentTalk(cfg, "male-agent");

    expect(resolved.messages?.tts?.providers?.openai).toEqual({
      voice: "echo",
      apiKey: "messages-key",
    });
    expect(resolved.talk?.providers?.openai).toEqual({
      voiceId: "echo",
      apiKey: "talk-key",
    });
    expect(resolved.talk?.providers?.elevenlabs).toEqual({
      voiceId: "global-eleven-voice",
    });
    expect(cfg.talk?.providers?.openai).toEqual({
      voiceId: "alloy",
      apiKey: "talk-key",
    });
  });

  it("creates talk.providers from agent TTS when no talk config exists", () => {
    const cfg: OpenClawConfig = {
      messages: {
        tts: {
          provider: "openai",
          providers: {
            openai: {
              voice: "alloy",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "voice-d",
            tts: {
              providers: {
                openai: {
                  voice: "echo",
                },
              },
            },
          },
        ],
      },
    };

    const resolved = resolveConfigWithAgentTalk(cfg, "voice-d");

    expect(resolved.talk?.providers?.openai).toEqual({
      voiceId: "echo",
    });
    expect(resolved.talk?.provider).toBe("openai");
  });

  it("handles agent TTS overrides without provider-specific config", () => {
    const cfg: OpenClawConfig = {
      talk: {
        provider: "openai",
        providers: {
          openai: {
            voiceId: "alloy",
          },
        },
      },
      agents: {
        list: [
          {
            id: "voice-e",
            tts: {
              timeoutMs: 60_000,
            },
          },
        ],
      },
    };

    const resolved = resolveConfigWithAgentTalk(cfg, "voice-e");

    expect(resolved.talk?.providers?.openai).toEqual({
      voiceId: "alloy",
    });
    expect(resolved.messages?.tts?.timeoutMs).toBe(60_000);
  });

  it("synthesizes the selected base TTS provider into talk.providers when talk points elsewhere", () => {
    const cfg: OpenClawConfig = {
      talk: {
        provider: "elevenlabs",
        providers: {
          elevenlabs: {
            voiceId: "global-eleven-voice",
          },
        },
      },
      messages: {
        tts: {
          provider: "openai",
          providers: {
            openai: {
              voice: "alloy",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "voice-g",
            tts: {
              timeoutMs: 60_000,
            },
          },
        ],
      },
    };

    const resolved = resolveConfigWithAgentTalk(cfg, "voice-g");

    expect(resolved.talk?.provider).toBe("openai");
    expect(resolved.talk?.providers).toEqual({
      elevenlabs: { voiceId: "global-eleven-voice" },
      openai: { voiceId: "alloy" },
    });
  });

  it("repoints talk.provider when speech-provider defaults can materialize the selected config", () => {
    const cfg: OpenClawConfig = {
      talk: {
        provider: "legacy",
        providers: {
          legacy: {
            voiceId: "legacy-voice",
          },
        },
      },
      messages: {
        tts: {
          provider: "openai",
          providers: {
            openai: {
              voice: "alloy",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "voice-h",
            tts: {
              provider: "acme",
              timeoutMs: 60_000,
            },
          },
        ],
      },
    };

    getSpeechProviderMock.mockImplementation((providerId: string | undefined) => {
      if (providerId !== "acme") {
        return undefined;
      }
      return {
        id: "acme",
        label: "Acme Speech",
        resolveTalkConfig: ({ baseTtsConfig }: { baseTtsConfig: Record<string, unknown> }) => ({
          voiceId: typeof baseTtsConfig.timeoutMs === "number" ? "voice-from-defaults" : "missing",
        }),
      };
    });

    const resolved = resolveConfigWithAgentTalk(cfg, "voice-h");

    expect(resolved.messages?.tts?.provider).toBe("acme");
    expect(resolved.talk?.provider).toBe("acme");
    expect(resolved.talk?.providers?.legacy).toEqual({
      voiceId: "legacy-voice",
    });
    expect(resolved.talk?.providers?.acme).toEqual({
      voiceId: "voice-from-defaults",
    });
  });

  it("keeps the previous talk provider when the selected TTS provider cannot materialize talk config", () => {
    const cfg: OpenClawConfig = {
      talk: {
        provider: "legacy",
        providers: {
          legacy: {
            voiceId: "legacy-voice",
          },
        },
      },
      messages: {
        tts: {
          provider: "openai",
          providers: {
            openai: {
              voice: "alloy",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "voice-i",
            tts: {
              provider: "missing",
            },
          },
        ],
      },
    };

    getSpeechProviderMock.mockReturnValue(undefined);

    const resolved = resolveConfigWithAgentTalk(cfg, "voice-i");

    expect(resolved.messages?.tts?.provider).toBe("missing");
    expect(resolved.talk?.provider).toBe("legacy");
    expect(resolved.talk?.providers).toEqual({
      legacy: { voiceId: "legacy-voice" },
    });
  });
});
