import fs from "node:fs";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { prepareSessionManagerForRun } from "../../agents/pi-embedded-runner/session-manager-init.js";
import { acquireSessionWriteLock } from "../../agents/session-write-lock.js";
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
