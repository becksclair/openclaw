import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { prepareSessionManagerForRun } from "./session-manager-init.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function createTempSessionFile(entries: unknown[]): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-manager-init-test-"));
  tempDirs.push(tempDir);
  const sessionFile = path.join(tempDir, "session.jsonl");
  fs.writeFileSync(
    sessionFile,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf-8",
  );
  return sessionFile;
}

function createAssistantMessage(
  text: string,
  timestamp: number,
): Parameters<SessionManager["appendMessage"]>[0] {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openclaw",
    model: "delivery-mirror",
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
    timestamp,
  };
}

describe("prepareSessionManagerForRun", () => {
  it("preserves existing user-only history before the first assistant reply", async () => {
    const sessionFile = createTempSessionFile([
      {
        type: "session",
        version: 3,
        id: "test-session-id",
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      },
      {
        type: "message",
        id: "user-1",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: "u-guest: hello there",
          timestamp: 1,
        },
      },
      {
        type: "message",
        id: "user-2",
        parentId: "user-1",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: "u-guest: are you still there?",
          timestamp: 2,
        },
      },
    ]);

    const sessionManager = SessionManager.open(sessionFile);
    await prepareSessionManagerForRun({
      sessionManager,
      sessionFile,
      hadSessionFile: true,
      sessionId: "test-session-id",
      cwd: process.cwd(),
    });

    sessionManager.appendMessage(createAssistantMessage("General Kenobi", 3));

    const messages = SessionManager.open(sessionFile).buildSessionContext().messages;
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ role: "user", content: "u-guest: hello there" });
    expect(messages[1]).toMatchObject({ role: "user", content: "u-guest: are you still there?" });
    expect(messages[2]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "General Kenobi" }],
    });
  });

  it("rewrites header-only files so the first assistant does not duplicate the header", async () => {
    const sessionFile = createTempSessionFile([
      {
        type: "session",
        version: 3,
        id: "test-session-id",
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      },
    ]);

    const sessionManager = SessionManager.open(sessionFile);
    await prepareSessionManagerForRun({
      sessionManager,
      sessionFile,
      hadSessionFile: true,
      sessionId: "test-session-id",
      cwd: process.cwd(),
    });

    sessionManager.appendMessage(createAssistantMessage("General Kenobi", 1));

    const lines = fs.readFileSync(sessionFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe("session");
    expect(JSON.parse(lines[1]).message.role).toBe("assistant");
  });
});
