import fs from "node:fs/promises";

type SessionHeaderEntry = { type: "session"; id?: string; cwd?: string };
type SessionMessageEntry = { type: "message"; message?: { role?: string } };

type SessionEntryLike = SessionHeaderEntry | SessionMessageEntry | { type: string };

/**
 * pi-coding-agent SessionManager persistence quirk:
 * - If the file exists but has no assistant message, SessionManager marks itself `flushed=true`
 *   and will never persist the initial user message.
 * - If the file doesn't exist yet, SessionManager builds a new session in memory and flushes
 *   header+user+assistant once the first assistant arrives (good).
 *
 * This normalizes the file/session state so pre-created header-only files do not duplicate their
 * header row on the first assistant flush, while existing user-only history stays intact.
 */
export async function prepareSessionManagerForRun(params: {
  sessionManager: unknown;
  sessionFile: string;
  hadSessionFile: boolean;
  sessionId: string;
  cwd: string;
}): Promise<void> {
  const sm = params.sessionManager as {
    sessionId: string;
    flushed: boolean;
    fileEntries: SessionEntryLike[];
    byId?: Map<string, unknown>;
    labelsById?: Map<string, unknown>;
    leafId?: string | null;
  };

  const header = sm.fileEntries.find(
    (entry): entry is SessionHeaderEntry => entry.type === "session",
  );
  const messageEntries = sm.fileEntries.filter(
    (entry): entry is SessionMessageEntry => entry.type === "message",
  );
  const hasAssistant = messageEntries.some((entry) => entry.message?.role === "assistant");

  if (!params.hadSessionFile && header) {
    header.id = params.sessionId;
    header.cwd = params.cwd;
    sm.sessionId = params.sessionId;
    return;
  }

  if (params.hadSessionFile && header && !hasAssistant && sm.fileEntries.length === 1) {
    // Reset header-only files so the first assistant flush does not duplicate the header row.
    await fs.writeFile(params.sessionFile, "", "utf-8");
    sm.fileEntries = [header];
    sm.byId?.clear?.();
    sm.labelsById?.clear?.();
    sm.leafId = null;
    sm.flushed = false;
  }
}
