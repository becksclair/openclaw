import fs from "node:fs";
import {
  emitSessionTranscriptUpdate,
  type SessionTranscriptUpdate,
} from "../../sessions/transcript-events.js";

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
