import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { TtsConfig } from "../config/types.tts.js";
import {
  mergeTtsConfig,
  resolveAgentTtsConfig,
  resolveAgentTtsOverride,
  resolveConfigWithAgentTts,
  shouldAttemptTtsPayload,
} from "./tts-config.js";

describe("shouldAttemptTtsPayload", () => {
  let originalPrefsPath: string | undefined;
  let dir: string;
  let prefsPath: string;

  beforeEach(() => {
    originalPrefsPath = process.env.OPENCLAW_TTS_PREFS;
    dir = mkdtempSync(path.join(tmpdir(), "openclaw-tts-config-"));
    prefsPath = path.join(dir, "tts.json");
    process.env.OPENCLAW_TTS_PREFS = prefsPath;
  });

  afterEach(() => {
    if (originalPrefsPath === undefined) {
      delete process.env.OPENCLAW_TTS_PREFS;
    } else {
      process.env.OPENCLAW_TTS_PREFS = originalPrefsPath;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips TTS when config, prefs, and session state leave auto mode off", () => {
    expect(shouldAttemptTtsPayload({ cfg: {} as OpenClawConfig })).toBe(false);
  });

  it("honors session auto state before prefs and config", () => {
    writeFileSync(prefsPath, JSON.stringify({ tts: { auto: "off" } }));
    const cfg = { messages: { tts: { auto: "off" } } } as OpenClawConfig;

    expect(shouldAttemptTtsPayload({ cfg, ttsAuto: "always" })).toBe(true);
    expect(shouldAttemptTtsPayload({ cfg, ttsAuto: "off" })).toBe(false);
  });

  it("uses local prefs before config auto mode", () => {
    const cfg = { messages: { tts: { auto: "off" } } } as OpenClawConfig;

    writeFileSync(prefsPath, JSON.stringify({ tts: { enabled: true } }));
    expect(shouldAttemptTtsPayload({ cfg })).toBe(true);

    writeFileSync(prefsPath, JSON.stringify({ tts: { auto: "off" } }));
    expect(
      shouldAttemptTtsPayload({ cfg: { messages: { tts: { enabled: true } } } as OpenClawConfig }),
    ).toBe(false);
  });
});

describe("agent-scoped TTS config", () => {
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
});
