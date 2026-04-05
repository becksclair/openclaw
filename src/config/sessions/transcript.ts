import fs from "node:fs";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { emitSessionTranscriptUpdate } from "../../sessions/transcript-events.js";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionTranscriptPath,
} from "./paths.js";
import { resolveAndPersistSessionFile } from "./session-file.js";
import { updateSessionStore } from "./store.js";
import { parseSessionThreadInfo } from "./thread-info.js";
import {
  resolveTranscriptAppendTarget,
  withPreparedSessionTranscriptLock,
} from "./transcript-append-seam.js";
import { resolveMirroredTranscriptText } from "./transcript-mirror.js";
import {
  emitPersistedTranscriptUpdates,
  persistPreparedTranscriptWithoutAssistant,
  resolvePersistedTranscriptUpdates,
  type PersistedTranscriptUpdate,
} from "./transcript-persistence-seam.js";
import type { SessionEntry } from "./types.js";

const log = createSubsystemLogger("sessions/transcript");

async function setTranscriptFileModeBestEffort(sessionFile: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  try {
    await fs.promises.chmod(sessionFile, 0o600);
  } catch {
    // ignore best-effort chmod failures
  }
}

export type SessionTranscriptAppendResult =
  | { ok: true; sessionFile: string; messageId: string }
  | { ok: false; reason: string };

export type SessionTranscriptUpdateMode = "inline" | "file-only" | "none";

export type SessionTranscriptAssistantMessage = Parameters<SessionManager["appendMessage"]>[0] & {
  role: "assistant";
};

export async function resolveSessionTranscriptFile(params: {
  sessionId: string;
  sessionKey: string;
  sessionEntry: SessionEntry | undefined;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  agentId: string;
  threadId?: string | number;
}): Promise<{ sessionFile: string; sessionEntry: SessionEntry | undefined }> {
  const sessionPathOpts = resolveSessionFilePathOptions({
    agentId: params.agentId,
    storePath: params.storePath,
  });
  let sessionFile = resolveSessionFilePath(params.sessionId, params.sessionEntry, sessionPathOpts);
  let sessionEntry = params.sessionEntry;

  if (params.sessionStore && params.storePath) {
    const threadIdFromSessionKey = parseSessionThreadInfo(params.sessionKey).threadId;
    const fallbackSessionFile = !sessionEntry?.sessionFile
      ? resolveSessionTranscriptPath(
          params.sessionId,
          params.agentId,
          params.threadId ?? threadIdFromSessionKey,
        )
      : undefined;
    const resolvedSessionFile = await resolveAndPersistSessionFile({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      sessionStore: params.sessionStore,
      storePath: params.storePath,
      sessionEntry,
      agentId: sessionPathOpts?.agentId,
      sessionsDir: sessionPathOpts?.sessionsDir,
      fallbackSessionFile,
    });
    sessionFile = resolvedSessionFile.sessionFile;
    sessionEntry = resolvedSessionFile.sessionEntry;
  }

  return {
    sessionFile,
    sessionEntry,
  };
}

export type SessionTranscriptTextMessage = {
  role: "user" | "assistant";
  text: string;
  idempotencyKey?: string;
};

function buildAssistantTranscriptMessage(params: {
  text: string;
  timestamp: number;
  model?: string;
  idempotencyKey?: string;
}): Parameters<SessionManager["appendMessage"]>[0] {
  return {
    role: "assistant",
    content: [{ type: "text", text: params.text }],
    api: "openai-responses",
    provider: "openclaw",
    model: params.model ?? "delivery-mirror",
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
    timestamp: params.timestamp,
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
  } as Parameters<SessionManager["appendMessage"]>[0];
}

function buildUserTranscriptMessage(params: {
  text: string;
  timestamp: number;
  idempotencyKey?: string;
}): Parameters<SessionManager["appendMessage"]>[0] {
  return {
    role: "user",
    content: params.text,
    timestamp: params.timestamp,
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
  } as Parameters<SessionManager["appendMessage"]>[0];
}

function extractTranscriptMessageText(content: unknown): string {
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

function toComparableTranscriptMessage(message: unknown): SessionTranscriptTextMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const role = (message as { role?: unknown }).role;
  if (role !== "user" && role !== "assistant") {
    return null;
  }
  const text = extractTranscriptMessageText((message as { content?: unknown }).content);
  if (!text) {
    return null;
  }
  const idempotencyKey = (message as { idempotencyKey?: unknown }).idempotencyKey;
  return {
    role,
    text,
    ...(typeof idempotencyKey === "string" && idempotencyKey.trim()
      ? { idempotencyKey: idempotencyKey.trim() }
      : {}),
  };
}

function collectExistingIdempotencyKeys(messages: unknown[]): Set<string> {
  return new Set(
    messages
      .map((message) => toComparableTranscriptMessage(message)?.idempotencyKey)
      .filter((idempotencyKey): idempotencyKey is string => !!idempotencyKey),
  );
}

function countTailOverlap(params: {
  existingMessages: unknown[];
  nextMessages: SessionTranscriptTextMessage[];
}): number {
  const normalizedExisting = params.existingMessages
    .map((message) => toComparableTranscriptMessage(message))
    .filter((message): message is SessionTranscriptTextMessage => message !== null);
  const maxOverlap = Math.min(normalizedExisting.length, params.nextMessages.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      const existing = normalizedExisting[normalizedExisting.length - overlap + index];
      const next = params.nextMessages[index];
      if (!existing || existing.role !== next.role || existing.text !== next.text) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return overlap;
    }
  }
  return 0;
}

async function touchSessionStoreUpdatedAtBestEffort(params: {
  storePath: string;
  normalizedKey: string;
  sessionKey: string;
  entry: SessionEntry;
}): Promise<void> {
  const updatedAt = Date.now();
  try {
    await updateSessionStore(params.storePath, (nextStore) => {
      const existing = nextStore[params.normalizedKey] ?? nextStore[params.sessionKey];
      nextStore[params.normalizedKey] = existing
        ? {
            ...existing,
            updatedAt,
            ...(existing.sessionId ? {} : { sessionId: params.entry.sessionId }),
          }
        : {
            sessionId: params.entry.sessionId,
            updatedAt,
          };
    });
  } catch (err) {
    log.warn(
      `session transcript: failed to update session recency for ${params.sessionKey}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function appendTextMessagesToSessionTranscript(params: {
  agentId?: string;
  sessionKey: string;
  messages: SessionTranscriptTextMessage[];
  assistantModel?: string;
  /** Optional override for store path (mostly for tests). */
  storePath?: string;
}): Promise<
  { ok: true; sessionFile: string; messageIds: string[] } | { ok: false; reason: string }
> {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return { ok: false, reason: "missing sessionKey" };
  }

  const messages = params.messages
    .map((message) => ({
      ...message,
      text: message.text.trim(),
      idempotencyKey: message.idempotencyKey?.trim() || undefined,
    }))
    .filter((message) => message.text);
  if (messages.length === 0) {
    return { ok: false, reason: "empty messages" };
  }

  const hasKeyedMessages = messages.some((message) => !!message.idempotencyKey);
  const hasUnkeyedMessages = messages.some((message) => !message.idempotencyKey);
  if (hasKeyedMessages && hasUnkeyedMessages) {
    return {
      ok: false,
      reason: "mixed keyed and unkeyed transcript batches are not supported",
    };
  }

  const target = await resolveTranscriptAppendTarget({
    agentId: params.agentId,
    sessionKey,
    storePath: params.storePath,
  });
  if (!("entry" in target)) {
    return target;
  }

  const { storePath, normalizedKey, entry, sessionFile } = target;
  const pendingUpdates: PersistedTranscriptUpdate[] = [];
  const result = await withPreparedSessionTranscriptLock<
    { ok: true; sessionFile: string; messageIds: string[] } | { ok: false; reason: string }
  >({
    sessionFile,
    sessionId: entry.sessionId,
    run: async ({ openSessionManager, ensurePrepared }) => {
      const sessionManager = openSessionManager();
      await ensurePrepared(sessionManager);
      const existingContext = sessionManager.buildSessionContext();
      const existingIdempotencyKeys = collectExistingIdempotencyKeys(existingContext.messages);
      const seenBatchIdempotencyKeys = new Set(existingIdempotencyKeys);
      const messagesToAppend = hasKeyedMessages
        ? messages.filter((message) => {
            const key = message.idempotencyKey;
            if (!key || seenBatchIdempotencyKeys.has(key)) {
              return false;
            }
            seenBatchIdempotencyKeys.add(key);
            return true;
          })
        : messages.slice(
            countTailOverlap({
              existingMessages: existingContext.messages,
              nextMessages: messages,
            }),
          );

      if (messagesToAppend.length === 0) {
        return { ok: true, sessionFile, messageIds: [] };
      }

      const messageIds: string[] = [];
      const baseMessageSeq = existingContext.messages.length;
      let appendResult: { ok: false; reason: string } | undefined;
      try {
        for (const [index, message] of messagesToAppend.entries()) {
          const timestamp = Date.now() + index;
          const transcriptMessage =
            message.role === "assistant"
              ? buildAssistantTranscriptMessage({
                  text: message.text,
                  timestamp,
                  model: params.assistantModel,
                  idempotencyKey: message.idempotencyKey,
                })
              : buildUserTranscriptMessage({
                  text: message.text,
                  timestamp,
                  idempotencyKey: message.idempotencyKey,
                });
          const messageId = sessionManager.appendMessage(transcriptMessage);
          messageIds.push(messageId);
          pendingUpdates.push({
            sessionFile,
            sessionKey,
            message: transcriptMessage,
            messageId,
            messageSeq: baseMessageSeq + messageIds.length,
          });
        }
      } catch (err) {
        appendResult = {
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }

      const persistedUpdates = await resolvePersistedTranscriptUpdates({
        sessionFile,
        updates: pendingUpdates,
      });
      emitPersistedTranscriptUpdates(persistedUpdates);

      if (!appendResult) {
        persistPreparedTranscriptWithoutAssistant(sessionManager);
        await setTranscriptFileModeBestEffort(sessionFile);
        const fullyPersistedUpdates = await resolvePersistedTranscriptUpdates({
          sessionFile,
          updates: pendingUpdates,
        });
        if (persistedUpdates.length < fullyPersistedUpdates.length) {
          emitPersistedTranscriptUpdates(fullyPersistedUpdates.slice(persistedUpdates.length));
        }
        return fullyPersistedUpdates.length === pendingUpdates.length
          ? { ok: true, sessionFile, messageIds }
          : { ok: false, reason: "transcript persistence incomplete" };
      }

      return appendResult;
    },
  });

  if (!result) {
    return { ok: false, reason: "transcript append did not produce a result" };
  }

  if (!result.ok) {
    return result;
  }

  if (result.messageIds.length === 0) {
    return result;
  }

  await touchSessionStoreUpdatedAtBestEffort({
    storePath,
    normalizedKey,
    sessionKey,
    entry,
  });

  return result;
}

export async function appendAssistantMessageToSessionTranscript(params: {
  agentId?: string;
  sessionKey: string;
  text?: string;
  mediaUrls?: string[];
  idempotencyKey?: string;
  /** Optional override for store path (mostly for tests). */
  storePath?: string;
  updateMode?: SessionTranscriptUpdateMode;
}): Promise<SessionTranscriptAppendResult> {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return { ok: false, reason: "missing sessionKey" };
  }

  const mirrorText = resolveMirroredTranscriptText({
    text: params.text,
    mediaUrls: params.mediaUrls,
  });
  if (!mirrorText) {
    return { ok: false, reason: "empty text" };
  }

  const idempotencyKey = params.idempotencyKey?.trim() || undefined;
  return appendExactAssistantMessageToSessionTranscript({
    agentId: params.agentId,
    sessionKey,
    storePath: params.storePath,
    idempotencyKey,
    updateMode: params.updateMode,
    message: buildAssistantTranscriptMessage({
      text: mirrorText,
      timestamp: Date.now(),
      model: "delivery-mirror",
      idempotencyKey,
    }) as SessionTranscriptAssistantMessage,
  });
}

export async function appendExactAssistantMessageToSessionTranscript(params: {
  agentId?: string;
  sessionKey: string;
  message: SessionTranscriptAssistantMessage;
  idempotencyKey?: string;
  storePath?: string;
  updateMode?: SessionTranscriptUpdateMode;
}): Promise<SessionTranscriptAppendResult> {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return { ok: false, reason: "missing sessionKey" };
  }
  if (params.message.role !== "assistant") {
    return { ok: false, reason: "message role must be assistant" };
  }

  const explicitIdempotencyKey =
    params.idempotencyKey ??
    ((params.message as { idempotencyKey?: unknown }).idempotencyKey as string | undefined);
  const target = await resolveTranscriptAppendTarget({
    agentId: params.agentId,
    sessionKey,
    storePath: params.storePath,
  });
  if (!("entry" in target)) {
    return target;
  }

  const { storePath, normalizedKey, entry, sessionFile } = target;
  let appended = false;
  const result = await withPreparedSessionTranscriptLock<SessionTranscriptAppendResult>({
    sessionFile,
    sessionId: entry.sessionId,
    run: async ({ openSessionManager, ensurePrepared }) => {
      const existingMessageId = explicitIdempotencyKey
        ? await transcriptHasIdempotencyKey(sessionFile, explicitIdempotencyKey)
        : undefined;
      if (existingMessageId) {
        return { ok: true, sessionFile, messageId: existingMessageId };
      }

      const sessionManager = openSessionManager();
      const existingContext = sessionManager.buildSessionContext();
      await ensurePrepared(sessionManager);
      const message = {
        ...params.message,
        ...(explicitIdempotencyKey ? { idempotencyKey: explicitIdempotencyKey } : {}),
      } as Parameters<SessionManager["appendMessage"]>[0];
      const messageId = sessionManager.appendMessage(message);
      await setTranscriptFileModeBestEffort(sessionFile);

      const persistedUpdates = await resolvePersistedTranscriptUpdates({
        sessionFile,
        updates: [
          {
            sessionFile,
            sessionKey,
            message,
            messageId,
            messageSeq: existingContext.messages.length + 1,
          },
        ],
      });
      if (persistedUpdates.length !== 1) {
        return { ok: false, reason: "transcript persistence incomplete" };
      }

      appended = true;
      switch (params.updateMode ?? "inline") {
        case "inline":
          emitPersistedTranscriptUpdates(persistedUpdates);
          break;
        case "file-only":
          emitSessionTranscriptUpdate(sessionFile);
          break;
        case "none":
          break;
      }
      return { ok: true, sessionFile, messageId };
    },
  });

  if (!result.ok) {
    return result;
  }
  if (!appended) {
    return result;
  }

  await touchSessionStoreUpdatedAtBestEffort({
    storePath,
    normalizedKey,
    sessionKey,
    entry,
  });
  return result;
}

async function transcriptHasIdempotencyKey(
  transcriptPath: string,
  idempotencyKey: string,
): Promise<string | undefined> {
  try {
    const raw = await fs.promises.readFile(transcriptPath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as {
          id?: unknown;
          message?: { idempotencyKey?: unknown };
        };
        if (
          parsed.message?.idempotencyKey === idempotencyKey &&
          typeof parsed.id === "string" &&
          parsed.id
        ) {
          return parsed.id;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
