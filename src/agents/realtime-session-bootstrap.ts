import { SessionManager, convertToLlm } from "@mariozechner/pi-coding-agent";
import type { OpenClawConfig } from "../config/config.js";
import { resolveDefaultSessionStorePath } from "../config/sessions/paths.js";
import { loadSessionStore, resolveSessionStoreEntry } from "../config/sessions/store.js";
import { resolveSessionTranscriptFile } from "../config/sessions/transcript.js";
import {
  mergeRealtimeHistoryItems,
  type RealtimeHistoryItem,
} from "../gateway/realtime-audio/history.js";
import type {
  RealtimeSessionBootstrap,
  RealtimeToolDefinition,
} from "../gateway/realtime-audio/types.js";
import { resolveAgentWorkspaceDir } from "./agent-scope.js";
import {
  getDmHistoryLimitFromSessionKey,
  limitHistoryTurns,
} from "./pi-embedded-runner/history.js";
import { buildRealtimeSessionInstructions } from "./realtime-session-prompt-seam.js";

const DEFAULT_REALTIME_HISTORY_USER_TURNS = 2;

export type ResolvedRealtimeSessionBootstrap = {
  workspaceDir: string;
  sessionFile?: string;
  bootstrap: RealtimeSessionBootstrap;
};

function extractMessageText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function resolveSessionWorkspaceAndHistory(params: {
  cfg: OpenClawConfig;
  agentId: string;
  sessionKey: string;
  storePath?: string;
}): Promise<{ workspaceDir: string; sessionFile?: string; history: RealtimeHistoryItem[] }> {
  const agentWorkspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);
  const storePath = params.storePath ?? resolveDefaultSessionStorePath(params.agentId);
  const store = loadSessionStore(storePath, { skipCache: true });
  const { existing: sessionEntry } = resolveSessionStoreEntry({
    store,
    sessionKey: params.sessionKey,
  });
  if (!sessionEntry?.sessionId) {
    return {
      workspaceDir: agentWorkspaceDir,
      history: [],
    };
  }

  const resolvedSession = await resolveSessionTranscriptFile({
    sessionId: sessionEntry.sessionId,
    sessionKey: params.sessionKey,
    sessionEntry,
    sessionStore: store,
    storePath,
    agentId: params.agentId,
  });
  const sessionManager = SessionManager.open(resolvedSession.sessionFile);
  const workspaceDir = agentWorkspaceDir;
  const sessionContext = sessionManager.buildSessionContext();
  const configuredHistoryLimit = getDmHistoryLimitFromSessionKey(params.sessionKey, params.cfg);
  const userTurnLimit =
    configuredHistoryLimit && configuredHistoryLimit > 0
      ? Math.min(configuredHistoryLimit, DEFAULT_REALTIME_HISTORY_USER_TURNS)
      : DEFAULT_REALTIME_HISTORY_USER_TURNS;
  const boundedMessages = limitHistoryTurns(sessionContext.messages, userTurnLimit);
  const history = mergeRealtimeHistoryItems(
    [],
    convertToLlm(boundedMessages).flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") {
        return [];
      }
      const text = extractMessageText(message);
      return text
        ? [
            {
              role: message.role,
              text,
            },
          ]
        : [];
    }),
  );

  return {
    workspaceDir,
    sessionFile: resolvedSession.sessionFile,
    history,
  };
}

export async function resolveRealtimeSessionBootstrap(params: {
  cfg: OpenClawConfig;
  agentId: string;
  sessionKey: string;
  senderIsOwner?: boolean;
  provider: string;
  model: string;
  transport: "desktop" | "discord" | "test";
  tools: RealtimeToolDefinition[];
  storePath?: string;
  historyOverlay?: RealtimeHistoryItem[];
}): Promise<ResolvedRealtimeSessionBootstrap> {
  const sessionData = await resolveSessionWorkspaceAndHistory({
    cfg: params.cfg,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
  });
  const workspaceDir = sessionData.workspaceDir;
  const instructions = await buildRealtimeSessionInstructions({
    cfg: params.cfg,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    model: params.model,
    transport: params.transport,
    workspaceDir,
    tools: params.tools,
  });

  return {
    workspaceDir,
    sessionFile: sessionData.sessionFile,
    bootstrap: {
      instructions,
      history: mergeRealtimeHistoryItems(sessionData.history, params.historyOverlay),
    },
  };
}
