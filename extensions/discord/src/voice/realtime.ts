import type { Readable } from "node:stream";
import { agentCommandFromIngress } from "openclaw/plugin-sdk/agent-runtime";
import type { DiscordAccountConfig, OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import {
  buildRealtimeVoiceAgentConsultChatMessage,
  createRealtimeVoiceBridgeSession,
  REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME,
  REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
  getRealtimeVoiceProvider,
  resolveConfiguredRealtimeVoiceProvider,
  resolveRealtimeVoiceAgentConsultTools,
  resolveRealtimeVoiceAgentConsultToolsAllow,
  type RealtimeVoiceBridgeSession,
  type RealtimeVoiceProviderConfig,
  type RealtimeVoiceToolCallEvent,
} from "openclaw/plugin-sdk/realtime-voice";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { createSubsystemLogger } from "openclaw/plugin-sdk/runtime-env";
import { formatErrorMessage } from "openclaw/plugin-sdk/ssrf-runtime";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import { formatMention } from "../mentions.js";
import { normalizeDiscordSlug } from "../monitor/allow-list.js";
import { buildDiscordGroupSystemPrompt } from "../monitor/inbound-context.js";
import { authorizeDiscordVoiceIngress } from "./access.js";
import {
  convertRealtimeOutputToDiscordPcm,
  createDiscordRawPcmStream,
  decodeOpusStreamRealtime,
} from "./audio.js";
import { loadDiscordVoiceSdk } from "./sdk-runtime.js";
import { logVoiceVerbose, type VoiceSessionEntry } from "./session.js";
import type { DiscordVoiceSpeakerContextResolver } from "./speaker-context.js";

const logger = createSubsystemLogger("discord/voice");
const DISCORD_VOICE_MESSAGE_PROVIDER = "discord-voice";
const MAX_DISCORD_REALTIME_OUTPUT_BUFFER_BYTES = 48_000 * 2 * 2 * 2;

export type DiscordRealtimeVoiceConfig = {
  enabled: boolean;
  provider?: string;
  model?: string;
  voice?: string;
};

type ActiveRealtimeSession = {
  bridge: RealtimeVoiceBridgeSession;
  output: DiscordRealtimePcmOutput;
  ingress: DiscordRealtimeVoiceIngressContext;
};

type DiscordRealtimeVoiceHandleResult = "handled" | "unavailable";

type DiscordRealtimeVoiceIngressContext = {
  extraSystemPrompt?: string;
  senderIsOwner: boolean;
};

function closeRealtimeSession(session: ActiveRealtimeSession): void {
  session.output.close();
  try {
    session.bridge.close();
  } catch (err) {
    logger.warn(`discord voice: realtime bridge close failed: ${formatErrorMessage(err)}`);
  }
}

class DiscordRealtimePcmOutput {
  private audioStream = { current: createDiscordRawPcmStream() };
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private pumpRunning = false;
  private closed = false;
  private wakeDrain: (() => void) | undefined;

  constructor(
    private readonly params: {
      entry: VoiceSessionEntry;
      voiceSdk: ReturnType<typeof loadDiscordVoiceSdk>;
    },
  ) {}

  start(): void {
    this.playAudioStream();
  }

  isOpen(): boolean {
    return !this.closed;
  }

  sendAudio(audio: Buffer): void {
    if (this.closed) {
      return;
    }
    const pcm = convertRealtimeOutputToDiscordPcm(audio);
    this.queue.push(pcm);
    this.queuedBytes += pcm.length;
    if (this.totalBufferedBytes() > MAX_DISCORD_REALTIME_OUTPUT_BUFFER_BYTES) {
      logger.warn("discord voice: realtime output backlog exceeded; resetting playback");
      this.resetAudioStream({ dropQueue: true });
      return;
    }
    this.pump();
  }

  clear(): void {
    if (this.closed) {
      return;
    }
    this.resetAudioStream({ dropQueue: true });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.queue = [];
    this.queuedBytes = 0;
    this.wakeDrain?.();
    this.wakeDrain = undefined;
    this.audioStream.current.destroy();
  }

  private totalBufferedBytes(): number {
    return this.queuedBytes + this.audioStream.current.writableLength;
  }

  private playAudioStream(): void {
    this.params.entry.player.play(
      this.params.voiceSdk.createAudioResource(this.audioStream.current, {
        inputType: this.params.voiceSdk.StreamType.Raw,
      }),
    );
  }

  private resetAudioStream(options: { dropQueue: boolean }): void {
    if (options.dropQueue) {
      this.queue = [];
      this.queuedBytes = 0;
    }
    this.wakeDrain?.();
    this.wakeDrain = undefined;
    this.audioStream.current.destroy();
    this.audioStream.current = createDiscordRawPcmStream();
    this.playAudioStream();
  }

  private ensureStreamReady(): void {
    if (this.audioStream.current.destroyed) {
      this.resetAudioStream({ dropQueue: false });
      return;
    }
    if (this.params.entry.player.state.status === this.params.voiceSdk.AudioPlayerStatus.Idle) {
      this.resetAudioStream({ dropQueue: false });
    }
  }

  private pump(): void {
    if (this.pumpRunning) {
      return;
    }
    this.pumpRunning = true;
    void this.pumpLoop();
  }

  private async pumpLoop(): Promise<void> {
    try {
      while (!this.closed && this.queue.length > 0) {
        this.ensureStreamReady();
        if (this.totalBufferedBytes() > MAX_DISCORD_REALTIME_OUTPUT_BUFFER_BYTES) {
          logger.warn("discord voice: realtime output stream exceeded; resetting playback");
          this.resetAudioStream({ dropQueue: true });
          continue;
        }
        const chunk = this.queue.shift();
        if (!chunk) {
          continue;
        }
        this.queuedBytes -= chunk.length;
        const stream = this.audioStream.current;
        if (!stream.write(chunk)) {
          await this.waitForDrain(stream);
        }
      }
    } finally {
      this.pumpRunning = false;
      if (!this.closed && this.queue.length > 0) {
        this.pump();
      }
    }
  }

  private async waitForDrain(stream: ReturnType<typeof createDiscordRawPcmStream>): Promise<void> {
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        stream.off("drain", finish);
        stream.off("close", finish);
        stream.off("error", finish);
        if (this.wakeDrain === finish) {
          this.wakeDrain = undefined;
        }
        resolve();
      };
      this.wakeDrain = finish;
      stream.once("drain", finish);
      stream.once("close", finish);
      stream.once("error", finish);
    });
  }
}

function formatDiscordVoiceChannelLabel(channelId: string): string {
  try {
    return formatMention({ channelId });
  } catch {
    return `channel ${channelId}`;
  }
}

export class DiscordRealtimeVoiceBridgeController {
  private readonly realtimeConfig: DiscordRealtimeVoiceConfig | undefined;
  private active = new Map<string, ActiveRealtimeSession>();

  constructor(
    private params: {
      cfg: OpenClawConfig;
      discordConfig: DiscordAccountConfig;
      runtime: RuntimeEnv;
      ownerAllowFrom?: string[];
      speakerContext: DiscordVoiceSpeakerContextResolver;
      fetchGuildName: (guildId: string) => Promise<string | undefined>;
    },
  ) {
    this.realtimeConfig = normalizeRealtimeConfig(
      (params.discordConfig.voice as { realtime?: unknown } | undefined)?.realtime,
    );
  }

  isEnabled(): boolean {
    return this.realtimeConfig?.enabled !== false;
  }

  stop(entry?: VoiceSessionEntry): void {
    for (const [key, session] of this.active) {
      if (entry && !key.startsWith(`${entry.guildId}:`)) {
        continue;
      }
      this.active.delete(key);
      closeRealtimeSession(session);
    }
  }

  async handleSpeakingStream(params: {
    entry: VoiceSessionEntry;
    userId: string;
    stream: Readable;
  }): Promise<DiscordRealtimeVoiceHandleResult> {
    if (!this.isEnabled()) {
      return "unavailable";
    }
    const { entry, userId, stream } = params;
    const ingress = await this.authorizeSpeaker(entry, userId);
    if (!ingress) {
      stream.destroy();
      return "handled";
    }
    let active: ActiveRealtimeSession;
    try {
      active = await this.ensureSession(entry, userId, ingress);
    } catch (err) {
      logger.warn(
        `discord voice: realtime unavailable; falling back to legacy batch voice: ${formatErrorMessage(err)}`,
      );
      return "unavailable";
    }
    const key = `${entry.guildId}:${userId}`;
    await decodeOpusStreamRealtime(stream, {
      onPcm24kMono: (pcm) => {
        if (this.active.get(key) === active) {
          active.bridge.sendAudio(pcm);
        }
      },
      onVerbose: logVoiceVerbose,
      onWarn: (message) => logger.warn(message),
    });
    return "handled";
  }

  private async authorizeSpeaker(
    entry: VoiceSessionEntry,
    userId: string,
  ): Promise<DiscordRealtimeVoiceIngressContext | undefined> {
    if (!entry.guildName) {
      entry.guildName = await this.params.fetchGuildName(entry.guildId);
    }
    const speaker = await this.params.speakerContext.resolveContext(entry.guildId, userId);
    const speakerIdentity = await this.params.speakerContext.resolveIdentity(entry.guildId, userId);
    const access = await authorizeDiscordVoiceIngress({
      cfg: this.params.cfg,
      discordConfig: this.params.discordConfig,
      guildName: entry.guildName,
      guildId: entry.guildId,
      channelId: entry.channelId,
      channelName: entry.channelName,
      channelSlug: entry.channelName ? normalizeDiscordSlug(entry.channelName) : "",
      channelLabel: formatDiscordVoiceChannelLabel(entry.channelId),
      memberRoleIds: speakerIdentity.memberRoleIds,
      ownerAllowFrom: this.params.ownerAllowFrom,
      sender: {
        id: speakerIdentity.id,
        name: speakerIdentity.name,
        tag: speakerIdentity.tag,
      },
    });
    if (!access.ok) {
      logVoiceVerbose(
        `realtime unauthorized: guild ${entry.guildId} channel ${entry.channelId} user ${userId} reason=${access.message}`,
      );
      return undefined;
    }
    return {
      extraSystemPrompt: buildDiscordGroupSystemPrompt(access.channelConfig),
      senderIsOwner: speaker.senderIsOwner,
    };
  }

  private async ensureSession(
    entry: VoiceSessionEntry,
    userId: string,
    ingress: DiscordRealtimeVoiceIngressContext,
  ): Promise<ActiveRealtimeSession> {
    const key = `${entry.guildId}:${userId}`;
    const existing = this.active.get(key);
    if (existing) {
      return existing;
    }

    const providerSelection = resolveDiscordRealtimeProviderSelection(
      this.params.cfg,
      this.realtimeConfig,
    );
    const resolution = resolveConfiguredRealtimeVoiceProvider({
      configuredProviderId: providerSelection.provider,
      providerConfigs: providerSelection.providers,
      cfg: this.params.cfg,
      cfgForResolve: this.params.cfg,
      noRegisteredProviderMessage: "No realtime voice provider registered",
    });
    const providerConfig = withRealtimeOverrides(resolution.providerConfig, this.realtimeConfig);
    this.stop(entry);
    const voiceSdk = loadDiscordVoiceSdk();
    const output = new DiscordRealtimePcmOutput({ entry, voiceSdk });
    let active: ActiveRealtimeSession | undefined;
    const isActive = () => active !== undefined && this.active.get(key) === active;
    const bridge = createRealtimeVoiceBridgeSession({
      provider: resolution.provider,
      providerConfig,
      audioFormat: REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
      audioSink: {
        isOpen: () => isActive() && output.isOpen(),
        sendAudio: (audio) => {
          if (!isActive()) {
            return;
          }
          output.sendAudio(audio);
        },
        clearAudio: () => {
          if (!isActive()) {
            return;
          }
          output.clear();
        },
      },
      instructions: buildDiscordRealtimeInstructions(entry),
      markStrategy: "ack-immediately",
      tools: resolveRealtimeVoiceAgentConsultTools("safe-read-only"),
      onToolCall: (event, session) => {
        if (!isActive()) {
          return;
        }
        void this.handleToolCall({ entry, event, session, userId });
      },
      onError: (error) => {
        if (!isActive()) {
          return;
        }
        logger.warn(`discord voice: realtime bridge error: ${formatErrorMessage(error)}`);
      },
      onClose: () => {
        if (!isActive()) {
          return;
        }
        this.active.delete(key);
        output.close();
      },
    });
    active = { output, bridge, ingress };
    this.active.set(key, active);
    try {
      output.start();
      await bridge.connect();
      logVoiceVerbose(
        `realtime ready: guild ${entry.guildId} channel ${entry.channelId} user ${userId} provider=${resolution.provider.id}`,
      );
    } catch (err) {
      this.active.delete(key);
      closeRealtimeSession(active);
      throw err;
    }
    return active;
  }

  private async handleToolCall(params: {
    entry: VoiceSessionEntry;
    event: RealtimeVoiceToolCallEvent;
    session: RealtimeVoiceBridgeSession;
    userId: string;
  }) {
    const { event, session } = params;
    if (event.name !== REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME) {
      session.submitToolResult(event.callId, {
        error: `Tool "${event.name}" is not available in Discord realtime voice.`,
      });
      return;
    }
    try {
      const ingress = this.active.get(`${params.entry.guildId}:${params.userId}`)?.ingress;
      const result = await agentCommandFromIngress(
        {
          message: buildRealtimeVoiceAgentConsultChatMessage(event.args),
          sessionKey: params.entry.route.sessionKey,
          agentId: params.entry.route.agentId,
          messageChannel: "discord",
          messageProvider: DISCORD_VOICE_MESSAGE_PROVIDER,
          extraSystemPrompt: ingress?.extraSystemPrompt,
          senderIsOwner: ingress?.senderIsOwner ?? false,
          allowModelOverride: false,
          deliver: false,
          toolsAllow: resolveRealtimeVoiceAgentConsultToolsAllow("safe-read-only"),
        },
        this.params.runtime,
      );
      const replyText = (result.payloads ?? [])
        .map((payload) => payload.text)
        .filter((text) => typeof text === "string" && text.trim())
        .join("\n")
        .trim();
      session.submitToolResult(event.callId, {
        result: replyText || "OpenClaw finished with no text.",
      });
    } catch (err) {
      session.submitToolResult(event.callId, { error: formatErrorMessage(err) });
    }
  }
}

function normalizeRealtimeConfig(value: unknown): DiscordRealtimeVoiceConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled !== false,
    provider: normalizeOptionalString(record.provider),
    model: normalizeOptionalString(record.model),
    voice: normalizeOptionalString(record.voice),
  };
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getVoiceCallRealtimeConfig(config: OpenClawConfig): {
  provider?: string;
  providers?: Record<string, RealtimeVoiceProviderConfig>;
} {
  const plugins = getRecord(config.plugins);
  const entries = getRecord(plugins?.entries);
  const voiceCall = getRecord(entries?.["voice-call"]);
  const pluginConfig = getRecord(voiceCall?.config);
  const realtime = getRecord(pluginConfig?.realtime);
  const providersRaw = getRecord(realtime?.providers);
  const providers: Record<string, RealtimeVoiceProviderConfig> = {};
  if (providersRaw) {
    for (const [providerId, providerConfig] of Object.entries(providersRaw)) {
      const record = getRecord(providerConfig);
      if (record) {
        providers[providerId] = record;
      }
    }
  }
  return {
    provider: normalizeOptionalString(realtime?.provider),
    providers: Object.keys(providers).length > 0 ? providers : undefined,
  };
}

export function resolveDiscordRealtimeProviderSelection(
  cfg: OpenClawConfig,
  realtimeConfig?: DiscordRealtimeVoiceConfig,
): {
  provider?: string;
  providers?: Record<string, RealtimeVoiceProviderConfig>;
} {
  const voiceCallRealtime = getVoiceCallRealtimeConfig(cfg);
  const talkProviderConfigs = cfg.talk?.providers as
    | Record<string, RealtimeVoiceProviderConfig>
    | undefined;
  const talkProvider = normalizeOptionalString(cfg.talk?.provider);
  const talkProviderSupportsRealtime = talkProvider
    ? Boolean(getRealtimeVoiceProvider(talkProvider, cfg))
    : false;
  const providers = {
    ...voiceCallRealtime.providers,
    ...talkProviderConfigs,
  };
  return {
    provider:
      realtimeConfig?.provider ??
      (talkProviderSupportsRealtime ? talkProvider : undefined) ??
      voiceCallRealtime.provider,
    providers: Object.keys(providers).length > 0 ? providers : undefined,
  };
}

function withRealtimeOverrides(
  providerConfig: RealtimeVoiceProviderConfig,
  config: DiscordRealtimeVoiceConfig | undefined,
): RealtimeVoiceProviderConfig {
  const model = config?.model;
  const voice = config?.voice;
  return model || voice
    ? {
        ...providerConfig,
        ...(model ? { model } : {}),
        ...(voice ? { voice } : {}),
      }
    : providerConfig;
}

function buildDiscordRealtimeInstructions(entry: VoiceSessionEntry): string {
  return [
    "You are OpenClaw speaking live in a Discord voice channel.",
    "Keep replies concise, natural, and speakable.",
    "Use openclaw_agent_consult before answering questions that need tools, current information, or careful reasoning.",
    entry.channelName ? `Discord channel: ${entry.channelName}` : undefined,
    entry.guildName ? `Discord guild: ${entry.guildName}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
