import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { withEnvAsync } from "../test-utils/env.js";
import {
  createChatFinalAudioRegistry,
  MAX_CHAT_FINAL_AUDIO_BASE64_BYTES,
  MAX_CHAT_FINAL_AUDIO_BYTES,
  resolveChatFinalAudioGetPayload,
  resolveTrustedFinalAudioCandidate,
} from "./chat-final-audio.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix = "openclaw-final-audio-"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeTempAudio(
  name: string,
  bytes: string | Buffer = "audio-bytes",
): Promise<string> {
  const dir = await makeTempDir();
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

async function writeAudioFile(filePath: string, bytes: string | Buffer = "audio-bytes") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
  return filePath;
}

function createContext(registry = createChatFinalAudioRegistry()) {
  return {
    chatFinalAudio: registry,
    getRuntimeConfig: () => ({}) as OpenClawConfig,
    logGateway: { warn: vi.fn() },
  };
}

describe("chat final audio registry", () => {
  it("selects only trusted local TTS audio payloads", () => {
    expect(
      resolveTrustedFinalAudioCandidate([{ mediaUrl: "/tmp/not-trusted.ogg", audioAsVoice: true }]),
    ).toBeUndefined();

    expect(
      resolveTrustedFinalAudioCandidate([
        {
          mediaUrl: "/tmp/tool-result.ogg",
          trustedLocalMedia: true,
          text: "plain trusted media is not a final TTS artifact",
        },
      ]),
    ).toBeUndefined();

    expect(
      resolveTrustedFinalAudioCandidate([
        {
          mediaUrl: "/tmp/tool-result.ogg",
          trustedLocalMedia: true,
          audioAsVoice: true,
          text: "trusted voice media still needs TTS provenance",
        },
      ]),
    ).toBeUndefined();

    expect(
      resolveTrustedFinalAudioCandidate([
        {
          mediaUrl: "/tmp/tool-result.wav",
          trustedLocalMedia: true,
          spokenText: "spoken reply",
        },
      ]),
    ).toEqual({ mediaPath: "/tmp/tool-result.wav", spokenText: "spoken reply" });

    const trusted = resolveTrustedFinalAudioCandidate([
      {
        mediaUrl: "/tmp/reply.ogg",
        trustedLocalMedia: true,
        audioAsVoice: true,
        ttsSupplement: { spokenText: "hello watch" },
      },
    ]);

    expect(trusted).toEqual({ mediaPath: "/tmp/reply.ogg", spokenText: "hello watch" });
  });

  it("expires records and rejects mismatched sessions", () => {
    let now = 1_000;
    const registry = createChatFinalAudioRegistry({ ttlMs: 100, now: () => now });
    registry.set({ runId: "run-1", sessionKey: "session-a", mediaPath: "/tmp/reply.ogg" });

    expect(registry.get({ runId: "run-1", sessionKey: "session-b" })).toBeUndefined();
    expect(registry.get({ runId: "run-1", sessionKey: "session-a" })?.mediaPath).toBe(
      "/tmp/reply.ogg",
    );

    now = 1_101;
    expect(registry.get({ runId: "run-1", sessionKey: "session-a" })).toBeUndefined();
  });

  it("keeps same-run audio isolated by session", () => {
    const registry = createChatFinalAudioRegistry();
    registry.set({ runId: "run-1", sessionKey: "session-a", mediaPath: "/tmp/a.ogg" });
    registry.set({ runId: "run-1", sessionKey: "session-b", mediaPath: "/tmp/b.ogg" });

    expect(registry.get({ runId: "run-1", sessionKey: "session-a" })?.mediaPath).toBe("/tmp/a.ogg");
    expect(registry.get({ runId: "run-1", sessionKey: "session-b" })?.mediaPath).toBe("/tmp/b.ogg");
  });

  it("requires agent matches for shared global session records", () => {
    const registry = createChatFinalAudioRegistry();
    registry.set({
      runId: "run-1",
      sessionKey: "global",
      agentId: "agent-a",
      mediaPath: "/tmp/a.ogg",
    });
    registry.set({
      runId: "run-1",
      sessionKey: "global",
      agentId: "agent-b",
      mediaPath: "/tmp/b.ogg",
    });

    expect(registry.get({ runId: "run-1", sessionKey: "global" })).toBeUndefined();
    expect(
      registry.get({ runId: "run-1", sessionKey: "global", agentId: "agent-a" })?.mediaPath,
    ).toBe("/tmp/a.ogg");
    expect(
      registry.get({ runId: "run-1", sessionKey: "global", agentId: "agent-b" })?.mediaPath,
    ).toBe("/tmp/b.ogg");
    expect(
      registry.get({ runId: "run-1", sessionKey: "global", agentId: "agent-c" }),
    ).toBeUndefined();
  });

  it("allows agent-scoped session keys to retrieve without repeating agentId", () => {
    const registry = createChatFinalAudioRegistry();
    registry.set({
      runId: "run-1",
      sessionKey: "agent:sky:direct:bex",
      agentId: "sky",
      mediaPath: "/tmp/reply.ogg",
    });

    expect(registry.get({ runId: "run-1", sessionKey: "agent:sky:direct:bex" })?.mediaPath).toBe(
      "/tmp/reply.ogg",
    );
    expect(
      registry.get({ runId: "run-1", sessionKey: "agent:sky:direct:bex", agentId: "other" }),
    ).toBeUndefined();
  });

  it("deletes all records for a cleared run", () => {
    const registry = createChatFinalAudioRegistry();
    registry.set({ runId: "run-1", sessionKey: "session-a", mediaPath: "/tmp/a.ogg" });
    registry.set({ runId: "run-1", sessionKey: "session-b", mediaPath: "/tmp/b.ogg" });
    registry.set({ runId: "run-2", sessionKey: "session-a", mediaPath: "/tmp/c.ogg" });

    registry.deleteRun("run-1");

    expect(registry.get({ runId: "run-1", sessionKey: "session-a" })).toBeUndefined();
    expect(registry.get({ runId: "run-1", sessionKey: "session-b" })).toBeUndefined();
    expect(registry.get({ runId: "run-2", sessionKey: "session-a" })?.mediaPath).toBe("/tmp/c.ogg");
  });
});

describe("chat.finalAudio.get", () => {
  it("returns run-scoped trusted audio bytes", async () => {
    const stateDir = await makeTempDir("openclaw-final-audio-state-");
    await withEnvAsync({ OPENCLAW_STATE_DIR: stateDir }, async () => {
      const audioPath = await writeAudioFile(
        path.join(stateDir, "media", "reply.ogg"),
        "watch audio",
      );
      const registry = createChatFinalAudioRegistry();
      registry.set({
        runId: "run-1",
        sessionKey: "agent:sky:direct:bex",
        mediaPath: audioPath,
        spokenText: "assistant words",
      });
      const result = await resolveChatFinalAudioGetPayload({
        params: {
          sessionKey: "agent:sky:direct:bex",
          runId: "run-1",
        },
        context: createContext(registry),
      });

      expect(result.ok).toBe(true);
      expect(result.ok ? result.payload : undefined).toEqual({
        found: true,
        audioBase64: Buffer.from("watch audio").toString("base64"),
        outputFormat: "ogg",
        mimeType: "audio/ogg",
        fileExtension: ".ogg",
        spokenText: "assistant words",
      });
    });
  });

  it("returns global-session audio only when the final event agentId is supplied", async () => {
    const stateDir = await makeTempDir("openclaw-final-audio-state-");
    await withEnvAsync({ OPENCLAW_STATE_DIR: stateDir }, async () => {
      const audioPath = await writeAudioFile(
        path.join(stateDir, "media", "reply.ogg"),
        "watch audio",
      );
      const registry = createChatFinalAudioRegistry();
      registry.set({
        runId: "run-1",
        sessionKey: "global",
        agentId: "sky",
        mediaPath: audioPath,
        spokenText: "assistant words",
      });

      const missingAgent = await resolveChatFinalAudioGetPayload({
        params: { sessionKey: "global", runId: "run-1" },
        context: createContext(registry),
      });
      expect(missingAgent).toEqual({
        ok: true,
        payload: { found: false, unavailableReason: "not_found" },
      });

      const result = await resolveChatFinalAudioGetPayload({
        params: { sessionKey: "global", agentId: "sky", runId: "run-1" },
        context: createContext(registry),
      });

      expect(result.ok).toBe(true);
      expect(result.ok ? result.payload : undefined).toEqual({
        found: true,
        audioBase64: Buffer.from("watch audio").toString("base64"),
        outputFormat: "ogg",
        mimeType: "audio/ogg",
        fileExtension: ".ogg",
        spokenText: "assistant words",
      });
    });
  });

  it("returns not_found for missing or mismatched runs", async () => {
    const registry = createChatFinalAudioRegistry();
    registry.set({ runId: "run-1", sessionKey: "session-a", mediaPath: "/tmp/reply.ogg" });
    const result = await resolveChatFinalAudioGetPayload({
      params: { sessionKey: "session-b", runId: "run-1" },
      context: createContext(registry),
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        found: false,
        unavailableReason: "not_found",
      },
    });
  });

  it("waits for a delayed matching record", async () => {
    const stateDir = await makeTempDir("openclaw-final-audio-state-");
    await withEnvAsync({ OPENCLAW_STATE_DIR: stateDir }, async () => {
      vi.useFakeTimers();
      try {
        const audioPath = await writeAudioFile(
          path.join(stateDir, "media", "reply.ogg"),
          "watch audio",
        );
        const registry = createChatFinalAudioRegistry();
        const pending = resolveChatFinalAudioGetPayload({
          params: { sessionKey: "session-a", runId: "run-1", waitMs: 500 },
          context: createContext(registry),
        });

        await Promise.resolve();
        registry.set({
          runId: "run-1",
          sessionKey: "session-a",
          mediaPath: audioPath,
          spokenText: "assistant words",
        });
        await vi.advanceTimersByTimeAsync(250);

        const result = await pending;
        expect(result.ok).toBe(true);
        expect(result.ok ? result.payload : undefined).toEqual({
          found: true,
          audioBase64: Buffer.from("watch audio").toString("base64"),
          outputFormat: "ogg",
          mimeType: "audio/ogg",
          fileExtension: ".ogg",
          spokenText: "assistant words",
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("rejects final audio outside allowed media roots", async () => {
    const stateDir = await makeTempDir("openclaw-final-audio-state-");
    const audioPath = await writeTempAudio("outside.ogg", "watch audio");
    await withEnvAsync({ OPENCLAW_STATE_DIR: stateDir }, async () => {
      const registry = createChatFinalAudioRegistry();
      registry.set({
        runId: "run-1",
        sessionKey: "session-a",
        mediaPath: audioPath,
        spokenText: "assistant words",
      });

      const result = await resolveChatFinalAudioGetPayload({
        params: { sessionKey: "session-a", runId: "run-1" },
        context: createContext(registry),
      });

      expect(result).toEqual({
        ok: true,
        payload: {
          found: false,
          unavailableReason: "unreadable",
        },
      });
    });
  });

  it("returns too_large before reading oversized final audio into the response", async () => {
    const stateDir = await makeTempDir("openclaw-final-audio-state-");
    await withEnvAsync({ OPENCLAW_STATE_DIR: stateDir }, async () => {
      const audioPath = await writeAudioFile(
        path.join(stateDir, "media", "reply.ogg"),
        Buffer.alloc(MAX_CHAT_FINAL_AUDIO_BYTES + 1),
      );
      const registry = createChatFinalAudioRegistry();
      registry.set({
        runId: "run-1",
        sessionKey: "session-a",
        mediaPath: audioPath,
        spokenText: "assistant words",
      });

      const result = await resolveChatFinalAudioGetPayload({
        params: { sessionKey: "session-a", runId: "run-1" },
        context: createContext(registry),
      });

      expect(result).toEqual({
        ok: true,
        payload: {
          found: false,
          unavailableReason: "too_large",
        },
      });
    });
  });

  it("keeps the largest inline response within the base64 payload budget", async () => {
    const stateDir = await makeTempDir("openclaw-final-audio-state-");
    await withEnvAsync({ OPENCLAW_STATE_DIR: stateDir }, async () => {
      const audioPath = await writeAudioFile(
        path.join(stateDir, "media", "reply.ogg"),
        Buffer.alloc(MAX_CHAT_FINAL_AUDIO_BYTES),
      );
      const registry = createChatFinalAudioRegistry();
      registry.set({
        runId: "run-1",
        sessionKey: "session-a",
        mediaPath: audioPath,
        spokenText: "assistant words",
      });

      const result = await resolveChatFinalAudioGetPayload({
        params: { sessionKey: "session-a", runId: "run-1" },
        context: createContext(registry),
      });

      expect(result.ok).toBe(true);
      if (!result.ok || !("audioBase64" in result.payload)) {
        throw new Error("expected final audio payload");
      }
      const payload = result.payload;
      expect(payload).toMatchObject({ found: true });
      expect(String(payload.audioBase64 ?? "").length).toBeLessThanOrEqual(
        MAX_CHAT_FINAL_AUDIO_BASE64_BYTES,
      );
    });
  });
});
