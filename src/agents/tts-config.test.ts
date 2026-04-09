import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { TtsConfig } from "../config/types.tts.js";
import {
  mergeTtsConfig,
  resolveAgentTtsConfig,
  resolveAgentTtsOverride,
  resolveConfigWithAgentTts,
} from "./tts-config.js";

describe("agent tts config", () => {
  it("deep-merges provider and modelOverrides entries", () => {
    const merged = mergeTtsConfig(
      {
        provider: "openai",
        modelOverrides: {
          enabled: true,
          allowVoice: false,
        },
        providers: {
          openai: {
            apiKey: "base-key",
            voice: "alloy",
            voiceSettings: {
              stability: 0.5,
              style: 0.1,
            },
            request: {
              headers: {
                Authorization: "Bearer base",
                "X-Base": "1",
              },
            },
          },
        },
      },
      {
        modelOverrides: {
          allowVoice: true,
          allowProvider: true,
        },
        providers: {
          openai: {
            voice: "nova",
            voiceSettings: {
              style: 0.2,
            },
            request: {
              headers: {
                Authorization: "Bearer override",
              },
            },
          },
        },
      },
    );

    expect(merged.modelOverrides).toEqual({
      enabled: true,
      allowVoice: true,
      allowProvider: true,
    });
    expect(merged.providers?.openai).toEqual({
      apiKey: "base-key",
      voice: "nova",
      voiceSettings: {
        stability: 0.5,
        style: 0.2,
      },
      request: {
        headers: {
          Authorization: "Bearer override",
          "X-Base": "1",
        },
      },
    });
  });

  it("exposes agent override helpers and applies merged config copies", () => {
    const cfg: OpenClawConfig = {
      messages: {
        tts: {
          provider: "openai",
          providers: {
            openai: {
              apiKey: "shared-key",
              voice: "alloy",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "voice-b",
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

    expect(resolveAgentTtsOverride(cfg, "voice-b")).toEqual({
      providers: {
        openai: {
          voice: "echo",
        },
      },
    });
    expect(resolveAgentTtsConfig(cfg, "voice-b")).toEqual({
      provider: "openai",
      providers: {
        openai: {
          apiKey: "shared-key",
          voice: "echo",
        },
      },
    });

    const resolved = resolveConfigWithAgentTts(cfg, "voice-b");

    expect(resolved).not.toBe(cfg);
    expect(resolved.messages?.tts?.provider).toBe("openai");
    expect(resolved.messages?.tts?.providers?.openai).toEqual({
      apiKey: "shared-key",
      voice: "echo",
    });
    expect(cfg.messages?.tts?.providers?.openai).toEqual({
      apiKey: "shared-key",
      voice: "alloy",
    });
  });

  it("lets an agent clear inherited nested provider objects with an empty override object", () => {
    const merged = mergeTtsConfig(
      {
        providers: {
          openai: {
            voice: "alloy",
            voiceSettings: {
              stability: 0.5,
              style: 0.1,
            },
          },
        },
      },
      {
        providers: {
          openai: {
            voiceSettings: {},
          },
        },
      },
    );

    expect(merged.providers?.openai).toEqual({
      voice: "alloy",
      voiceSettings: {},
    });
  });

  it("treats an empty top-level provider override as a no-op merge", () => {
    const merged = mergeTtsConfig(
      {
        providers: {
          openai: {
            apiKey: "shared-key",
            voice: "alloy",
          },
        },
      },
      {
        providers: {
          openai: {},
        },
      },
    );

    expect(merged.providers?.openai).toEqual({
      apiKey: "shared-key",
      voice: "alloy",
    });
  });

  it("does not create empty provider configs from empty overrides without a base provider", () => {
    const merged = mergeTtsConfig(
      {
        provider: "openai",
      },
      {
        providers: {
          openai: {},
        },
      },
    );

    expect(merged.providers).toBeUndefined();
  });

  it("returns the original base object for an empty override object", () => {
    const base: TtsConfig = {
      provider: "openai",
    };

    expect(mergeTtsConfig(base, {})).toBe(base);
  });

  it("returns original config when no agent override exists", () => {
    const cfg: OpenClawConfig = {
      messages: {
        tts: {
          provider: "openai",
        },
      },
      agents: {
        list: [{ id: "main" }],
      },
    };

    expect(resolveConfigWithAgentTts(cfg, "main")).toBe(cfg);
  });

  it("returns original config when an agent override object is empty", () => {
    const cfg: OpenClawConfig = {
      messages: {
        tts: {
          provider: "openai",
        },
      },
      agents: {
        list: [{ id: "main", tts: {} }],
      },
    };

    expect(resolveConfigWithAgentTts(cfg, "main")).toBe(cfg);
  });

  it("returns provider config objects detached from the base config", () => {
    const cfg: OpenClawConfig = {
      messages: {
        tts: {
          providers: {
            openai: {
              voice: "alloy",
              request: {
                headers: {
                  Authorization: "Bearer base",
                },
              },
            },
            elevenlabs: {
              voiceId: "voice-1",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "voice-c",
            tts: {
              providers: {
                openai: {
                  voice: "nova",
                },
              },
            },
          },
        ],
      },
    };

    const resolved = resolveConfigWithAgentTts(cfg, "voice-c");
    expect(resolved).not.toBe(cfg);
    expect(resolved.messages?.tts?.providers).not.toBe(cfg.messages?.tts?.providers);
    expect(resolved.messages?.tts?.providers?.openai).not.toBe(
      cfg.messages?.tts?.providers?.openai,
    );
    expect(resolved.messages?.tts?.providers?.elevenlabs).not.toBe(
      cfg.messages?.tts?.providers?.elevenlabs,
    );
  });
});
