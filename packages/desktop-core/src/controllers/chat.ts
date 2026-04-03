import type { GatewayBrowserClient, GatewayEventFrame } from "../gateway.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/;

export type DesktopChatMessage = {
  content: string;
  role: string;
  timestamp?: number;
};

export type DesktopChatState = {
  chatLoading: boolean;
  chatMessages: DesktopChatMessage[];
  chatRunId: string | null;
  chatSending: boolean;
  chatStream: string | null;
  lastError: string | null;
  sessionKey: string;
};

export function createDesktopChatState(sessionKey: string): DesktopChatState {
  return {
    chatLoading: false,
    chatMessages: [],
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    lastError: null,
    sessionKey,
  };
}

function isSilentReplyStream(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text);
}

function extractMessageText(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const entry = message as Record<string, unknown>;
  if (typeof entry.text === "string") {
    return entry.text;
  }
  if (typeof entry.content === "string") {
    return entry.content;
  }
  if (Array.isArray(entry.content)) {
    const text = entry.content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return null;
        }
        const block = part as Record<string, unknown>;
        return block.type === "text" && typeof block.text === "string" ? block.text : null;
      })
      .filter((value): value is string => typeof value === "string")
      .join("\n")
      .trim();
    return text || null;
  }
  return null;
}

function normalizeHistoryMessage(message: unknown): DesktopChatMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const entry = message as Record<string, unknown>;
  const content = extractMessageText(message);
  if (!content || isSilentReplyStream(content)) {
    return null;
  }
  return {
    content,
    role: typeof entry.role === "string" ? entry.role : "assistant",
    timestamp: typeof entry.timestamp === "number" ? entry.timestamp : undefined,
  };
}

export async function resolveMainSessionKey(client: GatewayBrowserClient): Promise<string> {
  const resolved = await client.request<{ key?: string }>("sessions.resolve", { key: "main" });
  return typeof resolved.key === "string" && resolved.key.trim() ? resolved.key : "main";
}

export async function loadDesktopChatHistory(
  client: GatewayBrowserClient,
  state: DesktopChatState,
): Promise<void> {
  state.chatLoading = true;
  state.lastError = null;
  try {
    const res = await client.request<{ messages?: unknown[] }>("chat.history", {
      sessionKey: state.sessionKey,
      limit: 200,
    });
    state.chatMessages = Array.isArray(res.messages)
      ? res.messages
          .map((message) => normalizeHistoryMessage(message))
          .filter((message): message is DesktopChatMessage => message !== null)
      : [];
    state.chatStream = null;
  } catch (err) {
    state.chatMessages = [];
    state.lastError = isMissingOperatorReadScopeError(err)
      ? formatMissingOperatorReadScopeMessage("existing chat history")
      : String(err);
  } finally {
    state.chatLoading = false;
  }
}

export async function sendDesktopChatMessage(
  client: GatewayBrowserClient,
  state: DesktopChatState,
  message: string,
): Promise<string | null> {
  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }
  const idempotencyKey = crypto.randomUUID();
  state.chatMessages = [
    ...state.chatMessages,
    {
      content: trimmed,
      role: "user",
      timestamp: Date.now(),
    },
  ];
  state.chatSending = true;
  state.chatRunId = idempotencyKey;
  state.chatStream = "";
  state.lastError = null;
  try {
    await client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: trimmed,
      deliver: false,
      idempotencyKey,
    });
    return idempotencyKey;
  } catch (err) {
    state.chatRunId = null;
    state.chatStream = null;
    state.lastError = String(err);
    return null;
  } finally {
    state.chatSending = false;
  }
}

export async function abortDesktopChatRun(
  client: GatewayBrowserClient,
  state: DesktopChatState,
): Promise<boolean> {
  try {
    await client.request(
      "chat.abort",
      state.chatRunId
        ? { sessionKey: state.sessionKey, runId: state.chatRunId }
        : { sessionKey: state.sessionKey },
    );
    return true;
  } catch (err) {
    state.lastError = String(err);
    return false;
  }
}

export function applyDesktopChatEvent(state: DesktopChatState, event: GatewayEventFrame): boolean {
  if (event.event !== "chat" || !event.payload || typeof event.payload !== "object") {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  if (payload.sessionKey !== state.sessionKey) {
    return false;
  }

  const incomingRunId = typeof payload.runId === "string" ? payload.runId : null;
  const payloadState = typeof payload.state === "string" ? payload.state : null;
  const nextText = extractMessageText(payload.message);

  if (
    incomingRunId &&
    state.chatRunId &&
    incomingRunId !== state.chatRunId &&
    payloadState !== "final"
  ) {
    return false;
  }

  if (payloadState === "delta") {
    if (nextText && !isSilentReplyStream(nextText)) {
      state.chatStream = nextText;
    }
    return true;
  }

  if (payloadState === "final") {
    const finalText = nextText ?? state.chatStream;
    if (finalText && !isSilentReplyStream(finalText)) {
      state.chatMessages = [
        ...state.chatMessages,
        {
          content: finalText,
          role: "assistant",
          timestamp: Date.now(),
        },
      ];
    }
    state.chatRunId = null;
    state.chatStream = null;
    return true;
  }

  if (payloadState === "aborted") {
    state.chatRunId = null;
    state.chatStream = null;
    return true;
  }

  if (payloadState === "error") {
    state.chatRunId = null;
    state.chatStream = null;
    state.lastError =
      typeof payload.errorMessage === "string" ? payload.errorMessage : "chat error";
    return true;
  }

  return false;
}
