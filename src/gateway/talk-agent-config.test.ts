import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveConfigWithAgentTalk } from "./talk-agent-config.js";

describe("agent talk config", () => {
  it("also merges agent tts providers into talk.providers with voice->voiceId mapping", () => {
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

  it("creates talk.providers from agent tts when no talk config exists", () => {
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

  it("handles agent tts override without provider-specific config", () => {
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
            id: "voice-h",
            tts: {
              provider: "deepgram",
            },
          },
        ],
      },
    };

    const resolved = resolveConfigWithAgentTalk(cfg, "voice-h");

    expect(resolved.messages?.tts?.provider).toBe("deepgram");
    expect(resolved.talk?.provider).toBe("deepgram");
    expect(resolved.talk?.providers?.elevenlabs).toEqual({
      voiceId: "global-eleven-voice",
    });
    expect(resolved.talk?.providers?.deepgram).toBeTruthy();
  });

  it("agent voice overrides base talk provider voice for deepgram-style configs", () => {
    const cfg: OpenClawConfig = {
      messages: {
        tts: {
          provider: "deepgram",
          providers: {
            deepgram: {
              voice: "aura-2-luna-en",
            },
          },
        },
      },
      talk: {
        provider: "deepgram",
        providers: {
          deepgram: {
            voice: "aura-2-luna-en",
            model: "aura-2-luna-en",
          },
        },
      },
      agents: {
        list: [
          {
            id: "luke",
            tts: {
              provider: "deepgram",
              providers: {
                deepgram: {
                  voice: "aura-2-orion-en",
                  model: "aura-2-orion-en",
                },
              },
            },
          },
        ],
      },
    };

    const resolved = resolveConfigWithAgentTalk(cfg, "luke");

    expect(resolved.talk?.providers?.deepgram).toEqual({
      voiceId: "aura-2-orion-en",
      modelId: "aura-2-orion-en",
    });
    expect(resolved.messages?.tts?.providers?.deepgram?.voice).toBe("aura-2-orion-en");
  });

  it("copies the selected TTS provider into synthesized talk config for multi-provider overrides", () => {
    const cfg: OpenClawConfig = {
      messages: {
        tts: {
          provider: "openai",
          providers: {
            openai: {
              voice: "alloy",
            },
            elevenlabs: {
              voiceId: "voice-shared",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "voice-f",
            tts: {
              providers: {
                openai: {
                  voice: "echo",
                },
                elevenlabs: {
                  voiceId: "voice-agent",
                },
              },
            },
          },
        ],
      },
    };

    const resolved = resolveConfigWithAgentTalk(cfg, "voice-f");

    expect(resolved.talk?.provider).toBe("openai");
    expect(resolved.talk?.providers).toEqual({
      openai: { voiceId: "echo" },
      elevenlabs: { voiceId: "voice-agent" },
    });
  });
});
