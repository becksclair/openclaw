import type { AppViewState } from "../app-view-state.ts";
import { buildAgentMainSessionKey, parseAgentSessionKey } from "../session-key.ts";
import { normalizeLowercaseStringOrEmpty, normalizeOptionalString } from "../string-coerce.ts";

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
  mainSessionKey?: string;
  mainKey?: string;
};

function resolveSessionDefaultsSnapshot(state: AppViewState): SessionDefaultsSnapshot | undefined {
  return (state.hello?.snapshot as { sessionDefaults?: SessionDefaultsSnapshot } | undefined)
    ?.sessionDefaults;
}

export function resolveReadAloudAgentId(
  state: AppViewState,
  fallbackAgentId?: string | null,
): string {
  const sessionDefaults = resolveSessionDefaultsSnapshot(state);
  const sessionKey = normalizeOptionalString(state.sessionKey);
  const normalizedSessionKey = normalizeLowercaseStringOrEmpty(sessionKey);
  const defaultAgentId =
    normalizeOptionalString(sessionDefaults?.defaultAgentId) ??
    normalizeOptionalString(state.agentsList?.defaultId);
  const mainSessionKey =
    normalizeOptionalString(sessionDefaults?.mainSessionKey) ??
    normalizeOptionalString(sessionDefaults?.mainKey) ??
    "main";
  const normalizedMainSessionKey = normalizeLowercaseStringOrEmpty(mainSessionKey);
  const sessionAgentId = sessionKey ? parseAgentSessionKey(sessionKey)?.agentId : undefined;

  if (sessionAgentId) {
    return sessionAgentId;
  }
  if (
    defaultAgentId &&
    (normalizedSessionKey === "" ||
      normalizedSessionKey === "main" ||
      normalizedSessionKey === normalizedMainSessionKey ||
      sessionKey === buildAgentMainSessionKey({ agentId: defaultAgentId }))
  ) {
    return defaultAgentId;
  }
  return normalizeOptionalString(fallbackAgentId) ?? "main";
}
