import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { DiscordVoiceBackend } from "openclaw/plugin-sdk/config-runtime";
import {
  createManagedRealtimeConversationRuntime,
  type ManagedRealtimeConversationRuntime,
  type ManagedRealtimeConversationTurnDetectionOptions,
} from "openclaw/plugin-sdk/gateway-runtime";
import { formatErrorMessage } from "openclaw/plugin-sdk/ssrf-runtime";

export type PendingRealtimeTranscriptMessage = {
  role: "user" | "assistant";
  text: string;
  idempotencyKey: string;
};

export type DiscordRealtimeVoiceEntry = {
  guildId: string;
  channelId: string;
  route: { agentId: string; sessionKey: string };
  voiceBackend: DiscordVoiceBackend;
  realtime?: ManagedRealtimeConversationRuntime;
  realtimeReady?: Promise<void>;
  realtimeSenderIsOwner?: boolean;
  realtimeDisabled?: boolean;
  realtimeConnectedOnce: boolean;
  realtimeEpoch: number;
  realtimeReplayHistory: PendingRealtimeTranscriptMessage[];
};

export function buildRealtimeReplayHistoryOverlay(
  history: PendingRealtimeTranscriptMessage[] | undefined,
): Array<{ role: "user" | "assistant"; text: string }> {
  return (history ?? []).map((item) => ({ role: item.role, text: item.text }));
}

export function mergePendingRealtimeTranscriptMessages(
  base: PendingRealtimeTranscriptMessage[] | undefined,
  overlay: PendingRealtimeTranscriptMessage[],
): PendingRealtimeTranscriptMessage[] {
  const merged = [...(base ?? [])];
  const existingKeys = new Set((base ?? []).map((item) => item.idempotencyKey));
  for (const item of overlay) {
    if (existingKeys.has(item.idempotencyKey)) {
      continue;
    }
    merged.push(item);
    existingKeys.add(item.idempotencyKey);
  }
  return merged;
}

export function buildRealtimeTranscriptIdempotencyKey(params: {
  sessionKey: string;
  turnId: string;
  role: "user" | "assistant";
}): string {
  return `discord-voice:${params.sessionKey}:${params.turnId}:${params.role}`;
}

export function resolveRealtimeTurnDetectionOptions(
  cfg: OpenClawConfig,
): ManagedRealtimeConversationTurnDetectionOptions | undefined {
  const realtime = cfg.channels?.discord?.voice?.realtime;
  if (!realtime) {
    return undefined;
  }
  return {
    vadEagerness: realtime.vadEagerness,
    interruptResponse: realtime.interruptResponse,
  };
}

export async function resetDiscordRealtimeRuntime(params: {
  entry: DiscordRealtimeVoiceEntry;
  reason: string;
  logger: { info(message: string): void; warn(message: string): void };
  disable?: boolean;
}): Promise<void> {
  const { entry, reason, logger } = params;
  if (params.disable) {
    entry.realtimeDisabled = true;
    logger.warn(
      `discord voice: disabling realtime for guild ${entry.guildId} channel ${entry.channelId} (${reason})`,
    );
  } else {
    logger.info(
      `discord voice: resetting realtime runtime for guild ${entry.guildId} channel ${entry.channelId} (${reason})`,
    );
  }
  const runtime = entry.realtime;
  entry.realtimeEpoch += 1;
  entry.realtime = undefined;
  entry.realtimeReady = undefined;
  entry.realtimeSenderIsOwner = undefined;
  await runtime?.close(reason).catch(() => undefined);
}

export async function ensureDiscordRealtimeRuntime(params: {
  entry: DiscordRealtimeVoiceEntry;
  cfg: OpenClawConfig;
  senderIsOwner: boolean;
  logger: { info(message: string): void; warn(message: string): void };
  logVerbose: (message: string) => void;
}): Promise<ManagedRealtimeConversationRuntime | undefined> {
  const { entry, cfg, senderIsOwner, logger, logVerbose } = params;
  if (entry.realtimeDisabled) {
    return undefined;
  }
  if (entry.realtime && entry.realtimeSenderIsOwner !== senderIsOwner) {
    await resetDiscordRealtimeRuntime({
      entry,
      reason: "speaker ownership changed",
      logger,
    });
  }
  try {
    if (!entry.realtime) {
      logger.info(
        `discord voice: starting realtime runtime for guild ${entry.guildId} channel ${entry.channelId}`,
      );
      entry.realtimeEpoch += 1;
      entry.realtime = createManagedRealtimeConversationRuntime({
        cfg,
        agentId: entry.route.agentId,
        sessionKey: entry.route.sessionKey,
        senderIsOwner,
        transport: "discord",
        historyOverlay: buildRealtimeReplayHistoryOverlay(entry.realtimeReplayHistory),
        turnDetection: resolveRealtimeTurnDetectionOptions(cfg),
      });
      entry.realtimeSenderIsOwner = senderIsOwner;
      entry.realtimeReady = entry.realtime.start();
    }
    await entry.realtimeReady;
    entry.realtimeConnectedOnce = true;
    logger.info(
      `discord voice: realtime runtime ready for guild ${entry.guildId} channel ${entry.channelId}`,
    );
    return entry.realtime;
  } catch (err) {
    const message = formatErrorMessage(err);
    logger.warn(
      `discord voice: realtime startup failed for guild ${entry.guildId} channel ${entry.channelId}: ${message}`,
    );
    if (!entry.realtimeConnectedOnce) {
      logVerbose(
        `realtime disabled for guild ${entry.guildId} channel ${entry.channelId}: ${message}`,
      );
      await resetDiscordRealtimeRuntime({
        entry,
        reason: "startup failed",
        logger,
        disable: true,
      });
      return undefined;
    }
    logVerbose(
      `realtime startup failed after prior realtime success for guild ${entry.guildId} channel ${entry.channelId}: ${message}`,
    );
    await resetDiscordRealtimeRuntime({
      entry,
      reason: "startup failed after connect",
      logger,
    });
    return undefined;
  }
}
