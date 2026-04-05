import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { upsertAcpSessionMeta } from "../../acp/runtime/session-meta.js";
import { acquireSessionWriteLock } from "../../agents/session-write-lock.js";
import * as jsonFiles from "../../infra/json-files.js";
import * as transcriptEvents from "../../sessions/transcript-events.js";
import { createSuiteTempRootTracker, withTempDirSync } from "../../test-helpers/temp-dir.js";
import type { OpenClawConfig } from "../config.js";
import type { SessionConfig } from "../types.base.js";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionTranscriptPathInDir,
  validateSessionId,
} from "./paths.js";
import { evaluateSessionFreshness, resolveSessionResetPolicy } from "./reset.js";
import { resolveAndPersistSessionFile } from "./session-file.js";
import { clearSessionStoreCacheForTest, loadSessionStore, updateSessionStore } from "./store.js";
import * as storeModule from "./store.js";
import { useTempSessionsFixture } from "./test-helpers.js";
import {
  appendAssistantMessageToSessionTranscript,
  appendTextMessagesToSessionTranscript,
} from "./transcript.js";
import { mergeSessionEntry, type SessionEntry } from "./types.js";

describe("session path safety", () => {
  it("rejects unsafe session IDs", () => {
    const unsafeSessionIds = ["../etc/passwd", "a/b", "a\\b", "/abs"];
    for (const sessionId of unsafeSessionIds) {
      expect(() => validateSessionId(sessionId), sessionId).toThrow(/Invalid session ID/);
    }
  });

  it("resolves transcript path inside an explicit sessions dir", () => {
    const sessionsDir = "/tmp/openclaw/agents/main/sessions";
    const resolved = resolveSessionTranscriptPathInDir("sess-1", sessionsDir, "topic/a+b");

    expect(resolved).toBe(path.resolve(sessionsDir, "sess-1-topic-topic%2Fa%2Bb.jsonl"));
  });

  it("falls back to derived path when sessionFile is outside known agent sessions dirs", () => {
    const sessionsDir = "/tmp/openclaw/agents/main/sessions";

    const resolved = resolveSessionFilePath(
      "sess-1",
      { sessionFile: "/tmp/openclaw/agents/work/not-sessions/abc-123.jsonl" },
      { sessionsDir },
    );
    expect(resolved).toBe(path.resolve(sessionsDir, "sess-1.jsonl"));
  });

  it("ignores multi-store sentinel paths when deriving session file options", () => {
    expect(resolveSessionFilePathOptions({ agentId: "worker", storePath: "(multiple)" })).toEqual({
      agentId: "worker",
    });
    expect(resolveSessionFilePathOptions({ storePath: "(multiple)" })).toBeUndefined();
  });

  it("accepts symlink-alias session paths that resolve under the sessions dir", () => {
    if (process.platform === "win32") {
      return;
    }
    withTempDirSync({ prefix: "openclaw-symlink-session-" }, (tmpDir) => {
      const realRoot = path.join(tmpDir, "real-state");
      const aliasRoot = path.join(tmpDir, "alias-state");
      const sessionsDir = path.join(realRoot, "agents", "main", "sessions");
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.symlinkSync(realRoot, aliasRoot, "dir");
      const viaAlias = path.join(aliasRoot, "agents", "main", "sessions", "sess-1.jsonl");
      fs.writeFileSync(path.join(sessionsDir, "sess-1.jsonl"), "");
      const resolved = resolveSessionFilePath("sess-1", { sessionFile: viaAlias }, { sessionsDir });
      expect(fs.realpathSync(resolved)).toBe(
        fs.realpathSync(path.join(sessionsDir, "sess-1.jsonl")),
      );
    });
  });

  it("falls back when sessionFile is a symlink that escapes sessions dir", () => {
    if (process.platform === "win32") {
      return;
    }
    withTempDirSync({ prefix: "openclaw-symlink-escape-" }, (tmpDir) => {
      const sessionsDir = path.join(tmpDir, "agents", "main", "sessions");
      const outsideDir = path.join(tmpDir, "outside");
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });
      const outsideFile = path.join(outsideDir, "escaped.jsonl");
      fs.writeFileSync(outsideFile, "");
      const symlinkPath = path.join(sessionsDir, "escaped.jsonl");
      fs.symlinkSync(outsideFile, symlinkPath, "file");

      const resolved = resolveSessionFilePath(
        "sess-1",
        { sessionFile: symlinkPath },
        { sessionsDir },
      );
      expect(fs.realpathSync(path.dirname(resolved))).toBe(fs.realpathSync(sessionsDir));
      expect(path.basename(resolved)).toBe("sess-1.jsonl");
    });
  });
});

describe("resolveSessionResetPolicy", () => {
  describe("backward compatibility: resetByType.dm -> direct", () => {
    it("does not use dm fallback for group/thread types", () => {
      const sessionCfg = {
        resetByType: {
          dm: { mode: "idle" as const, idleMinutes: 45 },
        },
      } as unknown as SessionConfig;

      const groupPolicy = resolveSessionResetPolicy({
        sessionCfg,
        resetType: "group",
      });

      expect(groupPolicy.mode).toBe("daily");
    });
  });

  it("defaults to daily resets at 4am local time", () => {
    const policy = resolveSessionResetPolicy({
      resetType: "direct",
    });

    expect(policy).toMatchObject({
      mode: "daily",
      atHour: 4,
    });
  });

  it("treats idleMinutes=0 as never expiring by inactivity", () => {
    const freshness = evaluateSessionFreshness({
      updatedAt: 1_000,
      now: 60 * 60 * 1_000,
      policy: {
        mode: "idle",
        atHour: 4,
        idleMinutes: 0,
      },
    });

    expect(freshness).toEqual({
      fresh: true,
      dailyResetAt: undefined,
      idleExpiresAt: undefined,
    });
  });
});

describe("session store lock (Promise chain mutex)", () => {
  const lockFixtureRootTracker = createSuiteTempRootTracker({ prefix: "openclaw-lock-test-" });
  let lockTmpDirs: string[] = [];

  async function makeTmpStore(
    initial: Record<string, unknown> = {},
  ): Promise<{ dir: string; storePath: string }> {
    const dir = await lockFixtureRootTracker.make("case");
    lockTmpDirs.push(dir);
    const storePath = path.join(dir, "sessions.json");
    if (Object.keys(initial).length > 0) {
      await fsPromises.writeFile(storePath, JSON.stringify(initial, null, 2), "utf-8");
    }
    return { dir, storePath };
  }

  beforeAll(async () => {
    await lockFixtureRootTracker.setup();
  });

  afterAll(async () => {
    await lockFixtureRootTracker.cleanup();
  });

  afterEach(async () => {
    clearSessionStoreCacheForTest();
    lockTmpDirs = [];
  });

  it("serializes concurrent updateSessionStore calls without data loss", async () => {
    const key = "agent:main:test";
    const { storePath } = await makeTmpStore({
      [key]: { sessionId: "s1", updatedAt: 100, counter: 0 },
    });

    const N = 4;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        updateSessionStore(storePath, async (store) => {
          const entry = store[key] as Record<string, unknown>;
          await Promise.resolve();
          entry.counter = (entry.counter as number) + 1;
          entry.tag = `writer-${i}`;
        }),
      ),
    );

    const store = loadSessionStore(storePath);
    expect((store[key] as Record<string, unknown>).counter).toBe(N);
  });

  it("skips session store disk writes when payload is unchanged", async () => {
    const key = "agent:main:no-op-save";
    const { storePath } = await makeTmpStore({
      [key]: { sessionId: "s-noop", updatedAt: Date.now() },
    });

    const writeSpy = vi.spyOn(jsonFiles, "writeTextAtomic");
    await updateSessionStore(
      storePath,
      async () => {
        // Intentionally no-op mutation.
      },
      { skipMaintenance: true },
    );
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("multiple consecutive errors do not permanently poison the queue", async () => {
    const key = "agent:main:multi-err";
    const { storePath } = await makeTmpStore({
      [key]: { sessionId: "s1", updatedAt: 100 },
    });

    const errors = Array.from({ length: 3 }, (_, i) =>
      updateSessionStore(storePath, async () => {
        throw new Error(`fail-${i}`);
      }),
    );

    const success = updateSessionStore(storePath, async (store) => {
      store[key] = { ...store[key], modelOverride: "recovered" } as unknown as SessionEntry;
    });

    for (const p of errors) {
      await expect(p).rejects.toThrow();
    }
    await success;

    const store = loadSessionStore(storePath);
    expect(store[key]?.modelOverride).toBe("recovered");
  });

  it("clears stale runtime provider when model is patched without provider", () => {
    const merged = mergeSessionEntry(
      {
        sessionId: "sess-runtime",
        updatedAt: 100,
        modelProvider: "anthropic",
        model: "claude-opus-4-6",
      },
      {
        model: "gpt-5.4",
      },
    );
    expect(merged.model).toBe("gpt-5.4");
    expect(merged.modelProvider).toBeUndefined();
  });

  it("normalizes orphan modelProvider fields at store write boundary", async () => {
    const key = "agent:main:orphan-provider";
    const { storePath } = await makeTmpStore({
      [key]: {
        sessionId: "sess-orphan",
        updatedAt: 100,
        modelProvider: "anthropic",
      },
    });

    await updateSessionStore(storePath, async (store) => {
      const entry = store[key];
      entry.updatedAt = Date.now();
    });

    const store = loadSessionStore(storePath);
    expect(store[key]?.modelProvider).toBeUndefined();
    expect(store[key]?.model).toBeUndefined();
  });

  it("preserves ACP metadata when replacing a session entry wholesale", async () => {
    const key = "agent:codex:acp:binding:discord:default:feedface";
    const acp = {
      backend: "acpx",
      agent: "codex",
      runtimeSessionName: "codex-discord",
      mode: "persistent" as const,
      state: "idle" as const,
      lastActivityAt: 100,
    };
    const { storePath } = await makeTmpStore({
      [key]: {
        sessionId: "sess-acp",
        updatedAt: 100,
        acp,
      },
    });

    await updateSessionStore(storePath, (store) => {
      store[key] = {
        sessionId: "sess-acp",
        updatedAt: 200,
        modelProvider: "openai-codex",
        model: "gpt-5.4",
      };
    });

    const store = loadSessionStore(storePath);
    expect(store[key]?.acp).toEqual(acp);
    expect(store[key]?.modelProvider).toBe("openai-codex");
    expect(store[key]?.model).toBe("gpt-5.4");
  });

  it("allows explicit ACP metadata removal through the ACP session helper", async () => {
    const key = "agent:codex:acp:binding:discord:default:deadbeef";
    const { storePath } = await makeTmpStore({
      [key]: {
        sessionId: "sess-acp-clear",
        updatedAt: 100,
        acp: {
          backend: "acpx",
          agent: "codex",
          runtimeSessionName: "codex-discord",
          mode: "persistent",
          state: "idle",
          lastActivityAt: 100,
        },
      },
    });
    const cfg = {
      session: {
        store: storePath,
      },
    } as OpenClawConfig;

    const result = await upsertAcpSessionMeta({
      cfg,
      sessionKey: key,
      mutate: () => null,
    });

    expect(result?.acp).toBeUndefined();
    const store = loadSessionStore(storePath);
    expect(store[key]?.acp).toBeUndefined();
  });
});

describe("appendTextMessagesToSessionTranscript", () => {
  const fixture = useTempSessionsFixture("transcript-test-");
  const sessionId = "test-session-id";
  const sessionKey = "test-session";

  function writeTranscriptStore() {
    fs.writeFileSync(
      fixture.storePath(),
      JSON.stringify({
        [sessionKey]: {
          sessionId,
          chatType: "direct",
          channel: "discord",
        },
      }),
      "utf-8",
    );
  }

  it("creates transcript file and appends message for valid session", async () => {
    writeTranscriptStore();

    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(fs.existsSync(result.sessionFile)).toBe(true);
      const sessionFileMode = fs.statSync(result.sessionFile).mode & 0o777;
      if (process.platform !== "win32") {
        expect(sessionFileMode).toBe(0o600);
      }

      const lines = fs.readFileSync(result.sessionFile, "utf-8").trim().split("\n");
      expect(lines.length).toBe(2);

      const header = JSON.parse(lines[0]);
      expect(header.type).toBe("session");
      expect(header.id).toBe(sessionId);

      const messageLine = JSON.parse(lines[1]);
      expect(messageLine.type).toBe("message");
      expect(messageLine.message.role).toBe("assistant");
      expect(messageLine.message.content[0].type).toBe("text");
      expect(messageLine.message.content[0].text).toBe("Hello from delivery mirror!");
    }
  });

  it("emits transcript update events for delivery mirrors", async () => {
    const sessionId = "test-session-id";
    const sessionKey = "test-session";
    const store = {
      [sessionKey]: {
        sessionId,
        chatType: "direct",
        channel: "discord",
      },
    };
    fs.writeFileSync(fixture.storePath(), JSON.stringify(store), "utf-8");
    const emitSpy = vi.spyOn(transcriptEvents, "emitSessionTranscriptUpdate");

    await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      storePath: fixture.storePath(),
    });

    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionFile,
        sessionKey,
        messageId: expect.any(String),
        message: expect.objectContaining({
          role: "assistant",
          provider: "openclaw",
          model: "delivery-mirror",
          content: [{ type: "text", text: "Hello from delivery mirror!" }],
        }),
      }),
    );
    emitSpy.mockRestore();
  });

  it("does not append a duplicate delivery mirror for the same idempotency key", async () => {
    writeTranscriptStore();

    await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      idempotencyKey: "mirror:test-source-message",
      storePath: fixture.storePath(),
    });
    await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      idempotencyKey: "mirror:test-source-message",
      storePath: fixture.storePath(),
    });

    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    const lines = fs.readFileSync(sessionFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);

    const messageLine = JSON.parse(lines[1]);
    expect(messageLine.message.idempotencyKey).toBe("mirror:test-source-message");
    expect(messageLine.message.content[0].text).toBe("Hello from delivery mirror!");
  });

  it("finds session entry using normalized (lowercased) key", async () => {
    const sessionId = "test-session-normalized";
    // Store key is lowercase (as written by updateSessionStore/normalizeStoreSessionKey)
    const storeKey = "agent:main:bluebubbles:direct:+15551234567";
    const store = {
      [storeKey]: {
        sessionId,
        chatType: "direct",
        channel: "bluebubbles",
      },
    };
    fs.writeFileSync(fixture.storePath(), JSON.stringify(store), "utf-8");

    // Pass a mixed-case key — append should still find the entry via normalization
    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey: "agent:main:BlueBubbles:direct:+15551234567",
      text: "Hello normalized!",
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
  });

  it("finds Slack session entry using normalized (lowercased) key", async () => {
    const sessionId = "test-slack-session";
    // Slack session keys include channel type and target ID; store key is lowercase
    const storeKey = "agent:main:slack:direct:u12345abc";
    const store = {
      [storeKey]: {
        sessionId,
        chatType: "direct",
        channel: "slack",
      },
    };
    fs.writeFileSync(fixture.storePath(), JSON.stringify(store), "utf-8");

    // Pass a mixed-case key (as resolveSlackSession might produce) — normalization should match
    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey: "agent:main:slack:direct:U12345ABC",
      text: "Hello Slack user!",
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
  });

  it("ignores malformed transcript lines when checking mirror idempotency", async () => {
    writeTranscriptStore();

    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    fs.writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "session",
          version: 1,
          id: sessionId,
          timestamp: new Date().toISOString(),
          cwd: process.cwd(),
        }),
        "{not-json",
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            idempotencyKey: "mirror:test-source-message",
            content: [{ type: "text", text: "Hello from delivery mirror!" }],
          },
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      idempotencyKey: "mirror:test-source-message",
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
    const lines = fs.readFileSync(sessionFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);
  });
});

describe("appendTextMessagesToSessionTranscript", () => {
  const fixture = useTempSessionsFixture("append-transcript-turn-test-");
  const sessionId = "test-session-id";
  const sessionKey = "test-session";

  function writeTranscriptStore() {
    const store = {
      [sessionKey]: {
        sessionId,
        chatType: "direct",
        channel: "discord",
        sessionFile: resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir()),
      },
    };
    fs.writeFileSync(fixture.storePath(), JSON.stringify(store), "utf-8");
  }

  it("appends normal user and assistant messages in order", async () => {
    writeTranscriptStore();

    const result = await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [
        { role: "user", text: "u-guest: hello there" },
        { role: "assistant", text: "General Kenobi" },
      ],
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
      const session = SessionManager.open(sessionFile);
      const messages = session.buildSessionContext().messages;
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: "user", content: "u-guest: hello there" });
      expect(messages[1]).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "General Kenobi" }],
      });
      const store = loadSessionStore(fixture.storePath(), { skipCache: true });
      expect(store[sessionKey]?.updatedAt).toBeTypeOf("number");
    }
  });

  it("emits transcript updates only after user-only batches are persisted", async () => {
    writeTranscriptStore();

    const observedMessages: Array<ReturnType<SessionManager["buildSessionContext"]>["messages"]> =
      [];
    const cleanup = transcriptEvents.onSessionTranscriptUpdate((update) => {
      observedMessages.push(SessionManager.open(update.sessionFile).buildSessionContext().messages);
    });

    try {
      const result = await appendTextMessagesToSessionTranscript({
        sessionKey,
        messages: [{ role: "user", text: "u-guest: hello there" }],
        storePath: fixture.storePath(),
      });

      expect(result.ok).toBe(true);
      expect(observedMessages).toHaveLength(1);
      expect(observedMessages[0]).toHaveLength(1);
      expect(observedMessages[0][0]).toMatchObject({
        role: "user",
        content: "u-guest: hello there",
      });
    } finally {
      cleanup();
    }
  });

  it("emits stable message sequences for batched transcript updates", async () => {
    writeTranscriptStore();

    const observedSeqs: number[] = [];
    const cleanup = transcriptEvents.onSessionTranscriptUpdate((update) => {
      if (typeof update.messageSeq === "number") {
        observedSeqs.push(update.messageSeq);
      }
    });

    try {
      const result = await appendTextMessagesToSessionTranscript({
        sessionKey,
        messages: [
          { role: "user", text: "u-guest: hello there" },
          { role: "assistant", text: "General Kenobi" },
        ],
        storePath: fixture.storePath(),
      });

      expect(result.ok).toBe(true);
      expect(observedSeqs).toEqual([1, 2]);
    } finally {
      cleanup();
    }
  });

  it("fails instead of reporting success when user-only transcript persistence never reaches disk", async () => {
    writeTranscriptStore();
    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      })}\n`,
      "utf-8",
    );

    const fakeSessionManager = {
      fileEntries: [{ type: "session" as const }],
      flushed: true,
      buildSessionContext: () => ({ messages: [] as unknown[] }),
      appendMessage: vi.fn((_message: unknown) => "msg-user-1"),
    };
    const openSpy = vi
      .spyOn(SessionManager, "open")
      .mockReturnValueOnce(fakeSessionManager as never);

    try {
      const result = await appendTextMessagesToSessionTranscript({
        sessionKey,
        messages: [{ role: "user", text: "u-guest: hello there" }],
        storePath: fixture.storePath(),
      });

      expect(result).toEqual({ ok: false, reason: "transcript persistence incomplete" });
    } finally {
      openSpy.mockRestore();
    }
  });

  it("returns success when transcript append lands but session store touch fails", async () => {
    writeTranscriptStore();
    const updateSpy = vi
      .spyOn(storeModule, "updateSessionStore")
      .mockRejectedValueOnce(new Error("store write failed"));

    const result = await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [
        { role: "user", text: "u-guest: hello there" },
        { role: "assistant", text: "General Kenobi" },
      ],
      storePath: fixture.storePath(),
    });

    expect(result).toMatchObject({ ok: true });
    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    const session = SessionManager.open(sessionFile);
    expect(session.buildSessionContext().messages).toHaveLength(2);
    updateSpy.mockRestore();
  });

  it("only patches updatedAt during the best-effort session store touch", async () => {
    writeTranscriptStore();
    let patchedStore: Record<string, SessionEntry> | undefined;
    const updateSpy = vi
      .spyOn(storeModule, "updateSessionStore")
      .mockImplementationOnce(async (_storePath, updateFn) => {
        const nextStore = {
          [sessionKey]: {
            sessionId,
            updatedAt: 10,
            model: "fresh-model",
            channel: "discord",
          },
        } satisfies Record<string, SessionEntry>;
        await updateFn(nextStore);
        patchedStore = nextStore;
        return nextStore[sessionKey];
      });

    await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [
        { role: "user", text: "u-guest: hello there" },
        { role: "assistant", text: "General Kenobi" },
      ],
      storePath: fixture.storePath(),
    });

    expect(patchedStore?.[sessionKey]?.model).toBe("fresh-model");
    expect((patchedStore?.[sessionKey]?.updatedAt ?? 0) > 10).toBe(true);
    updateSpy.mockRestore();
  });

  it("avoids duplicating transcript tail when retrying after a partial append", async () => {
    writeTranscriptStore();
    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    const session = SessionManager.open(sessionFile);
    session.appendMessage({
      role: "user",
      content: "u-guest: hello there",
      timestamp: 1,
    });

    const result = await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [
        { role: "user", text: "u-guest: hello there" },
        { role: "assistant", text: "General Kenobi" },
      ],
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
    const messages = SessionManager.open(sessionFile).buildSessionContext().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "u-guest: hello there" });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "General Kenobi" }],
    });
  });

  it("preserves user-only history when a later assistant-only batch lands", async () => {
    writeTranscriptStore();
    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());

    await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [{ role: "user", text: "u-guest: hello there" }],
      storePath: fixture.storePath(),
    });

    const result = await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [{ role: "assistant", text: "General Kenobi" }],
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
    const messages = SessionManager.open(sessionFile).buildSessionContext().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "u-guest: hello there" });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "General Kenobi" }],
    });
  });

  it("persists multiple user-only batches before any assistant reply", async () => {
    writeTranscriptStore();
    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());

    await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [{ role: "user", text: "u-guest: hello there" }],
      storePath: fixture.storePath(),
    });

    const result = await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [{ role: "user", text: "u-guest: are you still there?" }],
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
    const messages = SessionManager.open(sessionFile).buildSessionContext().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "u-guest: hello there" });
    expect(messages[1]).toMatchObject({
      role: "user",
      content: "u-guest: are you still there?",
    });
    const lines = fs.readFileSync(sessionFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
  });

  it("skips keyed transcript messages already present even after unrelated interleaving writes", async () => {
    writeTranscriptStore();
    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());

    await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [{ role: "user", text: "u-guest: hello there", idempotencyKey: "turn-1:user" }],
      storePath: fixture.storePath(),
    });
    await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [{ role: "assistant", text: "Interleaved other surface reply" }],
      storePath: fixture.storePath(),
    });

    const result = await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [
        { role: "user", text: "u-guest: hello there", idempotencyKey: "turn-1:user" },
        {
          role: "assistant",
          text: "General Kenobi",
          idempotencyKey: "turn-1:assistant",
        },
      ],
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
    const messages = SessionManager.open(sessionFile).buildSessionContext().messages;
    expect(messages).toHaveLength(3);
    expect(
      messages.filter(
        (message) => message.role === "user" && message.content === "u-guest: hello there",
      ),
    ).toHaveLength(1);
    expect(messages).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "Interleaved other surface reply" }],
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "General Kenobi" }],
      }),
    );
  });

  it("dedupes repeated keyed messages within a batch after normalizing idempotency keys", async () => {
    writeTranscriptStore();
    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());

    const result = await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [
        { role: "assistant", text: "General Kenobi", idempotencyKey: " turn-1:assistant " },
        { role: "assistant", text: "General Kenobi", idempotencyKey: "turn-1:assistant" },
      ],
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
    const messages = SessionManager.open(sessionFile).buildSessionContext().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "General Kenobi" }],
      idempotencyKey: "turn-1:assistant",
    });
  });

  it("serializes concurrent keyed batches for the same session", async () => {
    writeTranscriptStore();
    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    const heldLock = await acquireSessionWriteLock({ sessionFile, allowReentrant: false });

    try {
      const firstAppend = appendTextMessagesToSessionTranscript({
        sessionKey,
        messages: [
          { role: "assistant", text: "General Kenobi", idempotencyKey: "turn-1:assistant" },
        ],
        storePath: fixture.storePath(),
      });
      const secondAppend = appendTextMessagesToSessionTranscript({
        sessionKey,
        messages: [
          { role: "assistant", text: "General Kenobi", idempotencyKey: "turn-1:assistant" },
        ],
        storePath: fixture.storePath(),
      });

      await Promise.resolve();
      await heldLock.release();

      const results = await Promise.all([firstAppend, secondAppend]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(
        results
          .map((result) => (result.ok ? result.messageIds.length : -1))
          .toSorted((a, b) => a - b),
      ).toEqual([0, 1]);
      const messages = SessionManager.open(sessionFile).buildSessionContext().messages;
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "General Kenobi" }],
        idempotencyKey: "turn-1:assistant",
      });
    } finally {
      await heldLock.release();
    }
  });

  it("does not touch updatedAt when a fully deduped keyed batch appends nothing", async () => {
    writeTranscriptStore();

    await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [{ role: "assistant", text: "General Kenobi", idempotencyKey: "turn-1:assistant" }],
      storePath: fixture.storePath(),
    });

    const store = loadSessionStore(fixture.storePath(), { skipCache: true });
    if (!store[sessionKey]) {
      throw new Error("missing session entry");
    }
    store[sessionKey].updatedAt = 10;
    fs.writeFileSync(fixture.storePath(), JSON.stringify(store), "utf-8");

    const result = await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [{ role: "assistant", text: "General Kenobi", idempotencyKey: "turn-1:assistant" }],
      storePath: fixture.storePath(),
    });

    expect(result).toMatchObject({ ok: true, messageIds: [] });
    expect(loadSessionStore(fixture.storePath(), { skipCache: true })[sessionKey]?.updatedAt).toBe(
      10,
    );
  });

  it("does not touch updatedAt when a fully overlapping unkeyed batch appends nothing", async () => {
    writeTranscriptStore();

    await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [
        { role: "user", text: "u-guest: hello there" },
        { role: "assistant", text: "General Kenobi" },
      ],
      storePath: fixture.storePath(),
    });

    const store = loadSessionStore(fixture.storePath(), { skipCache: true });
    if (!store[sessionKey]) {
      throw new Error("missing session entry");
    }
    store[sessionKey].updatedAt = 10;
    fs.writeFileSync(fixture.storePath(), JSON.stringify(store), "utf-8");

    const result = await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [
        { role: "user", text: "u-guest: hello there" },
        { role: "assistant", text: "General Kenobi" },
      ],
      storePath: fixture.storePath(),
    });

    expect(result).toMatchObject({ ok: true, messageIds: [] });
    expect(loadSessionStore(fixture.storePath(), { skipCache: true })[sessionKey]?.updatedAt).toBe(
      10,
    );
  });

  it("rejects mixed keyed and unkeyed transcript batches", async () => {
    writeTranscriptStore();

    const result = await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [
        { role: "user", text: "plain hello" },
        { role: "assistant", text: "keyed later", idempotencyKey: "late-key" },
      ],
      storePath: fixture.storePath(),
    });

    expect(result).toEqual({
      ok: false,
      reason: "mixed keyed and unkeyed transcript batches are not supported",
    });
  });
});

describe("appendAssistantMessageToSessionTranscript", () => {
  const fixture = useTempSessionsFixture("transcript-test-");
  const sessionId = "test-session-id";
  const sessionKey = "test-session";

  function writeTranscriptStore() {
    fs.writeFileSync(
      fixture.storePath(),
      JSON.stringify({
        [sessionKey]: {
          sessionId,
          chatType: "direct",
          channel: "discord",
        },
      }),
      "utf-8",
    );
  }

  it("creates transcript file and appends message for valid session", async () => {
    writeTranscriptStore();

    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(fs.existsSync(result.sessionFile)).toBe(true);
      const sessionFileMode = fs.statSync(result.sessionFile).mode & 0o777;
      if (process.platform !== "win32") {
        expect(sessionFileMode).toBe(0o600);
      }

      const lines = fs.readFileSync(result.sessionFile, "utf-8").trim().split("\n");
      expect(lines.length).toBe(2);

      const header = JSON.parse(lines[0]);
      expect(header.type).toBe("session");
      expect(header.id).toBe(sessionId);

      const messageLine = JSON.parse(lines[1]);
      expect(messageLine.type).toBe("message");
      expect(messageLine.message.role).toBe("assistant");
      expect(messageLine.message.content[0].type).toBe("text");
      expect(messageLine.message.content[0].text).toBe("Hello from delivery mirror!");
    }
  });

  it("emits transcript update events for delivery mirrors", async () => {
    const sessionId = "test-session-id";
    const sessionKey = "test-session";
    const store = {
      [sessionKey]: {
        sessionId,
        chatType: "direct",
        channel: "discord",
      },
    };
    fs.writeFileSync(fixture.storePath(), JSON.stringify(store), "utf-8");
    const emitSpy = vi.spyOn(transcriptEvents, "emitSessionTranscriptUpdate");

    await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      storePath: fixture.storePath(),
    });

    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionFile,
        sessionKey,
        messageId: expect.any(String),
        message: expect.objectContaining({
          role: "assistant",
          provider: "openclaw",
          model: "delivery-mirror",
          content: [{ type: "text", text: "Hello from delivery mirror!" }],
        }),
      }),
    );
    emitSpy.mockRestore();
  });

  it("preserves pre-existing user messages when appending the first assistant mirror", async () => {
    writeTranscriptStore();

    const seeded = await appendTextMessagesToSessionTranscript({
      sessionKey,
      messages: [{ role: "user", text: "u-guest: hello there" }],
      storePath: fixture.storePath(),
    });
    expect(seeded.ok).toBe(true);

    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "General Kenobi",
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
    const messages = SessionManager.open(sessionFile).buildSessionContext().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "u-guest: hello there" });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "General Kenobi" }],
    });
  });

  it("does not append a duplicate delivery mirror for the same idempotency key", async () => {
    writeTranscriptStore();

    await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      idempotencyKey: "mirror:test-source-message",
      storePath: fixture.storePath(),
    });
    await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      idempotencyKey: "mirror:test-source-message",
      storePath: fixture.storePath(),
    });

    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    const lines = fs.readFileSync(sessionFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);

    const messageLine = JSON.parse(lines[1]);
    expect(messageLine.message.idempotencyKey).toBe("mirror:test-source-message");
    expect(messageLine.message.content[0].text).toBe("Hello from delivery mirror!");
  });

  it("emits concurrent delivery mirrors in transcript order", async () => {
    writeTranscriptStore();
    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    const heldLock = await acquireSessionWriteLock({ sessionFile, allowReentrant: false });
    const observedTexts: string[] = [];
    const cleanup = transcriptEvents.onSessionTranscriptUpdate((update) => {
      const text =
        update.message &&
        typeof update.message === "object" &&
        Array.isArray((update.message as { content?: unknown }).content)
          ? ((update.message as { content: Array<{ text?: string }> }).content[0]?.text ?? "")
          : "";
      if (text) {
        observedTexts.push(text);
      }
    });

    try {
      const firstAppend = appendAssistantMessageToSessionTranscript({
        sessionKey,
        text: "First mirror",
        storePath: fixture.storePath(),
      });
      const secondAppend = appendAssistantMessageToSessionTranscript({
        sessionKey,
        text: "Second mirror",
        storePath: fixture.storePath(),
      });

      await Promise.resolve();
      await heldLock.release();

      const [firstResult, secondResult] = await Promise.all([firstAppend, secondAppend]);
      expect(firstResult.ok).toBe(true);
      expect(secondResult.ok).toBe(true);
      expect(observedTexts).toEqual(["First mirror", "Second mirror"]);
    } finally {
      cleanup();
      await heldLock.release();
    }
  });

  it("serializes concurrent delivery mirrors for the same idempotency key", async () => {
    writeTranscriptStore();
    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    const heldLock = await acquireSessionWriteLock({ sessionFile, allowReentrant: false });

    try {
      const firstAppend = appendAssistantMessageToSessionTranscript({
        sessionKey,
        text: "Hello from delivery mirror!",
        idempotencyKey: "mirror:test-source-message",
        storePath: fixture.storePath(),
      });
      const secondAppend = appendAssistantMessageToSessionTranscript({
        sessionKey,
        text: "Hello from delivery mirror!",
        idempotencyKey: "mirror:test-source-message",
        storePath: fixture.storePath(),
      });

      await Promise.resolve();
      await heldLock.release();

      const [firstResult, secondResult] = await Promise.all([firstAppend, secondAppend]);
      expect(firstResult.ok).toBe(true);
      expect(secondResult.ok).toBe(true);
      if (!firstResult.ok || !secondResult.ok) {
        throw new Error("expected both mirror appends to succeed");
      }
      expect(secondResult.messageId).toBe(firstResult.messageId);
      const lines = fs.readFileSync(sessionFile, "utf-8").trim().split("\n");
      expect(lines.length).toBe(2);
    } finally {
      await heldLock.release();
    }
  });

  it("does not refresh updatedAt when a delivery mirror dedupes to an existing message", async () => {
    writeTranscriptStore();

    const first = await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      idempotencyKey: "mirror:test-source-message",
      storePath: fixture.storePath(),
    });
    expect(first.ok).toBe(true);

    const store = loadSessionStore(fixture.storePath(), { skipCache: true });
    if (!store[sessionKey]) {
      throw new Error("missing session entry");
    }
    store[sessionKey].updatedAt = 10;
    fs.writeFileSync(fixture.storePath(), JSON.stringify(store), "utf-8");

    const second = await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      idempotencyKey: "mirror:test-source-message",
      storePath: fixture.storePath(),
    });

    expect(second.ok).toBe(true);
    expect(loadSessionStore(fixture.storePath(), { skipCache: true })[sessionKey]?.updatedAt).toBe(
      10,
    );
  });

  it("normalizes delivery mirror idempotency keys before duplicate checks", async () => {
    writeTranscriptStore();

    await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      idempotencyKey: " mirror:test-source-message ",
      storePath: fixture.storePath(),
    });
    await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      idempotencyKey: "mirror:test-source-message",
      storePath: fixture.storePath(),
    });

    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    const lines = fs.readFileSync(sessionFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);

    const messageLine = JSON.parse(lines[1]);
    expect(messageLine.message.idempotencyKey).toBe("mirror:test-source-message");
  });

  it("finds session entry using normalized (lowercased) key", async () => {
    const sessionId = "test-session-normalized";
    // Store key is lowercase (as written by updateSessionStore/normalizeStoreSessionKey)
    const storeKey = "agent:main:bluebubbles:direct:+15551234567";
    const store = {
      [storeKey]: {
        sessionId,
        chatType: "direct",
        channel: "bluebubbles",
      },
    };
    fs.writeFileSync(fixture.storePath(), JSON.stringify(store), "utf-8");

    // Pass a mixed-case key — append should still find the entry via normalization
    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey: "agent:main:BlueBubbles:direct:+15551234567",
      text: "Hello normalized!",
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
  });

  it("finds Slack session entry using normalized (lowercased) key", async () => {
    const sessionId = "test-slack-session";
    // Slack session keys include channel type and target ID; store key is lowercase
    const storeKey = "agent:main:slack:direct:u12345abc";
    const store = {
      [storeKey]: {
        sessionId,
        chatType: "direct",
        channel: "slack",
      },
    };
    fs.writeFileSync(fixture.storePath(), JSON.stringify(store), "utf-8");

    // Pass a mixed-case key (as resolveSlackSession might produce) — normalization should match
    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey: "agent:main:slack:direct:U12345ABC",
      text: "Hello Slack user!",
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
  });

  it("ignores malformed transcript lines when checking mirror idempotency", async () => {
    writeTranscriptStore();

    const sessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());
    fs.writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "session",
          version: 1,
          id: sessionId,
          timestamp: new Date().toISOString(),
          cwd: process.cwd(),
        }),
        "{not-json",
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            idempotencyKey: "mirror:test-source-message",
            content: [{ type: "text", text: "Hello from delivery mirror!" }],
          },
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      idempotencyKey: "mirror:test-source-message",
      storePath: fixture.storePath(),
    });

    expect(result.ok).toBe(true);
    const messages = SessionManager.open(sessionFile).buildSessionContext().messages;
    expect(messages).toHaveLength(2);
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Hello from delivery mirror!" }],
      idempotencyKey: "mirror:test-source-message",
    });
  });
});

describe("resolveAndPersistSessionFile", () => {
  const fixture = useTempSessionsFixture("session-file-test-");

  it("persists fallback topic transcript paths for sessions without sessionFile", async () => {
    const sessionId = "topic-session-id";
    const sessionKey = "agent:main:telegram:group:123:topic:456";
    const store = {
      [sessionKey]: {
        sessionId,
        updatedAt: Date.now(),
      },
    };
    fs.writeFileSync(fixture.storePath(), JSON.stringify(store), "utf-8");
    const sessionStore = loadSessionStore(fixture.storePath(), { skipCache: true });
    const fallbackSessionFile = resolveSessionTranscriptPathInDir(
      sessionId,
      fixture.sessionsDir(),
      456,
    );

    const result = await resolveAndPersistSessionFile({
      sessionId,
      sessionKey,
      sessionStore,
      storePath: fixture.storePath(),
      sessionEntry: sessionStore[sessionKey],
      fallbackSessionFile,
    });

    expect(result.sessionFile).toBe(fallbackSessionFile);

    const saved = loadSessionStore(fixture.storePath(), { skipCache: true });
    expect(saved[sessionKey]?.sessionFile).toBe(fallbackSessionFile);
  });

  it("normalizes mixed-case keys when persisting the resolved session file", async () => {
    const sessionId = "mixed-case-session-id";
    const storeKey = "agent:main:bluebubbles:direct:+15551234567";
    fs.writeFileSync(
      fixture.storePath(),
      JSON.stringify({
        [storeKey]: {
          sessionId,
          updatedAt: Date.now(),
        },
      }),
      "utf-8",
    );
    const sessionStore = loadSessionStore(fixture.storePath(), { skipCache: true });
    const fallbackSessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());

    await resolveAndPersistSessionFile({
      sessionId,
      sessionKey: "agent:main:BlueBubbles:direct:+15551234567",
      sessionStore,
      storePath: fixture.storePath(),
      sessionEntry: sessionStore[storeKey],
      fallbackSessionFile,
    });

    const saved = loadSessionStore(fixture.storePath(), { skipCache: true });
    expect(Object.keys(saved)).toEqual([storeKey]);
    expect(saved[storeKey]?.sessionFile).toBe(fallbackSessionFile);
  });

  it("creates and persists entry when session is not yet present", async () => {
    const sessionId = "new-session-id";
    const sessionKey = "agent:main:telegram:group:123";
    fs.writeFileSync(fixture.storePath(), JSON.stringify({}), "utf-8");
    const sessionStore = loadSessionStore(fixture.storePath(), { skipCache: true });
    const fallbackSessionFile = resolveSessionTranscriptPathInDir(sessionId, fixture.sessionsDir());

    const result = await resolveAndPersistSessionFile({
      sessionId,
      sessionKey,
      sessionStore,
      storePath: fixture.storePath(),
      fallbackSessionFile,
    });

    expect(result.sessionFile).toBe(fallbackSessionFile);
    expect(result.sessionEntry.sessionId).toBe(sessionId);
    const saved = loadSessionStore(fixture.storePath(), { skipCache: true });
    expect(saved[sessionKey]?.sessionFile).toBe(fallbackSessionFile);
  });
});
