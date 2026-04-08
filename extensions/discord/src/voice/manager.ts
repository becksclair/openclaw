import path from "node:path";
import { ChannelType, type Client, ReadyListener } from "@buape/carbon";
import type { VoicePlugin } from "@buape/carbon/voice";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { DiscordAccountConfig, DiscordVoiceBackend } from "openclaw/plugin-sdk/config-runtime";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { createSubsystemLogger } from "openclaw/plugin-sdk/runtime-env";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { formatErrorMessage } from "openclaw/plugin-sdk/ssrf-runtime";
import { formatMention } from "../mentions.js";
import {
  normalizeDiscordSlug,
  resolveDiscordChannelConfig,
  resolveDiscordGuildEntry,
} from "../monitor/allow-list.js";
import { authorizeDiscordVoiceIngress } from "./access.js";
import { decodeDiscordOpusStream, writeDiscordVoiceWavFile } from "./audio-processing.js";
import {
  beginVoiceCapture,
  clearVoiceCaptureFinalizeTimer,
  createVoiceCaptureState,
  finishVoiceCapture,
  getActiveVoiceCapture,
  isVoiceCaptureActive,
  scheduleVoiceCaptureFinalize,
  stopVoiceCaptureState,
  type VoiceCaptureState,
} from "./capture-state.js";
import { generateDiscordLegacyReply, synthesizeDiscordVoiceReplyAudio } from "./legacy-reply.js";
import {
  generateDiscordRealtimeReply,
  type DiscordRealtimeVoiceEntry,
} from "./realtime-runtime.js";
import {
  analyzeVoiceReceiveError,
  createVoiceReceiveRecoveryState,
  DAVE_RECEIVE_PASSTHROUGH_INITIAL_EXPIRY_SECONDS,
  DAVE_RECEIVE_PASSTHROUGH_REARM_EXPIRY_SECONDS,
  enableDaveReceivePassthrough as tryEnableDaveReceivePassthrough,
  finishVoiceDecryptRecovery,
  noteVoiceDecryptFailure,
  resetVoiceReceiveRecoveryState,
  type VoiceReceiveRecoveryState,
} from "./receive-recovery.js";
import { loadDiscordVoiceSdk } from "./sdk-runtime.js";
import { DiscordVoiceSpeakerResolver } from "./speaker-context.js";

const DEFAULT_VOICE_BACKEND: DiscordVoiceBackend = "stt-agent-tts";
const MIN_SEGMENT_SECONDS = 0.35;
const CAPTURE_FINALIZE_GRACE_MS = 1_200;
const VOICE_CONNECT_READY_TIMEOUT_MS = 15_000;
const PLAYBACK_READY_TIMEOUT_MS = 60_000;
const SPEAKING_READY_TIMEOUT_MS = 60_000;
const REALTIME_FIRST_OUTPUT_TIMEOUT_MS = 12_000;

const logger = createSubsystemLogger("discord/voice");

const logVoiceVerbose = (message: string) => {
  logVerbose(`discord voice: ${message}`);
};

type VoiceOperationResult = {
  ok: boolean;
  message: string;
  channelId?: string;
  guildId?: string;
};

type VoiceSessionEntry = DiscordRealtimeVoiceEntry & {
  guildName?: string;
  channelName?: string;
  sessionChannelId: string;
  connection: import("@discordjs/voice").VoiceConnection;
  player: import("@discordjs/voice").AudioPlayer;
  playbackQueue: Promise<void>;
  processingQueue: Promise<void>;
  capture: VoiceCaptureState;
  receiveRecovery: VoiceReceiveRecoveryState;
  stop: () => void;
};

export class DiscordVoiceManager {
  private sessions = new Map<string, VoiceSessionEntry>();
  private botUserId?: string;
  private readonly voiceEnabled: boolean;
  private autoJoinTask: Promise<void> | null = null;
  private readonly defaultVoiceBackend: DiscordVoiceBackend;
  private readonly speakerResolver: DiscordVoiceSpeakerResolver;

  constructor(
    private params: {
      client: Client;
      cfg: OpenClawConfig;
      discordConfig: DiscordAccountConfig;
      accountId: string;
      runtime: RuntimeEnv;
      botUserId?: string;
    },
  ) {
    this.botUserId = params.botUserId;
    this.voiceEnabled = params.discordConfig.voice?.enabled !== false;
    this.defaultVoiceBackend = params.discordConfig.voice?.backend ?? DEFAULT_VOICE_BACKEND;
    const ownerAllowFrom =
      params.discordConfig.allowFrom ?? params.discordConfig.dm?.allowFrom ?? [];
    this.speakerResolver = new DiscordVoiceSpeakerResolver(
      params.client,
      params.discordConfig,
      ownerAllowFrom,
    );
    logger.info(`discord voice: default backend configured as ${this.defaultVoiceBackend}`);
  }

  private resolveVoiceBackend(params: {
    guildId: string;
    guild?: { id?: string; name?: string } | null;
    channelId: string;
    channelName?: string;
  }): DiscordVoiceBackend {
    const guildInfo = resolveDiscordGuildEntry({
      guildId: params.guildId,
      guild: params.guild as never,
      guildEntries: this.params.discordConfig.guilds,
    });
    const channelConfig = resolveDiscordChannelConfig({
      guildInfo,
      channelId: params.channelId,
      channelName: params.channelName,
      channelSlug: params.channelName ? normalizeDiscordSlug(params.channelName) : "",
    });
    return channelConfig?.voiceBackend ?? guildInfo?.voiceBackend ?? this.defaultVoiceBackend;
  }

  setBotUserId(id?: string) {
    if (id) {
      this.botUserId = id;
    }
  }

  isEnabled() {
    return this.voiceEnabled;
  }

  async autoJoin(): Promise<void> {
    if (!this.voiceEnabled) {
      return;
    }
    if (this.autoJoinTask) {
      return this.autoJoinTask;
    }
    this.autoJoinTask = (async () => {
      const entries = this.params.discordConfig.voice?.autoJoin ?? [];
      logVoiceVerbose(`autoJoin: ${entries.length} entries`);
      const seenGuilds = new Set<string>();
      for (const entry of entries) {
        const guildId = entry.guildId.trim();
        if (!guildId) {
          continue;
        }
        if (seenGuilds.has(guildId)) {
          logger.warn(
            `discord voice: autoJoin has multiple entries for guild ${guildId}; skipping`,
          );
          continue;
        }
        seenGuilds.add(guildId);
        logVoiceVerbose(`autoJoin: joining guild ${guildId} channel ${entry.channelId}`);
        await this.join({
          guildId: entry.guildId,
          channelId: entry.channelId,
        });
      }
    })().finally(() => {
      this.autoJoinTask = null;
    });
    return this.autoJoinTask;
  }

  status(): VoiceOperationResult[] {
    return Array.from(this.sessions.values()).map((session) => ({
      ok: true,
      message: `connected: guild ${session.guildId} channel ${session.channelId}`,
      guildId: session.guildId,
      channelId: session.channelId,
    }));
  }

  async join(params: { guildId: string; channelId: string }): Promise<VoiceOperationResult> {
    if (!this.voiceEnabled) {
      return {
        ok: false,
        message: "Discord voice is disabled (channels.discord.voice.enabled).",
      };
    }
    const guildId = params.guildId.trim();
    const channelId = params.channelId.trim();
    if (!guildId || !channelId) {
      return { ok: false, message: "Missing guildId or channelId." };
    }
    logVoiceVerbose(`join requested: guild ${guildId} channel ${channelId}`);

    const existing = this.sessions.get(guildId);
    if (existing && existing.channelId === channelId) {
      logVoiceVerbose(`join: already connected to guild ${guildId} channel ${channelId}`);
      return {
        ok: true,
        message: `Already connected to ${formatMention({ channelId })}.`,
        guildId,
        channelId,
      };
    }
    if (existing) {
      logVoiceVerbose(`join: replacing existing session for guild ${guildId}`);
      await this.leave({ guildId });
    }

    const channelInfo = await this.params.client.fetchChannel(channelId).catch(() => null);
    if (!channelInfo || ("type" in channelInfo && !isVoiceChannel(channelInfo.type))) {
      return { ok: false, message: `Channel ${channelId} is not a voice channel.` };
    }
    const channelGuildId = "guildId" in channelInfo ? channelInfo.guildId : undefined;
    if (channelGuildId && channelGuildId !== guildId) {
      return { ok: false, message: "Voice channel is not in this guild." };
    }

    const voicePlugin = this.params.client.getPlugin<VoicePlugin>("voice");
    if (!voicePlugin) {
      return { ok: false, message: "Discord voice plugin is not available." };
    }

    const adapterCreator = voicePlugin.getGatewayAdapterCreator(guildId);
    const daveEncryption = this.params.discordConfig.voice?.daveEncryption;
    const decryptionFailureTolerance = this.params.discordConfig.voice?.decryptionFailureTolerance;
    logVoiceVerbose(
      `join: DAVE settings encryption=${daveEncryption === false ? "off" : "on"} tolerance=${
        decryptionFailureTolerance ?? "default"
      }`,
    );
    const voiceSdk = loadDiscordVoiceSdk();
    const connection = voiceSdk.joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator,
      selfDeaf: false,
      selfMute: false,
      daveEncryption,
      decryptionFailureTolerance,
    });

    try {
      await voiceSdk.entersState(
        connection,
        voiceSdk.VoiceConnectionStatus.Ready,
        VOICE_CONNECT_READY_TIMEOUT_MS,
      );
      logVoiceVerbose(`join: connected to guild ${guildId} channel ${channelId}`);
    } catch (err) {
      connection.destroy();
      return { ok: false, message: `Failed to join voice channel: ${formatErrorMessage(err)}` };
    }

    const sessionChannelId = channelInfo?.id ?? channelId;
    // Use the voice channel id as the session channel so text chat in the voice channel
    // shares the same session as spoken audio.
    if (sessionChannelId !== channelId) {
      logVoiceVerbose(
        `join: using session channel ${sessionChannelId} for voice channel ${channelId}`,
      );
    }
    const route = resolveAgentRoute({
      cfg: this.params.cfg,
      channel: "discord",
      accountId: this.params.accountId,
      guildId,
      peer: { kind: "channel", id: sessionChannelId },
    });
    const guildName =
      channelInfo &&
      "guild" in channelInfo &&
      channelInfo.guild &&
      typeof channelInfo.guild.name === "string"
        ? channelInfo.guild.name
        : undefined;
    const channelName =
      channelInfo && "name" in channelInfo && typeof channelInfo.name === "string"
        ? channelInfo.name
        : undefined;
    const voiceBackend = this.resolveVoiceBackend({
      guildId,
      guild:
        channelInfo &&
        "guild" in channelInfo &&
        channelInfo.guild &&
        typeof channelInfo.guild.name === "string"
          ? { id: channelInfo.guild.id, name: channelInfo.guild.name }
          : guildName
            ? { id: guildId, name: guildName }
            : null,
      channelId: sessionChannelId,
      channelName,
    });

    const player = voiceSdk.createAudioPlayer();
    connection.subscribe(player);

    let speakingHandler: ((userId: string) => void) | undefined;
    let speakingEndHandler: ((userId: string) => void) | undefined;
    let disconnectedHandler: (() => Promise<void>) | undefined;
    let destroyedHandler: (() => void) | undefined;
    let playerErrorHandler: ((err: Error) => void) | undefined;
    const clearSessionIfCurrent = () => {
      const active = this.sessions.get(guildId);
      if (active?.connection === connection) {
        this.sessions.delete(guildId);
      }
    };

    const entry: VoiceSessionEntry = {
      guildId,
      guildName,
      channelId,
      channelName,
      sessionChannelId,
      route,
      voiceBackend,
      connection,
      player,
      playbackQueue: Promise.resolve(),
      processingQueue: Promise.resolve(),
      capture: createVoiceCaptureState(),
      receiveRecovery: createVoiceReceiveRecoveryState(),
      realtime: undefined,
      realtimeReady: undefined,
      realtimeSenderIsOwner: undefined,
      realtimeDisabled: false,
      realtimeConnectedOnce: false,
      realtimeEpoch: 0,
      realtimeReplayHistory: [],
      stop: () => {
        if (speakingHandler) {
          connection.receiver.speaking.off("start", speakingHandler);
        }
        if (speakingEndHandler) {
          connection.receiver.speaking.off("end", speakingEndHandler);
        }
        stopVoiceCaptureState(entry.capture);
        if (disconnectedHandler) {
          connection.off(voiceSdk.VoiceConnectionStatus.Disconnected, disconnectedHandler);
        }
        if (destroyedHandler) {
          connection.off(voiceSdk.VoiceConnectionStatus.Destroyed, destroyedHandler);
        }
        if (playerErrorHandler) {
          player.off("error", playerErrorHandler);
        }
        player.stop();
        void entry.realtime?.close("discord voice session stopped").catch((err) => {
          logger.warn(`discord voice: realtime close failed: ${formatErrorMessage(err)}`);
        });
        connection.destroy();
      },
    };

    speakingHandler = (userId: string) => {
      void this.handleSpeakingStart(entry, userId).catch((err) => {
        logger.warn(`discord voice: capture failed: ${formatErrorMessage(err)}`);
      });
    };
    speakingEndHandler = (userId: string) => {
      this.scheduleCaptureFinalize(entry, userId, "speaker end");
    };

    disconnectedHandler = async () => {
      try {
        await Promise.race([
          voiceSdk.entersState(connection, voiceSdk.VoiceConnectionStatus.Signalling, 5_000),
          voiceSdk.entersState(connection, voiceSdk.VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        clearSessionIfCurrent();
        connection.destroy();
      }
    };
    destroyedHandler = () => {
      clearSessionIfCurrent();
    };
    playerErrorHandler = (err: Error) => {
      logger.warn(`discord voice: playback error: ${formatErrorMessage(err)}`);
    };

    this.enableDaveReceivePassthrough(
      entry,
      "post-join warmup",
      DAVE_RECEIVE_PASSTHROUGH_INITIAL_EXPIRY_SECONDS,
    );
    connection.receiver.speaking.on("start", speakingHandler);
    connection.receiver.speaking.on("end", speakingEndHandler);
    connection.on(voiceSdk.VoiceConnectionStatus.Disconnected, disconnectedHandler);
    connection.on(voiceSdk.VoiceConnectionStatus.Destroyed, destroyedHandler);
    player.on("error", playerErrorHandler);

    this.sessions.set(guildId, entry);
    return {
      ok: true,
      message: `Joined ${formatMention({ channelId })}.`,
      guildId,
      channelId,
    };
  }

  async leave(params: { guildId: string; channelId?: string }): Promise<VoiceOperationResult> {
    const guildId = params.guildId.trim();
    logVoiceVerbose(`leave requested: guild ${guildId} channel ${params.channelId ?? "current"}`);
    const entry = this.sessions.get(guildId);
    if (!entry) {
      return { ok: false, message: "Not connected to a voice channel." };
    }
    if (params.channelId && params.channelId !== entry.channelId) {
      return { ok: false, message: "Not connected to that voice channel." };
    }
    entry.stop();
    this.sessions.delete(guildId);
    logVoiceVerbose(`leave: disconnected from guild ${guildId} channel ${entry.channelId}`);
    return {
      ok: true,
      message: `Left ${formatMention({ channelId: entry.channelId })}.`,
      guildId,
      channelId: entry.channelId,
    };
  }

  async destroy(): Promise<void> {
    for (const entry of this.sessions.values()) {
      entry.stop();
    }
    this.sessions.clear();
  }

  private enqueueProcessing(entry: VoiceSessionEntry, task: () => Promise<void>) {
    entry.processingQueue = entry.processingQueue
      .then(task)
      .catch((err) => logger.warn(`discord voice: processing failed: ${formatErrorMessage(err)}`));
  }

  private enqueuePlayback(entry: VoiceSessionEntry, task: () => Promise<void>) {
    entry.playbackQueue = entry.playbackQueue
      .then(task)
      .catch((err) => logger.warn(`discord voice: playback failed: ${formatErrorMessage(err)}`));
  }

  private clearCaptureFinalizeTimer(entry: VoiceSessionEntry, userId: string, generation?: number) {
    return clearVoiceCaptureFinalizeTimer(entry.capture, userId, generation);
  }

  private scheduleCaptureFinalize(entry: VoiceSessionEntry, userId: string, reason: string) {
    scheduleVoiceCaptureFinalize({
      state: entry.capture,
      userId,
      delayMs: CAPTURE_FINALIZE_GRACE_MS,
      onFinalize: () => {
        logVoiceVerbose(
          `capture finalize: guild ${entry.guildId} channel ${entry.channelId} user ${userId} reason=${reason} grace=${CAPTURE_FINALIZE_GRACE_MS}ms`,
        );
      },
    });
  }

  private async handleSpeakingStart(entry: VoiceSessionEntry, userId: string) {
    if (!userId) {
      return;
    }
    if (this.botUserId && userId === this.botUserId) {
      return;
    }
    if (isVoiceCaptureActive(entry.capture, userId)) {
      const activeCapture = getActiveVoiceCapture(entry.capture, userId);
      const extended = activeCapture
        ? this.clearCaptureFinalizeTimer(entry, userId, activeCapture.generation)
        : false;
      logVoiceVerbose(
        `capture start ignored (already active): guild ${entry.guildId} channel ${entry.channelId} user ${userId}${extended ? " (finalize canceled)" : ""}`,
      );
      return;
    }

    logger.info(
      `discord voice: capture start for guild ${entry.guildId} channel ${entry.channelId} user ${userId}`,
    );
    logVoiceVerbose(
      `capture start: guild ${entry.guildId} channel ${entry.channelId} user ${userId}`,
    );
    const voiceSdk = loadDiscordVoiceSdk();
    this.enableDaveReceivePassthrough(
      entry,
      `speaker ${userId} start`,
      DAVE_RECEIVE_PASSTHROUGH_REARM_EXPIRY_SECONDS,
    );

    const stream = entry.connection.receiver.subscribe(userId, {
      end: {
        behavior: voiceSdk.EndBehaviorType.Manual,
      },
    });
    const generation = beginVoiceCapture(entry.capture, userId, stream);
    let streamAborted = false;
    stream.on("error", (err) => {
      streamAborted = analyzeVoiceReceiveError(err).isAbortLike;
      this.handleReceiveError(entry, err);
    });

    try {
      const pcm = await decodeDiscordOpusStream({ stream, logger, logVerbose: logVoiceVerbose });
      if (pcm.length === 0) {
        logVoiceVerbose(
          `capture empty: guild ${entry.guildId} channel ${entry.channelId} user ${userId}`,
        );
        return;
      }
      this.resetDecryptFailureState(entry);
      const { path: wavPath, durationSeconds } = await writeDiscordVoiceWavFile(pcm);
      const minimumDurationSeconds = streamAborted ? 0.2 : MIN_SEGMENT_SECONDS;
      if (durationSeconds < minimumDurationSeconds) {
        logger.info(
          `discord voice: capture too short (${durationSeconds.toFixed(2)}s) for guild ${entry.guildId} channel ${entry.channelId} user ${userId}`,
        );
        logVoiceVerbose(
          `capture too short (${durationSeconds.toFixed(2)}s): guild ${entry.guildId} channel ${entry.channelId} user ${userId}`,
        );
        return;
      }
      logger.info(
        `discord voice: capture ready (${durationSeconds.toFixed(2)}s) for guild ${entry.guildId} channel ${entry.channelId} user ${userId}`,
      );
      logVoiceVerbose(
        `capture ready (${durationSeconds.toFixed(2)}s): guild ${entry.guildId} channel ${entry.channelId} user ${userId}`,
      );
      if (entry.player.state.status === voiceSdk.AudioPlayerStatus.Playing) {
        entry.player.stop(true);
      }
      await entry.realtime?.interrupt("assistant").catch(() => undefined);
      this.enqueueProcessing(entry, async () => {
        await this.processSegment({ entry, wavPath, pcm, userId, durationSeconds });
      });
    } finally {
      finishVoiceCapture(entry.capture, userId, generation);
    }
  }

  private async processSegment(params: {
    entry: VoiceSessionEntry;
    wavPath: string;
    pcm: Buffer;
    userId: string;
    durationSeconds: number;
  }) {
    const { entry, wavPath, pcm, userId, durationSeconds } = params;
    const voiceBackend = entry.voiceBackend ?? this.defaultVoiceBackend;
    const needsMemberRoles = this.speakerResolver.voiceAccessNeedsMemberRoles(entry);
    logger.info(
      `discord voice: segment processing (${durationSeconds.toFixed(2)}s) for guild ${entry.guildId} channel ${entry.channelId} user ${userId} backend ${voiceBackend}`,
    );
    logVoiceVerbose(
      `segment processing (${durationSeconds.toFixed(2)}s): guild ${entry.guildId} channel ${entry.channelId}`,
    );
    if (!entry.guildName) {
      const guild = await this.params.client.fetchGuild(entry.guildId).catch(() => null);
      if (guild && typeof guild.name === "string" && guild.name.trim()) {
        entry.guildName = guild.name;
      }
    }
    const { speaker, memberRoleIds } = await this.speakerResolver.resolveSpeakerDetails(
      entry.guildId,
      userId,
      {
        needsMemberRoles,
      },
    );
    const access = await authorizeDiscordVoiceIngress({
      cfg: this.params.cfg,
      discordConfig: this.params.discordConfig,
      guildName: entry.guildName,
      guildId: entry.guildId,
      channelId: entry.channelId,
      channelName: entry.channelName,
      channelSlug: entry.channelName ? normalizeDiscordSlug(entry.channelName) : "",
      channelLabel: formatMention({ channelId: entry.channelId }),
      memberRoleIds,
      sender: {
        id: speaker.id,
        name: speaker.name,
        tag: speaker.tag,
      },
    });
    if (!access.ok) {
      logger.warn(
        `discord voice: segment unauthorized for guild ${entry.guildId} channel ${entry.channelId} user ${userId}: ${access.message}`,
      );
      logVoiceVerbose(
        `segment unauthorized: guild ${entry.guildId} channel ${entry.channelId} user ${userId} reason=${access.message}`,
      );
      return;
    }
    logger.info(
      `discord voice: dispatching segment for guild ${entry.guildId} channel ${entry.channelId} via ${voiceBackend}`,
    );
    const reply = await this.generateVoiceReply({
      entry,
      wavPath,
      pcm,
      senderLabel: speaker.label,
      senderIsOwner: speaker.senderIsOwner,
    });

    if (!reply.text && !reply.audioPath) {
      if (reply.superseded) {
        logVoiceVerbose(
          `reply superseded: guild ${entry.guildId} channel ${entry.channelId} user ${userId}`,
        );
        return;
      }
      logger.warn(
        `discord voice: reply empty for guild ${entry.guildId} channel ${entry.channelId} user ${userId}`,
      );
      logVoiceVerbose(
        `reply empty: guild ${entry.guildId} channel ${entry.channelId} user ${userId}`,
      );
      return;
    }
    logVoiceVerbose(
      `reply ok (${reply.text.length} chars): guild ${entry.guildId} channel ${entry.channelId}`,
    );

    const audioPath =
      reply.audioPath ??
      (await synthesizeDiscordVoiceReplyAudio({
        cfg: this.params.cfg,
        ttsOverride: this.params.discordConfig.voice?.tts,
        entry,
        replyText: reply.text,
        speakerLabel: speaker.label,
        logVerbose: logVoiceVerbose,
        logger,
      }));
    if (!audioPath) {
      return;
    }

    this.enqueuePlayback(entry, async () => {
      logVoiceVerbose(
        `playback start: guild ${entry.guildId} channel ${entry.channelId} file ${path.basename(audioPath)}`,
      );
      const voiceSdk = loadDiscordVoiceSdk();
      const resource = voiceSdk.createAudioResource(audioPath);
      entry.player.play(resource);
      await voiceSdk
        .entersState(entry.player, voiceSdk.AudioPlayerStatus.Playing, PLAYBACK_READY_TIMEOUT_MS)
        .catch(() => undefined);
      await voiceSdk
        .entersState(entry.player, voiceSdk.AudioPlayerStatus.Idle, SPEAKING_READY_TIMEOUT_MS)
        .catch(() => undefined);
      logVoiceVerbose(`playback done: guild ${entry.guildId} channel ${entry.channelId}`);
    });
  }

  private async generateVoiceReply(params: {
    entry: VoiceSessionEntry;
    wavPath: string;
    pcm: Buffer;
    senderLabel: string;
    senderIsOwner: boolean;
  }): Promise<{ text: string; audioPath?: string; superseded?: boolean }> {
    if ((params.entry.voiceBackend ?? this.defaultVoiceBackend) !== "realtime") {
      return await generateDiscordLegacyReply({
        cfg: this.params.cfg,
        runtime: this.params.runtime,
        entry: params.entry,
        wavPath: params.wavPath,
        senderLabel: params.senderLabel,
        senderIsOwner: params.senderIsOwner,
        logVerbose: logVoiceVerbose,
      });
    }

    const realtimeReply = await generateDiscordRealtimeReply({
      entry: params.entry,
      cfg: this.params.cfg,
      pcm: params.pcm,
      senderLabel: params.senderLabel,
      senderIsOwner: params.senderIsOwner,
      logger,
      logVerbose: logVoiceVerbose,
      replyTimeoutMs: SPEAKING_READY_TIMEOUT_MS,
      firstOutputTimeoutMs: REALTIME_FIRST_OUTPUT_TIMEOUT_MS,
    });
    if (!realtimeReply.fallbackToLegacy) {
      return realtimeReply;
    }
    logger.warn(
      `discord voice: realtime fallback -> stt-agent-tts for guild ${params.entry.guildId} channel ${params.entry.channelId}`,
    );
    logVoiceVerbose(
      `realtime fallback -> stt-agent-tts: guild ${params.entry.guildId} channel ${params.entry.channelId}`,
    );
    return await generateDiscordLegacyReply({
      cfg: this.params.cfg,
      runtime: this.params.runtime,
      entry: params.entry,
      wavPath: params.wavPath,
      senderLabel: params.senderLabel,
      senderIsOwner: params.senderIsOwner,
      logVerbose: logVoiceVerbose,
    });
  }

  private handleReceiveError(entry: VoiceSessionEntry, err: unknown) {
    const analysis = analyzeVoiceReceiveError(err);
    if (analysis.isAbortLike) {
      logVoiceVerbose(`receive aborted: guild ${entry.guildId} channel ${entry.channelId}`);
      return;
    }
    logger.warn(`discord voice: receive error: ${analysis.message}`);
    if (analysis.shouldAttemptPassthrough) {
      this.enableDaveReceivePassthrough(
        entry,
        "receive decrypt error",
        DAVE_RECEIVE_PASSTHROUGH_REARM_EXPIRY_SECONDS,
      );
    }
    if (!analysis.countsAsDecryptFailure) {
      return;
    }
    const decryptFailure = noteVoiceDecryptFailure(entry.receiveRecovery);
    if (decryptFailure.firstFailure) {
      logger.warn(
        "discord voice: DAVE decrypt failures detected; voice receive may be unstable (upstream: discordjs/discord.js#11419)",
      );
    }
    if (!decryptFailure.shouldRecover) {
      return;
    }
    void this.recoverFromDecryptFailures(entry)
      .catch((recoverErr) =>
        logger.warn(`discord voice: decrypt recovery failed: ${formatErrorMessage(recoverErr)}`),
      )
      .finally(() => {
        finishVoiceDecryptRecovery(entry.receiveRecovery);
      });
  }

  private enableDaveReceivePassthrough(
    entry: Pick<VoiceSessionEntry, "guildId" | "channelId" | "connection">,
    reason: string,
    expirySeconds: number,
  ): boolean {
    const voiceSdk = loadDiscordVoiceSdk();
    return tryEnableDaveReceivePassthrough({
      target: {
        guildId: entry.guildId,
        channelId: entry.channelId,
        connection: entry.connection as {
          state: {
            status: unknown;
            networking?: {
              state?: {
                code?: unknown;
                dave?: {
                  session?: {
                    setPassthroughMode: (passthrough: boolean, expirySeconds: number) => void;
                  };
                };
              };
            };
          };
        },
      },
      sdk: {
        VoiceConnectionStatus: {
          Ready: voiceSdk.VoiceConnectionStatus.Ready,
        },
        NetworkingStatusCode: {
          Ready: voiceSdk.NetworkingStatusCode.Ready,
          Resuming: voiceSdk.NetworkingStatusCode.Resuming,
        },
      },
      reason,
      expirySeconds,
      onVerbose: logVoiceVerbose,
      onWarn: (message) => logger.warn(message),
    });
  }

  private resetDecryptFailureState(entry: VoiceSessionEntry) {
    resetVoiceReceiveRecoveryState(entry.receiveRecovery);
  }

  private async recoverFromDecryptFailures(entry: VoiceSessionEntry) {
    const active = this.sessions.get(entry.guildId);
    if (!active || active.connection !== entry.connection) {
      return;
    }
    logger.warn(
      `discord voice: repeated decrypt failures; attempting rejoin for guild ${entry.guildId} channel ${entry.channelId}`,
    );
    const leaveResult = await this.leave({ guildId: entry.guildId });
    if (!leaveResult.ok) {
      logger.warn(`discord voice: decrypt recovery leave failed: ${leaveResult.message}`);
      return;
    }
    const result = await this.join({ guildId: entry.guildId, channelId: entry.channelId });
    if (!result.ok) {
      logger.warn(`discord voice: rejoin after decrypt failures failed: ${result.message}`);
    }
  }
}

export class DiscordVoiceReadyListener extends ReadyListener {
  constructor(private manager: DiscordVoiceManager) {
    super();
  }

  async handle(_data: unknown, _client: Client): Promise<void> {
    void this.manager
      .autoJoin()
      .catch((err) => logger.warn(`discord voice: autoJoin failed: ${formatErrorMessage(err)}`));
  }
}

function isVoiceChannel(type: ChannelType) {
  return type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice;
}
