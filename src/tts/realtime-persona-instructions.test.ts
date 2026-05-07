import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.js";
import {
  renderTtsPersonaDeliveryInstructions,
  resolveTtsPersonaDeliveryInstructions,
} from "./realtime-persona-instructions.js";

describe("realtime TTS persona instructions", () => {
  it("renders provider-neutral persona delivery guidance", () => {
    const instructions = renderTtsPersonaDeliveryInstructions({
      id: "sky",
      label: "Sky",
      description: "Warm, incisive, and alive.",
      provider: "google",
      fallbackPolicy: "preserve-persona",
      prompt: {
        profile: "A technically formidable operator companion.",
        scene: "Close-mic live conversation.",
        sampleContext: "The speaker is answering a technical request.",
        style: "Dry warmth, confidence, and bite.",
        accent: "Clear modern English.",
        pacing: "Natural, with room to breathe.",
        constraints: ["Do not explain the persona.", "Do not read configuration values aloud."],
      },
      providers: {
        google: {
          voiceName: "secret-voice-binding",
          model: "gemini-realtime-model",
        },
      },
    });

    expect(instructions).toContain("Name: Sky");
    expect(instructions).toContain("Profile: A technically formidable operator companion.");
    expect(instructions).toContain("Constraint: Do not explain the persona.");
    expect(instructions).not.toContain("google");
    expect(instructions).not.toContain("secret-voice-binding");
    expect(instructions).not.toContain("gemini-realtime-model");
    expect(instructions).not.toContain("preserve-persona");
  });

  it("returns undefined when no useful delivery guidance is available", () => {
    expect(renderTtsPersonaDeliveryInstructions(undefined)).toBeUndefined();
    expect(renderTtsPersonaDeliveryInstructions({ id: "empty" })).toBeUndefined();
  });

  it("resolves persona prefs over agent-scoped config", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openclaw-realtime-tts-"));
    const prefsPath = path.join(dir, "tts.json");
    writeFileSync(prefsPath, JSON.stringify({ tts: { persona: "prefs" } }));
    try {
      const cfg = {
        messages: {
          tts: {
            persona: "sky",
            prefsPath,
            personas: {
              sky: { label: "Sky", prompt: { profile: "Global Sky persona." } },
              luke: { label: "Luke", prompt: { profile: "Agent Luke persona." } },
              prefs: { label: "Prefs", prompt: { profile: "Mutable prefs persona." } },
            },
          },
        },
        agents: {
          list: [
            {
              id: "luke",
              tts: {
                persona: "luke",
              },
            },
          ],
        },
      } as OpenClawConfig;

      const instructions = resolveTtsPersonaDeliveryInstructions(cfg, { agentId: "luke" });

      expect(instructions).toContain("Name: Prefs");
      expect(instructions).toContain("Mutable prefs persona.");
      expect(instructions).not.toContain("Agent Luke persona.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves agent persona overrides when no prefs persona is selected", () => {
    const cfg = {
      messages: {
        tts: {
          persona: "sky",
          prefsPath: "/tmp/openclaw-realtime-tts-missing-prefs.json",
          personas: {
            sky: { label: "Sky", prompt: { profile: "Global Sky persona." } },
            luke: { label: "Luke", prompt: { profile: "Agent Luke persona." } },
          },
        },
      },
      agents: {
        list: [
          {
            id: "luke",
            tts: {
              persona: "luke",
            },
          },
        ],
      },
    } as OpenClawConfig;

    const instructions = resolveTtsPersonaDeliveryInstructions(cfg, { agentId: "luke" });

    expect(instructions).toContain("Name: Luke");
    expect(instructions).toContain("Agent Luke persona.");
    expect(instructions).not.toContain("Global Sky persona.");
  });
});
