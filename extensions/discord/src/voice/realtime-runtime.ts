import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { DiscordVoiceBackend } from "openclaw/plugin-sdk/config-runtime";
import {
  createManagedRealtimeConversationRuntime,
  type ManagedRealtimeConversationRuntime,
  type ManagedRealtimeConversationTurnDetectionOptions,
} from "openclaw/plugin-sdk/gateway-runtime";
import { appendTextMessagesToSessionTranscript } from "openclaw/plugin-sdk/session-store-runtime";
import { formatErrorMessage } from "openclaw/plugin-sdk/ssrf-runtime";
import {
  DISCORD_VOICE_CHANNELS,
  DISCORD_VOICE_SAMPLE_RATE,
  writeDiscordVoicePcmWavFile,
} from "./audio-processing.js";
import { formatVoiceIngressPrompt } from "./prompt.js";

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

export type DiscordRealtimeReplyResult = {
  text: string;
  audioPath?: string;
  fallbackToLegacy?: boolean;
  superseded?: boolean;
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

export async function generateDiscordRealtimeReply(params: {
  entry: DiscordRealtimeVoiceEntry;
  cfg: OpenClawConfig;
  pcm: Buffer;
  senderLabel: string;
  senderIsOwner: boolean;
  logger: { info(message: string): void; warn(message: string): void };
  logVerbose: (message: string) => void;
  replyTimeoutMs: number;
  firstOutputTimeoutMs: number;
}): Promise<DiscordRealtimeReplyResult> {
  const runtime = await ensureDiscordRealtimeRuntime({
    entry: params.entry,
    cfg: params.cfg,
    senderIsOwner: params.senderIsOwner,
    logger: params.logger,
    logVerbose: params.logVerbose,
  });
  if (!runtime) {
    return { text: "", fallbackToLegacy: !params.entry.realtimeConnectedOnce };
  }

  const replyEpoch = params.entry.realtimeEpoch;
  let replyText = "";
  let userTranscript = "";
  const audioChunks: Buffer[] = [];
  let settled = false;
  let fallbackToLegacy = false;
  let sawAssistantOutput = false;
  let sawToolActivity = false;
  let replayHistoryCommitted = false;
  const localTurnId = `local-${randomUUID()}`;
  let providerTurnId: string | undefined;
  let resolveReply: ((value: DiscordRealtimeReplyResult) => void) | undefined;
  let firstOutputTimeout: NodeJS.Timeout | undefined;

  const buildTurnHistory = (): PendingRealtimeTranscriptMessage[] => {
    const assistantText = replyText.trim();
    const normalizedUserText = formatVoiceIngressPrompt(userTranscript, params.senderLabel);
    const stableTurnId = providerTurnId ?? localTurnId;
    return [
      ...(normalizedUserText
        ? [
            {
              role: "user" as const,
              text: normalizedUserText,
              idempotencyKey: buildRealtimeTranscriptIdempotencyKey({
                sessionKey: params.entry.route.sessionKey,
                turnId: stableTurnId,
                role: "user",
              }),
            },
          ]
        : []),
      ...(assistantText
        ? [
            {
              role: "assistant" as const,
              text: assistantText,
              idempotencyKey: buildRealtimeTranscriptIdempotencyKey({
                sessionKey: params.entry.route.sessionKey,
                turnId: stableTurnId,
                role: "assistant",
              }),
            },
          ]
        : []),
    ];
  };

  const commitReplayHistory = async () => {
    if (replayHistoryCommitted || fallbackToLegacy) {
      return;
    }
    const turnHistory = buildTurnHistory();
    if (turnHistory.length === 0) {
      return;
    }
    try {
      const persisted = await appendTextMessagesToSessionTranscript({
        agentId: params.entry.route.agentId,
        sessionKey: params.entry.route.sessionKey,
        messages: [...params.entry.realtimeReplayHistory, ...turnHistory],
        assistantModel: "realtime-voice",
      });
      if (persisted.ok) {
        params.entry.realtimeReplayHistory = [];
        replayHistoryCommitted = true;
        return;
      }
      params.logger.warn(
        `discord voice: failed to persist realtime transcript for guild ${params.entry.guildId} channel ${params.entry.channelId}: ${persisted.reason}`,
      );
    } catch (err) {
      params.logger.warn(
        `discord voice: realtime transcript persistence crashed for guild ${params.entry.guildId} channel ${params.entry.channelId}: ${formatErrorMessage(err)}`,
      );
    }
    params.entry.realtimeReplayHistory = mergePendingRealtimeTranscriptMessages(
      params.entry.realtimeReplayHistory,
      turnHistory,
    );
    replayHistoryCommitted = true;
  };

  const finish = () => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    if (firstOutputTimeout) {
      clearTimeout(firstOutputTimeout);
    }
    unsubscribe();
    params.logger.info(
      `discord voice: finishing realtime reply for guild ${params.entry.guildId} channel ${params.entry.channelId} fallback=${fallbackToLegacy} afterOutput=${sawAssistantOutput} audioChunks=${audioChunks.length} textChars=${replyText.length}`,
    );
    if (audioChunks.length > 0) {
      void writeDiscordVoicePcmWavFile({
        pcm: Buffer.concat(audioChunks),
        sampleRate: 24_000,
        channels: 1,
      })
        .then((written) => {
          resolveReply?.({
            text: replyText.trim(),
            audioPath: written.path,
            ...(fallbackToLegacy ? { fallbackToLegacy: true } : {}),
          });
        })
        .catch((err) => {
          params.logger.warn(
            `discord voice: failed to write realtime audio reply for guild ${params.entry.guildId} channel ${params.entry.channelId}: ${formatErrorMessage(err)}`,
          );
          resolveReply?.({
            text: replyText.trim(),
            ...(fallbackToLegacy ? { fallbackToLegacy: true } : {}),
          });
        });
      return;
    }
    resolveReply?.({
      text: replyText.trim(),
      ...(fallbackToLegacy ? { fallbackToLegacy: true } : {}),
    });
  };

  const armFirstOutputTimeout = (reason: string) => {
    if (firstOutputTimeout) {
      clearTimeout(firstOutputTimeout);
    }
    firstOutputTimeout = setTimeout(() => {
      if (sawAssistantOutput || settled) {
        return;
      }
      params.logger.warn(
        `discord voice: realtime produced no output within ${params.firstOutputTimeoutMs}ms for guild ${params.entry.guildId} channel ${params.entry.channelId} (${reason})`,
      );
      fallbackToLegacy = true;
      void resetDiscordRealtimeRuntime({
        entry: params.entry,
        reason: "first output timeout",
        logger: params.logger,
      });
      finish();
    }, params.firstOutputTimeoutMs);
  };

  const replyPromise = new Promise<DiscordRealtimeReplyResult>((resolve) => {
    resolveReply = resolve;
  });
  const timeout = setTimeout(() => {
    params.logger.warn(
      `discord voice: realtime reply timed out for guild ${params.entry.guildId} channel ${params.entry.channelId}`,
    );
    if (!sawAssistantOutput) {
      fallbackToLegacy = true;
      void resetDiscordRealtimeRuntime({
        entry: params.entry,
        reason: "reply timeout",
        logger: params.logger,
      });
    }
    finish();
  }, params.replyTimeoutMs);

  armFirstOutputTimeout("awaiting first output");
  const unsubscribe = runtime.subscribe((event) => {
    if (params.entry.realtimeEpoch !== replyEpoch || settled) {
      return;
    }
    if (event.type === "transcript.updated" && event.item.role === "user") {
      if (event.item.status === "final") {
        userTranscript = event.item.text;
      }
      return;
    }
    if (event.type === "transcript.updated" && event.item.role === "assistant") {
      sawAssistantOutput = true;
      replyText = event.item.text;
      return;
    }
    if (event.type === "audio.output") {
      sawAssistantOutput = true;
      audioChunks.push(event.audio.chunk);
      return;
    }
    if (event.type === "tool.updated") {
      sawToolActivity = true;
      if (!sawAssistantOutput) {
        armFirstOutputTimeout(`tool ${event.update.status}`);
      }
      return;
    }
    if (
      event.type === "assistant.turn.updated" &&
      (event.turn.state === "completed" || event.turn.state === "interrupted")
    ) {
      if (typeof event.turn.turnId === "string" && event.turn.turnId.trim()) {
        providerTurnId = event.turn.turnId.trim();
      }
      params.logger.info(
        `discord voice: realtime assistant turn ${event.turn.state} for guild ${params.entry.guildId} channel ${params.entry.channelId} afterOutput=${sawAssistantOutput} audioChunks=${audioChunks.length} textChars=${replyText.length} sawToolActivity=${sawToolActivity}`,
      );
      if (event.turn.state === "completed" && !sawAssistantOutput && sawToolActivity) {
        params.logger.info(
          `discord voice: realtime completed without output after tool activity for guild ${params.entry.guildId} channel ${params.entry.channelId}; waiting for continuation`,
        );
        armFirstOutputTimeout("awaiting post-tool continuation");
        return;
      }
      if (event.turn.state === "interrupted" && !sawAssistantOutput) {
        settled = true;
        clearTimeout(timeout);
        if (firstOutputTimeout) {
          clearTimeout(firstOutputTimeout);
        }
        unsubscribe();
        resolveReply?.({ text: "", superseded: true });
        return;
      }
      if (event.turn.state === "completed" && !sawAssistantOutput) {
        params.logger.warn(
          `discord voice: realtime completed with no output for guild ${params.entry.guildId} channel ${params.entry.channelId}; falling back to legacy`,
        );
        fallbackToLegacy = true;
        void resetDiscordRealtimeRuntime({
          entry: params.entry,
          reason: "empty completion",
          logger: params.logger,
        });
      }
      if (event.turn.state === "completed") {
        void commitReplayHistory().finally(() => {
          finish();
        });
        return;
      }
      finish();
      return;
    }
    if (event.type === "fallback.changed") {
      params.logger.warn(
        `discord voice: realtime provider requested fallback for guild ${params.entry.guildId} channel ${params.entry.channelId} (${event.reason})`,
      );
      if (!sawAssistantOutput) {
        fallbackToLegacy = true;
      }
      void resetDiscordRealtimeRuntime({
        entry: params.entry,
        reason: "fallback",
        logger: params.logger,
      });
      finish();
      return;
    }
    if (event.type === "session.error") {
      params.logger.warn(
        `discord voice: realtime session error for guild ${params.entry.guildId} channel ${params.entry.channelId}: ${event.code} ${event.message}`,
      );
      if (!sawAssistantOutput) {
        fallbackToLegacy = true;
      }
      void resetDiscordRealtimeRuntime({
        entry: params.entry,
        reason: "session error",
        logger: params.logger,
      });
      finish();
    }
  });

  try {
    params.logger.info(
      `discord voice: submitting realtime audio for guild ${params.entry.guildId} channel ${params.entry.channelId} pcmBytes=${params.pcm.length}`,
    );
    await runtime.submitAudio(params.pcm, {
      sampleRate: DISCORD_VOICE_SAMPLE_RATE,
      channels: DISCORD_VOICE_CHANNELS,
    });
    return await replyPromise;
  } catch (err) {
    const message = formatErrorMessage(err);
    params.logger.warn(
      `discord voice: realtime submit failed for guild ${params.entry.guildId} channel ${params.entry.channelId}: ${message}`,
    );
    params.logVerbose(
      `realtime submit failed for guild ${params.entry.guildId} channel ${params.entry.channelId}: ${message}`,
    );
    await resetDiscordRealtimeRuntime({
      entry: params.entry,
      reason: "submit failed",
      logger: params.logger,
    });
    if (!sawAssistantOutput) {
      fallbackToLegacy = true;
    }
    finish();
    return await replyPromise;
  }
}
