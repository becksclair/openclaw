// Run-scoped final-audio cache used by clients that need the exact TTS file
// generated for a completed chat turn without depending on channel adapters.
import path from "node:path";
import { isAudioFileName, mimeTypeFromFilePath } from "@openclaw/media-core/mime";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  getReplyPayloadTtsSupplement,
  resolveSendableOutboundReplyParts,
} from "openclaw/plugin-sdk/reply-payload";
import type {
  ChatFinalAudioGetParams as ProtocolChatFinalAudioGetParams,
  ChatFinalAudioGetResult as ProtocolChatFinalAudioGetResult,
} from "../../packages/gateway-protocol/src/schema.js";
import { CHAT_FINAL_AUDIO_BASE64_MAX_LENGTH } from "../../packages/gateway-protocol/src/schema.js";
import type { ReplyPayload } from "../auto-reply/reply-payload.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { openLocalFileSafely } from "../infra/fs-safe.js";
import { assertNoWindowsNetworkPath, safeFileURLToPath } from "../infra/local-file-access.js";
import { assertLocalMediaAllowed } from "../media/local-media-access.js";
import { getAgentScopedMediaLocalRoots } from "../media/local-roots.js";
import { formatForLog } from "./ws-log.js";

const CHAT_FINAL_AUDIO_TTL_MS = 5 * 60 * 1000;
const CHAT_FINAL_AUDIO_MAX_RECORDS = 128;
export const MAX_CHAT_FINAL_AUDIO_BASE64_BYTES = CHAT_FINAL_AUDIO_BASE64_MAX_LENGTH;
export const MAX_CHAT_FINAL_AUDIO_BYTES = (MAX_CHAT_FINAL_AUDIO_BASE64_BYTES / 4) * 3;
const CHAT_FINAL_AUDIO_DEFAULT_WAIT_MS = 0;
const CHAT_FINAL_AUDIO_MAX_WAIT_MS = 30_000;
const CHAT_FINAL_AUDIO_POLL_MS = 250;

export type ChatFinalAudioRecord = {
  runId: string;
  sessionKey: string;
  agentId?: string;
  mediaAgentId?: string;
  mediaPath: string;
  spokenText?: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export type ChatFinalAudioRegistry = {
  set: (record: Omit<ChatFinalAudioRecord, "createdAtMs" | "expiresAtMs">) => void;
  get: (params: {
    runId: string;
    sessionKey: string;
    agentId?: string;
  }) => ChatFinalAudioRecord | undefined;
  deleteRun: (runId: string) => void;
  sweep: (nowMs?: number) => void;
};

type TrustedFinalAudioCandidate = {
  mediaPath: string;
  spokenText?: string;
};

type ChatFinalAudioRequest = {
  sessionKey: string;
  runId: string;
  agentId?: string;
  waitMs: number;
};

type ChatFinalAudioRequestContext = {
  chatFinalAudio: ChatFinalAudioRegistry;
  getRuntimeConfig: () => OpenClawConfig;
  logGateway: {
    warn: (message: string) => void;
  };
};

type ChatFinalAudioGetPayloadResolution =
  | { ok: true; payload: ProtocolChatFinalAudioGetResult }
  | { ok: false; error: string };
type ChatFinalAudioOutputFormat = NonNullable<
  Extract<ProtocolChatFinalAudioGetResult, { found: true }>["outputFormat"]
>;

export function createChatFinalAudioRegistry(params?: {
  ttlMs?: number;
  maxRecords?: number;
  now?: () => number;
}): ChatFinalAudioRegistry {
  const ttlMs = params?.ttlMs ?? CHAT_FINAL_AUDIO_TTL_MS;
  const maxRecords = params?.maxRecords ?? CHAT_FINAL_AUDIO_MAX_RECORDS;
  const now = params?.now ?? Date.now;
  const records = new Map<string, ChatFinalAudioRecord>();

  const registry: ChatFinalAudioRegistry = {
    set: (record) => {
      const nowMs = now();
      registry.sweep(nowMs);
      const storedRecord = {
        ...record,
        agentId: normalizeOptionalString(record.agentId),
        mediaAgentId: normalizeOptionalString(record.mediaAgentId),
        createdAtMs: nowMs,
        expiresAtMs: nowMs + ttlMs,
      };
      records.set(chatFinalAudioRegistryKey(storedRecord), storedRecord);
      while (records.size > maxRecords) {
        const oldestKey = records.keys().next().value;
        if (typeof oldestKey !== "string") {
          break;
        }
        records.delete(oldestKey);
      }
    },
    get: (paramsLocal) => {
      registry.sweep();
      const requestedAgentId = normalizeOptionalString(paramsLocal.agentId);
      const exactKey = chatFinalAudioRegistryKey({
        ...paramsLocal,
        agentId: requestedAgentId,
      });
      const exact = records.get(exactKey);
      if (exact) {
        return exact;
      }
      for (const record of records.values()) {
        if (record.runId !== paramsLocal.runId || record.sessionKey !== paramsLocal.sessionKey) {
          continue;
        }
        const recordAgentId = normalizeOptionalString(record.agentId);
        if (requestedAgentId && requestedAgentId !== recordAgentId) {
          continue;
        }
        if (!requestedAgentId && recordAgentId && record.sessionKey === "global") {
          continue;
        }
        return record;
      }
      return undefined;
    },
    deleteRun: (runId) => {
      for (const [key, record] of records) {
        if (record.runId === runId) {
          records.delete(key);
        }
      }
    },
    sweep: (nowMs = now()) => {
      for (const [key, record] of records) {
        if (record.expiresAtMs <= nowMs) {
          records.delete(key);
        }
      }
    },
  };
  return registry;
}

function chatFinalAudioRegistryKey(
  record: Pick<ChatFinalAudioRecord, "runId" | "sessionKey" | "agentId">,
): string {
  return [record.sessionKey, normalizeOptionalString(record.agentId) ?? "", record.runId].join(
    "\0",
  );
}

export function resolveTrustedFinalAudioCandidate(
  payloads: readonly ReplyPayload[],
): TrustedFinalAudioCandidate | undefined {
  for (const payload of payloads) {
    if (payload.isReasoning === true || payload.trustedLocalMedia !== true) {
      continue;
    }
    const supplement = getReplyPayloadTtsSupplement(payload);
    const spokenText =
      normalizeOptionalString(payload.spokenText) ??
      normalizeOptionalString(supplement?.spokenText);
    if (!spokenText) {
      continue;
    }
    const parts = resolveSendableOutboundReplyParts(payload);
    for (const rawMediaUrl of parts.mediaUrls) {
      const mediaPath = resolveLocalAudioPath(rawMediaUrl);
      if (!mediaPath || !isAudioFileName(mediaPath)) {
        continue;
      }
      return {
        mediaPath,
        spokenText,
      };
    }
  }
  return undefined;
}

export async function resolveChatFinalAudioGetPayload(params: {
  context: ChatFinalAudioRequestContext;
  params: ProtocolChatFinalAudioGetParams;
}): Promise<ChatFinalAudioGetPayloadResolution> {
  const normalized = normalizeChatFinalAudioGetParams(params.params);
  if (!normalized.ok) {
    return normalized;
  }
  const record = await waitForChatFinalAudioRecord({
    registry: params.context.chatFinalAudio,
    request: normalized.value,
  });
  if (!record) {
    return { ok: true, payload: { found: false, unavailableReason: "not_found" } };
  }
  return {
    ok: true,
    payload: await readChatFinalAudioPayload({
      context: params.context,
      request: normalized.value,
      record,
    }),
  };
}

function normalizeChatFinalAudioGetParams(
  params: ProtocolChatFinalAudioGetParams,
): { ok: true; value: ChatFinalAudioRequest } | { ok: false; error: string } {
  const sessionKey = normalizeOptionalString(params.sessionKey);
  if (!sessionKey) {
    return { ok: false, error: "sessionKey is required" };
  }
  const runId = normalizeOptionalString(params.runId);
  if (!runId) {
    return { ok: false, error: "runId is required" };
  }
  const agentId = normalizeOptionalString(params.agentId);
  const waitMsRaw = params.waitMs;
  const waitMs =
    typeof waitMsRaw === "number" && Number.isFinite(waitMsRaw)
      ? Math.min(Math.max(0, Math.floor(waitMsRaw)), CHAT_FINAL_AUDIO_MAX_WAIT_MS)
      : CHAT_FINAL_AUDIO_DEFAULT_WAIT_MS;
  return { ok: true, value: { sessionKey, runId, agentId, waitMs } };
}

async function waitForChatFinalAudioRecord(params: {
  registry: ChatFinalAudioRegistry;
  request: ChatFinalAudioRequest;
}): Promise<ChatFinalAudioRecord | undefined> {
  const deadline = Date.now() + params.request.waitMs;
  while (true) {
    const record = params.registry.get(params.request);
    if (record || Date.now() >= deadline) {
      return record;
    }
    await new Promise((resolve) => setTimeout(resolve, CHAT_FINAL_AUDIO_POLL_MS));
  }
}

async function readChatFinalAudioPayload(params: {
  context: ChatFinalAudioRequestContext;
  request: ChatFinalAudioRequest;
  record: ChatFinalAudioRecord;
}): Promise<ProtocolChatFinalAudioGetResult> {
  const cfg = params.context.getRuntimeConfig();
  const localRoots = getAgentScopedMediaLocalRoots(
    cfg,
    params.record.mediaAgentId ?? params.record.agentId ?? params.request.agentId,
  );
  let opened: Awaited<ReturnType<typeof openLocalFileSafely>> | undefined;
  try {
    await assertLocalMediaAllowed(params.record.mediaPath, localRoots);
    opened = await openLocalFileSafely({ filePath: params.record.mediaPath });
    await assertLocalMediaAllowed(opened.realPath, localRoots);
    if (!isAudioFileName(opened.realPath)) {
      return { found: false, unavailableReason: "not_audio" };
    }
    if (opened.stat.size <= 0) {
      return { found: false, unavailableReason: "empty" };
    }
    if (opened.stat.size > MAX_CHAT_FINAL_AUDIO_BYTES) {
      return { found: false, unavailableReason: "too_large" };
    }
    const audio = await opened.handle.readFile();
    const fileExtension = path.extname(opened.realPath).toLowerCase() || undefined;
    const mimeType = mimeTypeFromFilePath(opened.realPath);
    const outputFormat = inferChatFinalAudioOutputFormat(opened.realPath);
    return {
      found: true,
      audioBase64: audio.toString("base64"),
      ...(outputFormat ? { outputFormat } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(fileExtension ? { fileExtension } : {}),
      ...(params.record.spokenText ? { spokenText: params.record.spokenText } : {}),
    };
  } catch (err) {
    params.context.logGateway.warn(`chat.finalAudio.get skipped local audio: ${formatForLog(err)}`);
    return { found: false, unavailableReason: "unreadable" };
  } finally {
    await opened?.handle.close().catch(() => {});
  }
}

function inferChatFinalAudioOutputFormat(filePath: string): ChatFinalAudioOutputFormat | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case ".opus":
      return "opus";
    case ".oga":
    case ".ogg":
      return "ogg";
    case ".mp3":
      return "mp3";
    case ".wav":
      return "wav";
    case ".m4a":
      return "m4a";
    case ".aac":
      return "aac";
    default:
      return undefined;
  }
}

function resolveLocalAudioPath(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed || /^data:/i.test(trimmed) || /^https?:/i.test(trimmed)) {
    return undefined;
  }
  if (trimmed.startsWith("file:")) {
    try {
      const resolved = safeFileURLToPath(trimmed);
      return path.isAbsolute(resolved) ? resolved : undefined;
    } catch {
      return undefined;
    }
  }
  if (!path.isAbsolute(trimmed)) {
    return undefined;
  }
  try {
    assertNoWindowsNetworkPath(trimmed, "Local audio path");
  } catch {
    return undefined;
  }
  return trimmed;
}
