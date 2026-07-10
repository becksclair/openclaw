import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../config/sessions.js";

const mocks = vi.hoisted(() => ({
  getSessionEntry: vi.fn(),
  readRecentSessionMessagesWithStatsAsync: vi.fn(),
  projectRecentChatDisplayMessages: vi.fn(),
  listSessionCompactionCheckpoints: vi.fn(),
  getCompactionProvider: vi.fn(),
}));

vi.mock("../config/sessions.js", async () => {
  const actual =
    await vi.importActual<typeof import("../config/sessions.js")>("../config/sessions.js");
  return {
    ...actual,
    getSessionEntry: mocks.getSessionEntry,
  };
});

vi.mock("../gateway/session-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../gateway/session-utils.js")>(
    "../gateway/session-utils.js",
  );
  return {
    ...actual,
    readRecentSessionMessagesWithStatsAsync: mocks.readRecentSessionMessagesWithStatsAsync,
  };
});

vi.mock("../gateway/chat-display-projection.js", async () => {
  const actual = await vi.importActual<typeof import("../gateway/chat-display-projection.js")>(
    "../gateway/chat-display-projection.js",
  );
  return {
    ...actual,
    projectRecentChatDisplayMessages: mocks.projectRecentChatDisplayMessages,
  };
});

vi.mock("../gateway/session-compaction-checkpoints.js", async () => {
  const actual = await vi.importActual<
    typeof import("../gateway/session-compaction-checkpoints.js")
  >("../gateway/session-compaction-checkpoints.js");
  return {
    ...actual,
    listSessionCompactionCheckpoints: mocks.listSessionCompactionCheckpoints,
  };
});

vi.mock("../plugins/compaction-provider.js", async () => {
  const actual = await vi.importActual<typeof import("../plugins/compaction-provider.js")>(
    "../plugins/compaction-provider.js",
  );
  return {
    ...actual,
    getCompactionProvider: mocks.getCompactionProvider,
  };
});

import { buildTalkRealtimeContextPacket } from "./realtime-context.js";

function sessionEntry(patch: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: "session-1",
    sessionFile: "session-1.jsonl",
    updatedAt: 1,
    modelProvider: "openai",
    model: "gpt-5.5",
    totalTokens: 42,
    totalTokensFresh: true,
    ...patch,
  } as SessionEntry;
}

function textMessage(role: string, text: string): Record<string, unknown> {
  return { role, content: [{ type: "text", text }] };
}

function mockRecent(messages: Array<Record<string, unknown>>, totalMessages = messages.length) {
  mocks.readRecentSessionMessagesWithStatsAsync.mockResolvedValue({
    messages,
    totalMessages,
    transcriptPath: "/tmp/session.jsonl",
  });
  mocks.projectRecentChatDisplayMessages.mockReturnValue(messages);
}

describe("buildTalkRealtimeContextPacket", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.getSessionEntry.mockReset();
    mocks.readRecentSessionMessagesWithStatsAsync.mockReset();
    mocks.projectRecentChatDisplayMessages.mockReset();
    mocks.listSessionCompactionCheckpoints.mockReset();
    mocks.getCompactionProvider.mockReset();
  });

  it("returns none when no current session entry exists", async () => {
    mocks.getSessionEntry.mockReturnValue(undefined);

    await expect(
      buildTalkRealtimeContextPacket({
        agentId: "main",
        sessionKey: "voice:main",
      }),
    ).resolves.toEqual({
      summarySource: "none",
      contextNote: "No current session context was found for voice:main.",
    });
  });

  it("includes bounded projected visible history and latest message-tool mirror", async () => {
    mocks.getSessionEntry.mockReturnValue(sessionEntry({ totalTokens: 50 }));
    mocks.listSessionCompactionCheckpoints.mockReturnValue([]);
    const messages = [
      textMessage("user", "older user request"),
      textMessage("assistant", "older assistant reply"),
      {
        ...textMessage("assistant", "sent through message tool"),
        openclawMessageToolMirror: { toolName: "message", toolCallId: "call-1" },
      },
      textMessage("user", "latest user request"),
    ];
    mockRecent(messages, 20);

    const result = await buildTalkRealtimeContextPacket({
      agentId: "main",
      sessionKey: "voice:main",
      maxRecentMessages: 2,
    });

    expect(result.summarySource).toBe("none");
    expect(result.text).toContain("Session metadata:");
    expect(result.text).toContain("Session: current OpenClaw session");
    expect(result.text).not.toContain("voice:main");
    expect(result.text).toContain("Tokens: 50 (fresh)");
    expect(result.text).toContain(
      "Latest message-tool delivery:\nassistant: sent through message tool",
    );
    expect(result.text).toContain("assistant: sent through message tool");
    expect(result.text).toContain("user: latest user request");
    expect(result.text).not.toContain("older user request");
    expect(mocks.readRecentSessionMessagesWithStatsAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", sessionFile: "session-1.jsonl" }),
      expect.objectContaining({ allowResetArchiveFallback: true }),
    );
    expect(mocks.projectRecentChatDisplayMessages).toHaveBeenCalledWith(
      messages,
      expect.objectContaining({ maxChars: expect.any(Number) }),
    );
  });

  it("uses the latest usable compaction summary for over-threshold sessions", async () => {
    mocks.getSessionEntry.mockReturnValue(sessionEntry({ totalTokens: 100_001 }));
    mocks.listSessionCompactionCheckpoints.mockReturnValue([
      { checkpointId: "new", createdAt: 2, summary: "latest compacted context" },
      { checkpointId: "old", createdAt: 1, summary: "older context" },
    ]);
    mockRecent([textMessage("user", "current tail")], 30);

    const result = await buildTalkRealtimeContextPacket({
      agentId: "main",
      sessionKey: "voice:main",
    });

    expect(result.summarySource).toBe("compaction");
    expect(result.degraded).toBeUndefined();
    expect(result.text).toContain("latest compacted context");
    expect(result.text).toContain("current tail");
  });

  it("uses an injected fast summary when no compaction summary exists", async () => {
    mocks.getSessionEntry.mockReturnValue(sessionEntry({ totalTokens: 100_001 }));
    mocks.listSessionCompactionCheckpoints.mockReturnValue([]);
    const tailMessages = [textMessage("user", "large session tail")];
    const summaryMessages = [textMessage("system", "important early decision"), ...tailMessages];
    mocks.readRecentSessionMessagesWithStatsAsync
      .mockResolvedValueOnce({
        messages: tailMessages,
        totalMessages: 30,
        transcriptPath: "/tmp/session.jsonl",
      })
      .mockResolvedValueOnce({
        messages: summaryMessages,
        totalMessages: 30,
        transcriptPath: "/tmp/session.jsonl",
      });
    mocks.projectRecentChatDisplayMessages.mockImplementation((messages) => messages);
    const fastSummarize = vi.fn().mockResolvedValue("fast generated summary");

    const result = await buildTalkRealtimeContextPacket({
      agentId: "main",
      sessionKey: "voice:main",
      fastSummarize,
    });

    expect(result.summarySource).toBe("fast-summary");
    expect(result.text).toContain("fast generated summary");
    expect(fastSummarize).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: summaryMessages,
        recentTail: tailMessages,
        totalTokens: 100_001,
        totalMessages: 30,
      }),
    );
    expect(mocks.readRecentSessionMessagesWithStatsAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sessionId: "session-1", sessionFile: "session-1.jsonl" }),
      expect.objectContaining({ maxMessages: 200, maxBytes: 2_000_000 }),
    );
  });

  it("uses the configured compaction provider as production fast summary", async () => {
    mocks.getSessionEntry.mockReturnValue(sessionEntry({ totalTokens: 100_001 }));
    mocks.listSessionCompactionCheckpoints.mockReturnValue([]);
    const messages = [textMessage("user", "large session tail")];
    mockRecent(messages, 30);
    const summarize = vi.fn().mockResolvedValue("provider generated summary");
    mocks.getCompactionProvider.mockReturnValue({
      id: "quick-summary",
      label: "Quick Summary",
      summarize,
    });

    const result = await buildTalkRealtimeContextPacket({
      cfg: {
        agents: {
          defaults: {
            compaction: {
              provider: "quick-summary",
              identifierPolicy: "custom",
              identifierInstructions: "Keep ids exact.",
            },
          },
        },
      },
      agentId: "main",
      sessionKey: "voice:main",
    });

    expect(result.summarySource).toBe("fast-summary");
    expect(result.text).toContain("provider generated summary");
    expect(mocks.getCompactionProvider).toHaveBeenCalledWith("quick-summary");
    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
        compressionRatio: 0.2,
        summarizationInstructions: {
          identifierPolicy: "custom",
          identifierInstructions: "Keep ids exact.",
        },
      }),
    );
  });

  it("labels stale over-threshold token counts as degraded summary context", async () => {
    mocks.getSessionEntry.mockReturnValue(
      sessionEntry({ totalTokens: 100_001, totalTokensFresh: false }),
    );
    mocks.listSessionCompactionCheckpoints.mockReturnValue([]);
    mockRecent([textMessage("user", "large session tail")], 30);

    const result = await buildTalkRealtimeContextPacket({
      agentId: "main",
      sessionKey: "voice:main",
      fastSummarize: vi.fn().mockResolvedValue("summary from stale count"),
    });

    expect(result.summarySource).toBe("fast-summary");
    expect(result.text).toContain(
      "Fresh token stats were unavailable; summary mode is using the stored session token count.",
    );
    expect(result.text).toContain("Tokens: 100001 (stale)");
  });

  it("falls back to a degraded last-10 projected summary when fast summary fails", async () => {
    mocks.getSessionEntry.mockReturnValue(sessionEntry({ totalTokens: 100_001 }));
    mocks.listSessionCompactionCheckpoints.mockReturnValue([]);
    const messages = Array.from({ length: 12 }, (_, index) =>
      textMessage(index % 2 === 0 ? "user" : "assistant", `visible ${index + 1}`),
    );
    mockRecent(messages, 12);

    const result = await buildTalkRealtimeContextPacket({
      agentId: "main",
      sessionKey: "voice:main",
      maxRecentMessages: 3,
      fastSummarize: vi.fn().mockRejectedValue(new Error("summary failed")),
    });

    expect(result.summarySource).toBe("last-10-fallback");
    expect(result.degraded).toBe(true);
    expect(result.contextNote).toContain("too large to include in full");
    expect(result.text).toContain("Recent session fallback summary:");
    expect(result.text).not.toContain("user: visible 1\n\n");
    expect(result.text).not.toContain("assistant: visible 2\n\n");
    expect(result.text).toContain("visible 3");
    expect(result.text).toContain("visible 12");
    expect(result.text).toContain("Recent visible history:");
    expect(result.text).toContain("visible 10");
  });

  it("labels stale token counts in degraded last-10 fallback context", async () => {
    mocks.getSessionEntry.mockReturnValue(
      sessionEntry({ totalTokens: 100_001, totalTokensFresh: false }),
    );
    mocks.listSessionCompactionCheckpoints.mockReturnValue([]);
    mockRecent(
      Array.from({ length: 12 }, (_, index) =>
        textMessage(index % 2 === 0 ? "user" : "assistant", `visible ${index + 1}`),
      ),
      12,
    );

    const result = await buildTalkRealtimeContextPacket({
      agentId: "main",
      sessionKey: "voice:main",
      fastSummarize: vi.fn().mockRejectedValue(new Error("summary failed")),
    });

    expect(result.summarySource).toBe("last-10-fallback");
    expect(result.text).toContain("Tokens: 100001 (stale)");
  });

  it("falls back to recent-tail-only when no projected text can be summarized", async () => {
    mocks.getSessionEntry.mockReturnValue(
      sessionEntry({ totalTokens: 100_001, totalTokensFresh: false }),
    );
    mocks.listSessionCompactionCheckpoints.mockReturnValue([]);
    mockRecent([{ role: "assistant", content: [{ type: "image", url: "file://image.png" }] }], 1);

    const result = await buildTalkRealtimeContextPacket({
      agentId: "main",
      sessionKey: "voice:main",
      fastSummarize: vi.fn().mockResolvedValue(" "),
    });

    expect(result.summarySource).toBe("recent-tail-only");
    expect(result.degraded).toBe(true);
    expect(result.text).toContain("The current session is too large to include in full");
    expect(result.text).toContain("Session metadata:");
    expect(result.text).toContain("Tokens: 100001 (stale)");
  });
});
