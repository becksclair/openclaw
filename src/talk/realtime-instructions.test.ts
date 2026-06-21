import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readVoiceAgentBasePrompt,
  resolveVoiceAgentBasePromptPath,
} from "../agents/voice-agent-base-prompt-file.js";
import {
  buildTalkRealtimeInstructions,
  DEFAULT_TALK_REALTIME_INSTRUCTIONS,
} from "./realtime-instructions.js";

let tempDir: string;

function sha256Text(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

describe("voice agent base prompt file", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-voice-agent-base-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reads voice-agent-base.md exactly and fingerprints its contents", async () => {
    const agentDir = path.join(tempDir, "agents", "sky", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    const promptPath = resolveVoiceAgentBasePromptPath(agentDir);
    const text = "Voice base prompt\n\nKeep this exact trailing newline.\n";
    await fs.writeFile(promptPath, text, "utf8");

    const result = await readVoiceAgentBasePrompt({ agentDir });

    expect(result).toEqual({
      source: "agent-file",
      path: promptPath,
      text,
      fingerprint: sha256Text(text),
    });
  });

  it("returns none when the voice prompt file is absent", async () => {
    await expect(readVoiceAgentBasePrompt({ agentDir: tempDir })).resolves.toEqual({
      source: "none",
    });
  });
});

describe("buildTalkRealtimeInstructions", () => {
  it("preserves current default realtime instructions without voice prompt or context", () => {
    expect(buildTalkRealtimeInstructions()).toBe(DEFAULT_TALK_REALTIME_INSTRUCTIONS);
  });

  it("preserves current configured-instructions append behavior without voice prompt or context", () => {
    expect(buildTalkRealtimeInstructions({ configuredInstructions: " Speak warmly. " })).toBe(
      `${DEFAULT_TALK_REALTIME_INSTRUCTIONS}\n\nAdditional realtime instructions:\nSpeak warmly.`,
    );
  });

  it("places exact voice prompt text before operational rules", () => {
    const voiceText = "Voice base prompt\n\nUse Sky's spoken style.\n";

    const instructions = buildTalkRealtimeInstructions({
      voiceBasePrompt: {
        source: "agent-file",
        path: "/tmp/voice-agent-base.md",
        text: voiceText,
        fingerprint: sha256Text(voiceText),
      },
    });

    expect(instructions.startsWith(voiceText)).toBe(true);
    expect(instructions).toContain(
      `\n\nRealtime operational rules:\n${DEFAULT_TALK_REALTIME_INSTRUCTIONS}`,
    );
  });

  it("appends runtime context outside the voice prompt text", () => {
    const voiceText = "Voice base prompt\n";
    const contextText = "Session: Bex fork replay\nLast message tool send: posted to Telegram";

    const instructions = buildTalkRealtimeInstructions({
      voiceBasePrompt: {
        source: "agent-file",
        path: "/tmp/voice-agent-base.md",
        text: voiceText,
        fingerprint: sha256Text(voiceText),
      },
      contextPacket: { text: contextText },
    });

    expect(instructions).toContain(voiceText);
    expect(instructions).toContain(`Realtime context:\n${contextText}`);
    expect(instructions.indexOf("Realtime context:")).toBeGreaterThan(
      instructions.indexOf(voiceText),
    );
  });

  it("combines voice prompt, operational rules, context, and configured instructions in order", () => {
    const instructions = buildTalkRealtimeInstructions({
      voiceBasePrompt: {
        source: "agent-file",
        path: "/tmp/voice-agent-base.md",
        text: "Voice base prompt\n",
        fingerprint: sha256Text("Voice base prompt\n"),
      },
      contextPacket: { text: "Recent context." },
      configuredInstructions: "Operator override.",
    });

    expect(instructions.indexOf("Voice base prompt\n")).toBe(0);
    expect(instructions.indexOf("Realtime operational rules:")).toBeGreaterThan(
      instructions.indexOf("Voice base prompt\n"),
    );
    expect(instructions.indexOf("Realtime context:\nRecent context.")).toBeGreaterThan(
      instructions.indexOf("Realtime operational rules:"),
    );
    expect(
      instructions.indexOf("Additional realtime instructions:\nOperator override."),
    ).toBeGreaterThan(instructions.indexOf("Realtime context:\nRecent context."));
  });
});
