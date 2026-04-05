import { resolveSessionFilePath } from "./paths.js";
import { resolveSessionStoreEntry, updateSessionStore } from "./store.js";
import type { SessionEntry } from "./types.js";

export async function resolveAndPersistSessionFile(params: {
  sessionId: string;
  sessionKey: string;
  sessionStore: Record<string, SessionEntry>;
  storePath: string;
  sessionEntry?: SessionEntry;
  agentId?: string;
  sessionsDir?: string;
  fallbackSessionFile?: string;
  activeSessionKey?: string;
}): Promise<{ sessionFile: string; sessionEntry: SessionEntry }> {
  const { sessionId, sessionKey, sessionStore, storePath } = params;
  const resolved = resolveSessionStoreEntry({ store: sessionStore, sessionKey });
  const baseEntry = params.sessionEntry ??
    resolved.existing ?? { sessionId, updatedAt: Date.now() };
  const fallbackSessionFile = params.fallbackSessionFile?.trim();
  const entryForResolve =
    !baseEntry.sessionFile && fallbackSessionFile
      ? { ...baseEntry, sessionFile: fallbackSessionFile }
      : baseEntry;
  const sessionFile = resolveSessionFilePath(sessionId, entryForResolve, {
    agentId: params.agentId,
    sessionsDir: params.sessionsDir,
  });
  const persistedEntry: SessionEntry = {
    ...baseEntry,
    sessionId,
    updatedAt: Date.now(),
    sessionFile,
  };
  const shouldPersistStoreUpdate =
    resolved.existing?.sessionId !== sessionId ||
    resolved.existing?.sessionFile !== sessionFile ||
    resolved.legacyKeys.length > 0 ||
    !Object.prototype.hasOwnProperty.call(sessionStore, resolved.normalizedKey);

  sessionStore[resolved.normalizedKey] = persistedEntry;
  for (const legacyKey of resolved.legacyKeys) {
    delete sessionStore[legacyKey];
  }

  if (shouldPersistStoreUpdate) {
    await updateSessionStore(
      storePath,
      (store) => {
        const current = resolveSessionStoreEntry({ store, sessionKey });
        store[current.normalizedKey] = {
          ...store[current.normalizedKey],
          ...persistedEntry,
        };
        for (const legacyKey of current.legacyKeys) {
          delete store[legacyKey];
        }
      },
      params.activeSessionKey ? { activeSessionKey: params.activeSessionKey } : undefined,
    );
  }

  return { sessionFile, sessionEntry: persistedEntry };
}
