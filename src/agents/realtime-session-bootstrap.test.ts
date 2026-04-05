import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { normalizeStoreSessionKey } from "../config/sessions/store.js";
import { resolveRealtimeSessionBootstrap } from "./realtime-session-bootstrap.js";

const tmpDirs: string[] = [];

async function createTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-realtime-bootstrap-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map(async (dir) => await fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("resolveRealtimeSessionBootstrap", () => {
  it("uses the configured agent workspace when no prior realtime session exists", async () => {
    const dir = await createTmpDir();
    const aliWorkspaceDir = path.join(dir, "workspace-ali");
    const storePath = path.join(dir, "sessions", "sessions.json");
    await fs.mkdir(aliWorkspaceDir, { recursive: true });
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(path.join(aliWorkspaceDir, "AGENTS.md"), "# Ali\nUse the ali workspace.\n");

    const result = await resolveRealtimeSessionBootstrap({
      cfg: {
        agents: {
          list: [{ id: "ali", workspace: aliWorkspaceDir }],
        },
      } as OpenClawConfig,
      agentId: "ali",
      sessionKey: "discord:g1:c1",
      provider: "openai",
      model: "gpt-realtime-1.5",
      transport: "discord",
      tools: [],
      storePath,
    });

    expect(result.workspaceDir).toBe(aliWorkspaceDir);
    expect(result.bootstrap.instructions).toContain("Use the ali workspace.");
    expect(result.bootstrap.history).toEqual([]);
  });

  it("prefers the configured agent workspace over the stored session cwd", async () => {
    const dir = await createTmpDir();
    const sessionWorkspaceDir = path.join(dir, "workspace");
    const aliWorkspaceDir = path.join(dir, "workspace-ali");
    const sessionsDir = path.join(dir, "sessions");
    const storePath = path.join(sessionsDir, "sessions.json");
    await fs.mkdir(sessionWorkspaceDir, { recursive: true });
    await fs.mkdir(aliWorkspaceDir, { recursive: true });
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(aliWorkspaceDir, "AGENTS.md"),
      "# Ali CWD\nUse the ali workspace.\n",
    );

    const session = SessionManager.create(sessionWorkspaceDir, sessionsDir);
    session.appendMessage({ role: "user", content: "Hello", timestamp: 1 });

    const sessionKey = "discord:g1:c1";
    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          [normalizeStoreSessionKey(sessionKey)]: {
            sessionId: session.getSessionId(),
            sessionFile: session.getSessionFile(),
            updatedAt: Date.now(),
          },
        },
        null,
        2,
      ),
    );

    const result = await resolveRealtimeSessionBootstrap({
      cfg: {
        agents: {
          list: [{ id: "ali-cwd", workspace: aliWorkspaceDir }],
        },
      } as OpenClawConfig,
      agentId: "ali-cwd",
      sessionKey,
      provider: "openai",
      model: "gpt-realtime-1.5",
      transport: "discord",
      tools: [],
      storePath,
    });

    expect(result.workspaceDir).toBe(aliWorkspaceDir);
    expect(result.bootstrap.history).toEqual([]);
  });

  it("builds instructions from workspace bootstrap files and seeds recent session history", async () => {
    const dir = await createTmpDir();
    const workspaceDir = path.join(dir, "workspace");
    const sessionsDir = path.join(dir, "sessions");
    const storePath = path.join(sessionsDir, "sessions.json");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "AGENTS.md"),
      "# Agent Rules\nAlways inspect the repo first.\n",
    );
    await fs.writeFile(
      path.join(workspaceDir, "SOUL.md"),
      "Voice: sharp, concise, and technical.\n",
    );

    const session = SessionManager.create(workspaceDir, sessionsDir);
    session.appendMessage({ role: "user", content: "First question", timestamp: 1 });
    session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "First answer" }],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-4.1",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop",
      timestamp: 2,
    });
    session.appendMessage({ role: "user", content: "Second question", timestamp: 3 });
    session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Second answer" }],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-4.1",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop",
      timestamp: 4,
    });

    const sessionKey = "discord:g1:c1";
    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          [normalizeStoreSessionKey(sessionKey)]: {
            sessionId: session.getSessionId(),
            sessionFile: session.getSessionFile(),
            updatedAt: Date.now(),
          },
        },
        null,
        2,
      ),
    );

    const result = await resolveRealtimeSessionBootstrap({
      cfg: {
        agents: {
          defaults: { workspace: workspaceDir },
        },
      } as OpenClawConfig,
      agentId: "main",
      sessionKey,
      provider: "openai",
      model: "gpt-realtime-1.5",
      transport: "discord",
      tools: [{ name: "read", description: "Read a file" }],
      storePath,
    });

    expect(result.workspaceDir).toBe(workspaceDir);
    expect(result.bootstrap.history).toEqual([
      { role: "user", text: "First question" },
      { role: "assistant", text: "First answer" },
      { role: "user", text: "Second question" },
      { role: "assistant", text: "Second answer" },
    ]);
  });
});
