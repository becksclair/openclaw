import {
  getSessionEntry,
  resolveFreshSessionTotalTokens,
  resolveSessionTotalTokens,
  type SessionEntry,
} from "../config/sessions.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { projectRecentChatDisplayMessages } from "../gateway/chat-display-projection.js";
import { listSessionCompactionCheckpoints } from "../gateway/session-compaction-checkpoints.js";
import { readRecentSessionMessagesWithStatsAsync } from "../gateway/session-utils.js";
import { getCompactionProvider } from "../plugins/compaction-provider.js";
import { extractTextFromChatContent } from "../shared/chat-content.js";

export type TalkRealtimeContextSummarySource =
  | "compaction"
  | "fast-summary"
  | "last-10-fallback"
  | "recent-tail-only"
  | "none";

export type TalkRealtimeContextPacket = {
  text?: string;
  summarySource?: TalkRealtimeContextSummarySource;
  degraded?: boolean;
  contextNote?: string;
  totalTokens?: number;
  totalMessages?: number;
};

export type TalkRealtimeFastSummary = (params: {
  messages: Array<Record<string, unknown>>;
  recentTail: Array<Record<string, unknown>>;
  entry: SessionEntry;
  totalTokens: number;
  totalMessages: number;
  signal?: AbortSignal;
}) => Promise<string | undefined>;

export type BuildTalkRealtimeContextPacketParams = {
  cfg?: OpenClawConfig;
  agentId: string;
  sessionKey: string;
  maxRecentMessages?: number;
  maxChars?: number;
  summaryThresholdTokens?: number;
  signal?: AbortSignal;
  storePath?: string;
  fastSummarize?: TalkRealtimeFastSummary;
};

const DEFAULT_MAX_RECENT_MESSAGES = 12;
const DEFAULT_MAX_CHARS = 12_000;
const DEFAULT_SUMMARY_THRESHOLD_TOKENS = 100_000;
const FALLBACK_SUMMARY_MESSAGES = 10;
const LATEST_MIRROR_SCAN_MESSAGES = 80;
const FAST_SUMMARY_MAX_MESSAGES = 200;
const MESSAGE_TEXT_MAX_CHARS = 1_500;

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeBoundedText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function resolveConfiguredCompactionProviderFastSummary(
  cfg: OpenClawConfig | undefined,
): TalkRealtimeFastSummary | undefined {
  const compaction = cfg?.agents?.defaults?.compaction;
  const providerId = normalizeBoundedText(compaction?.provider);
  if (!providerId) {
    return undefined;
  }
  const provider = getCompactionProvider(providerId);
  if (!provider) {
    return undefined;
  }
  return async (params) => {
    const summary = await provider.summarize({
      messages: params.messages,
      signal: params.signal,
      compressionRatio: 0.2,
      customInstructions:
        "Summarize the projected OpenClaw session context for a realtime voice assistant. " +
        "Preserve the current user request, recent decisions, active tasks, exact identifiers, " +
        "and any recent successful message-tool delivery context.",
      summarizationInstructions: {
        identifierPolicy: compaction?.identifierPolicy,
        identifierInstructions: compaction?.identifierInstructions,
      },
    });
    return normalizeBoundedText(summary);
  };
}

function capText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function readMessageText(message: Record<string, unknown>): string | undefined {
  const text = extractTextFromChatContent(message.content ?? message.text, {
    joinWith: "\n",
    normalizeText: (value) => value.trim(),
  });
  return normalizeBoundedText(text ?? undefined);
}

function readMessageRole(message: Record<string, unknown>): string {
  const role = message.role;
  return typeof role === "string" && role.trim() ? role.trim() : "message";
}

function renderMessageLine(message: Record<string, unknown>): string | undefined {
  const text = readMessageText(message);
  if (!text) {
    return undefined;
  }
  return `${readMessageRole(message)}: ${capText(text, MESSAGE_TEXT_MAX_CHARS)}`;
}

function renderMessages(messages: Array<Record<string, unknown>>): string | undefined {
  const rendered = messages.flatMap((message) => {
    const line = renderMessageLine(message);
    return line ? [line] : [];
  });
  return rendered.length > 0 ? rendered.join("\n\n") : undefined;
}

function latestMessageToolMirror(
  messages: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  return messages.findLast((message) => message.openclawMessageToolMirror !== undefined);
}

function latestCompactionSummary(entry: SessionEntry): string | undefined {
  for (const checkpoint of listSessionCompactionCheckpoints(entry)) {
    const summary = normalizeBoundedText(checkpoint.summary);
    if (summary) {
      return summary;
    }
  }
  return undefined;
}

function fallbackSummaryFromMessages(messages: Array<Record<string, unknown>>): string | undefined {
  const rendered = renderMessages(messages.slice(-FALLBACK_SUMMARY_MESSAGES));
  if (!rendered) {
    return undefined;
  }
  return ["Recent session fallback summary:", rendered].join("\n\n");
}

function resolveSessionTitle(entry: SessionEntry): string | undefined {
  const candidate = entry as SessionEntry & {
    title?: unknown;
    name?: unknown;
    firstUserMessage?: unknown;
  };
  return (
    normalizeBoundedText(candidate.title) ??
    normalizeBoundedText(candidate.name) ??
    normalizeBoundedText(candidate.firstUserMessage)
  );
}

function renderPacketText(params: {
  sessionKey: string;
  entry: SessionEntry;
  totalTokens?: number;
  totalTokensFresh: boolean;
  totalMessages: number;
  summary?: string;
  contextNote?: string;
  recentTail?: string;
  latestMirror?: string;
  maxChars: number;
}): string | undefined {
  const sessionTitle = resolveSessionTitle(params.entry);
  const metadata = [
    "Session: current OpenClaw session",
    ...(sessionTitle ? [`Title: ${sessionTitle}`] : []),
    ...(params.entry.modelProvider && params.entry.model
      ? [`Model: ${params.entry.modelProvider}/${params.entry.model}`]
      : params.entry.model
        ? [`Model: ${params.entry.model}`]
        : []),
    ...(params.totalTokens !== undefined
      ? [`Tokens: ${params.totalTokens} (${params.totalTokensFresh ? "fresh" : "stale"})`]
      : []),
    `Transcript messages: ${params.totalMessages}`,
  ].join("\n");

  const sections = [
    "Realtime session context",
    params.contextNote,
    `Session metadata:\n${metadata}`,
    params.summary ? `Session summary:\n${params.summary}` : undefined,
    params.latestMirror ? `Latest message-tool delivery:\n${params.latestMirror}` : undefined,
    params.recentTail ? `Recent visible history:\n${params.recentTail}` : undefined,
  ].filter((section): section is string => Boolean(section?.trim()));

  const text = sections.join("\n\n");
  return text ? capText(text, params.maxChars) : undefined;
}

export async function buildTalkRealtimeContextPacket(
  params: BuildTalkRealtimeContextPacketParams,
): Promise<TalkRealtimeContextPacket> {
  const maxRecentMessages = normalizePositiveInteger(
    params.maxRecentMessages,
    DEFAULT_MAX_RECENT_MESSAGES,
  );
  const maxChars = normalizePositiveInteger(params.maxChars, DEFAULT_MAX_CHARS);
  const summaryThresholdTokens = normalizePositiveInteger(
    params.summaryThresholdTokens,
    DEFAULT_SUMMARY_THRESHOLD_TOKENS,
  );

  const entry = getSessionEntry({
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    ...(params.storePath ? { storePath: params.storePath } : {}),
  });
  if (!entry) {
    return {
      summarySource: "none",
      contextNote: `No current session context was found for ${params.sessionKey}.`,
    };
  }

  const totalTokens = resolveSessionTotalTokens(entry);
  const freshTotalTokens = resolveFreshSessionTotalTokens(entry);
  const effectiveTotalTokens = freshTotalTokens ?? totalTokens;
  const overSummaryThreshold =
    effectiveTotalTokens !== undefined && effectiveTotalTokens > summaryThresholdTokens;
  const recent = await readRecentSessionMessagesWithStatsAsync(
    {
      agentId: params.agentId,
      sessionId: entry.sessionId,
      storePath: params.storePath,
      sessionFile: entry.sessionFile,
    },
    {
      maxMessages: Math.max(
        maxRecentMessages,
        FALLBACK_SUMMARY_MESSAGES,
        LATEST_MIRROR_SCAN_MESSAGES,
      ),
      maxBytes: 256_000,
      allowResetArchiveFallback: true,
    },
  );
  const projected = projectRecentChatDisplayMessages(recent.messages, {
    maxChars: MESSAGE_TEXT_MAX_CHARS,
  });
  const recentTail = projected.slice(-maxRecentMessages);
  const recentTailText = renderMessages(recentTail);
  const latestMirror = latestMessageToolMirror(projected);
  const latestMirrorText = latestMirror ? renderMessageLine(latestMirror) : undefined;
  const staleSummaryNote =
    overSummaryThreshold && freshTotalTokens === undefined
      ? "Fresh token stats were unavailable; summary mode is using the stored session token count."
      : undefined;

  if (!overSummaryThreshold) {
    return {
      text: renderPacketText({
        sessionKey: params.sessionKey,
        entry,
        totalTokens,
        totalTokensFresh: freshTotalTokens !== undefined,
        totalMessages: recent.totalMessages,
        latestMirror: latestMirrorText,
        recentTail: recentTailText,
        maxChars,
      }),
      summarySource: "none",
      totalTokens,
      totalMessages: recent.totalMessages,
    };
  }

  const compactionSummary = latestCompactionSummary(entry);
  if (compactionSummary) {
    return {
      text: renderPacketText({
        sessionKey: params.sessionKey,
        entry,
        totalTokens,
        totalTokensFresh: freshTotalTokens !== undefined,
        totalMessages: recent.totalMessages,
        contextNote: staleSummaryNote,
        summary: compactionSummary,
        latestMirror: latestMirrorText,
        recentTail: recentTailText,
        maxChars,
      }),
      summarySource: "compaction",
      totalTokens,
      totalMessages: recent.totalMessages,
    };
  }

  try {
    const fastSummarize =
      params.fastSummarize ?? resolveConfiguredCompactionProviderFastSummary(params.cfg);
    if (!fastSummarize) {
      throw new Error("No realtime fast summarizer configured");
    }
    const summaryRecent = await readRecentSessionMessagesWithStatsAsync(
      {
        agentId: params.agentId,
        sessionId: entry.sessionId,
        storePath: params.storePath,
        sessionFile: entry.sessionFile,
      },
      {
        maxMessages: Math.max(FAST_SUMMARY_MAX_MESSAGES, maxRecentMessages),
        maxBytes: 2_000_000,
        allowResetArchiveFallback: true,
      },
    );
    const summaryProjected = projectRecentChatDisplayMessages(summaryRecent.messages, {
      maxChars: MESSAGE_TEXT_MAX_CHARS,
    });
    const fastSummary = await fastSummarize({
      messages: summaryProjected,
      recentTail,
      entry,
      totalTokens: effectiveTotalTokens,
      totalMessages: recent.totalMessages,
      signal: params.signal,
    });
    const summary = normalizeBoundedText(fastSummary);
    if (summary) {
      return {
        text: renderPacketText({
          sessionKey: params.sessionKey,
          entry,
          totalTokens,
          totalTokensFresh: freshTotalTokens !== undefined,
          totalMessages: recent.totalMessages,
          contextNote: staleSummaryNote,
          summary,
          latestMirror: latestMirrorText,
          recentTail: recentTailText,
          maxChars,
        }),
        summarySource: "fast-summary",
        totalTokens,
        totalMessages: recent.totalMessages,
      };
    }
  } catch {
    // Realtime startup must not fail just because transient summary generation failed.
  }

  const fallbackSummary = fallbackSummaryFromMessages(projected);
  const contextNote = [
    staleSummaryNote,
    "The current session is too large to include in full; no compaction summary was available, so only recent projected context is included.",
  ]
    .filter((note): note is string => Boolean(note))
    .join(" ");
  if (fallbackSummary) {
    return {
      text: renderPacketText({
        sessionKey: params.sessionKey,
        entry,
        totalTokens,
        totalTokensFresh: freshTotalTokens !== undefined,
        totalMessages: recent.totalMessages,
        summary: fallbackSummary,
        contextNote,
        latestMirror: latestMirrorText,
        recentTail: recentTailText,
        maxChars,
      }),
      summarySource: "last-10-fallback",
      degraded: true,
      contextNote,
      totalTokens,
      totalMessages: recent.totalMessages,
    };
  }

  return {
    text: renderPacketText({
      sessionKey: params.sessionKey,
      entry,
      totalTokens,
      totalTokensFresh: freshTotalTokens !== undefined,
      totalMessages: recent.totalMessages,
      contextNote,
      recentTail: recentTailText,
      latestMirror: latestMirrorText,
      maxChars,
    }),
    summarySource: "recent-tail-only",
    degraded: true,
    contextNote,
    totalTokens,
    totalMessages: recent.totalMessages,
  };
}
