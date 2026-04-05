import fs from "node:fs";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { prepareSessionManagerForRun } from "../../agents/pi-embedded-runner/session-manager-init.js";
import { acquireSessionWriteLock } from "../../agents/session-write-lock.js";
import {
  emitSessionTranscriptUpdate,
  type SessionTranscriptUpdate,
} from "../../sessions/transcript-events.js";
import { resolveDefaultSessionStorePath } from "./paths.js";
import { resolveAndPersistSessionFile } from "./session-file.js";
import { loadSessionStore, normalizeStoreSessionKey } from "./store.js";
import type { SessionEntry } from "./types.js";

export type TranscriptAppendTarget = {
  storePath: string;
  normalizedKey: string;
  entry: SessionEntry;
  sessionFile: string;
};

export async function resolveTranscriptAppendTarget(params: {
  agentId?: string;
  sessionKey: string;
  storePath?: string;
}): Promise<TranscriptAppendTarget | { ok: false; reason: string }> {
  const storePath = params.storePath ?? resolveDefaultSessionStorePath(params.agentId);
  const store = loadSessionStore(storePath, { skipCache: true });
  const normalizedKey = normalizeStoreSessionKey(params.sessionKey);
  const entry = (store[normalizedKey] ?? store[params.sessionKey]) as SessionEntry | undefined;
  if (!entry?.sessionId) {
    return { ok: false, reason: `unknown sessionKey: ${params.sessionKey}` };
  }

  try {
    const resolvedSessionFile = await resolveAndPersistSessionFile({
      sessionId: entry.sessionId,
      sessionKey: params.sessionKey,
      sessionStore: store,
      storePath,
      sessionEntry: entry,
      agentId: params.agentId,
      sessionsDir: path.dirname(storePath),
    });
    return {
      storePath,
      normalizedKey,
      entry,
      sessionFile: resolvedSessionFile.sessionFile,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export type PersistedTranscriptUpdate = SessionTranscriptUpdate & {
  messageId: string;
};

export function persistPreparedTranscriptWithoutAssistant(sessionManager: unknown): void {
  const sm = sessionManager as {
    fileEntries: Array<{ type: string; message?: { role?: string } }>;
    flushed: boolean;
    _rewriteFile?: () => void;
  };
  const hasAssistant = sm.fileEntries.some(
    (entry) => entry.type === "message" && entry.message?.role === "assistant",
  );
  if (hasAssistant || typeof sm._rewriteFile !== "function") {
    return;
  }
  sm._rewriteFile();
  sm.flushed = true;
}

export async function resolvePersistedTranscriptUpdates(params: {
  sessionFile: string;
  updates: PersistedTranscriptUpdate[];
}): Promise<PersistedTranscriptUpdate[]> {
  if (params.updates.length === 0) {
    return [];
  }
  const candidateIds = new Set(params.updates.map((update) => update.messageId));
  const persistedIds = new Set<string>();
  try {
    const raw = await fs.promises.readFile(params.sessionFile, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as { id?: unknown };
        if (typeof parsed.id === "string" && candidateIds.has(parsed.id)) {
          persistedIds.add(parsed.id);
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  return params.updates.filter((update) => persistedIds.has(update.messageId));
}

export function emitPersistedTranscriptUpdates(updates: PersistedTranscriptUpdate[]): void {
  for (const update of updates) {
    emitSessionTranscriptUpdate(update);
  }
}

export async function withPreparedSessionTranscriptLock<T>(params: {
  sessionFile: string;
  sessionId: string;
  run: (context: {
    hadSessionFile: boolean;
    openSessionManager: () => SessionManager;
    ensurePrepared: (sessionManager: SessionManager) => Promise<void>;
  }) => Promise<T>;
}): Promise<T> {
  const sessionLock = await acquireSessionWriteLock({
    sessionFile: params.sessionFile,
    allowReentrant: false,
  });

  try {
    const hadSessionFile = await fs.promises
      .access(params.sessionFile)
      .then(() => true)
      .catch(() => false);
    let prepared = false;
    const ensurePrepared = async (sessionManager: SessionManager) => {
      if (prepared || hadSessionFile) {
        return;
      }
      await prepareSessionManagerForRun({
        sessionManager,
        sessionFile: params.sessionFile,
        hadSessionFile,
        sessionId: params.sessionId,
        cwd: process.cwd(),
      });
      prepared = true;
    };
    return await params.run({
      hadSessionFile,
      openSessionManager: () => SessionManager.open(params.sessionFile),
      ensurePrepared,
    });
  } finally {
    await sessionLock.release();
  }
}
