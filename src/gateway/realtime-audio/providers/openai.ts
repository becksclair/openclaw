import WebSocket, { type ClientOptions } from "ws";
import { resolveApiKeyForProvider } from "../../../agents/model-auth.js";
import { resolveProviderAttributionHeaders } from "../../../agents/provider-attribution.js";
import type { OpenClawConfig } from "../../../config/config.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { convertInterleavedPcm16ToMono24k, REALTIME_AUDIO_SAMPLE_RATE } from "../audio.js";
import type { ManagedRealtimeConversationTurnDetectionOptions } from "../runtime.js";
import type {
  RealtimeConversationTransport,
  RealtimeProviderEvent,
  RealtimeSessionBootstrap,
  RealtimeToolDefinition,
} from "../types.js";
import type { RealtimeProviderAdapter } from "./types.js";

export type RealtimeOpenAIAdapterOptions = {
  apiKey?: string;
  cfg?: OpenClawConfig;
  agentDir?: string;
  model?: string;
  transport?: RealtimeConversationTransport;
  turnDetection?: ManagedRealtimeConversationTurnDetectionOptions;
  voice?: string;
  url?: string;
  webSocketFactory?: (url: string, options: ClientOptions) => WebSocket;
};

type OpenAIRealtimeEvent = {
  type?: string;
  item_id?: string;
  item?: {
    id?: string;
    role?: string;
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    status?: string;
  };
  response?: { id?: string; status?: string };
  transcript?: string;
  text?: string;
  delta?: string;
  error?: { code?: string; message?: string };
};

const DEFAULT_OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";
export const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime-1.5";
const DEFAULT_OPENAI_REALTIME_VOICE = "marin";
const OPENAI_REALTIME_AUDIO_CHUNK_BYTES = 32 * 1024;

const logger = createSubsystemLogger("gateway/realtime/openai");

function parseFunctionCallArgs(argumentsText: string | undefined): unknown {
  if (!argumentsText?.trim()) {
    return {};
  }
  try {
    return JSON.parse(argumentsText);
  } catch {
    return { raw: argumentsText };
  }
}

export class OpenAIRealtimeProviderAdapter implements RealtimeProviderAdapter {
  readonly provider = "openai";

  private readonly model: string;
  private readonly voice?: string;
  private readonly url: string;
  private readonly webSocketFactory: (url: string, options: ClientOptions) => WebSocket;
  private readonly listeners = new Set<(event: RealtimeProviderEvent) => void>();
  private availableTools: RealtimeToolDefinition[] = [];
  private bootstrap?: RealtimeSessionBootstrap;
  private socket: WebSocket | null = null;
  private apiKeyPromise: Promise<string> | null = null;
  private closeRequested = false;
  private transportFailureEmitted = false;
  private readonly turnEventState = new Map<
    string,
    { loggedThinking: boolean; loggedAssistantText: boolean; loggedAssistantAudio: boolean }
  >();

  constructor(private readonly options: RealtimeOpenAIAdapterOptions = {}) {
    this.model = options.model ?? DEFAULT_OPENAI_REALTIME_MODEL;
    this.voice = options.voice ?? DEFAULT_OPENAI_REALTIME_VOICE;
    this.url = options.url ?? DEFAULT_OPENAI_REALTIME_URL;
    this.webSocketFactory =
      options.webSocketFactory ?? ((url, wsOptions) => new WebSocket(url, wsOptions));
  }

  configureTools(tools: RealtimeToolDefinition[]): void {
    this.availableTools = tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.parameters ? { parameters: tool.parameters } : {}),
    }));
  }

  configureBootstrap(bootstrap: RealtimeSessionBootstrap): void {
    this.bootstrap = {
      instructions: bootstrap.instructions,
      history: bootstrap.history?.map((item) => ({
        role: item.role,
        text: item.text,
      })),
    };
  }

  async start(): Promise<void> {
    if (this.socket) {
      return;
    }
    const apiKey = await this.resolveApiKey();
    const url = `${this.url}?model=${encodeURIComponent(this.model)}`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "realtime=v1",
      ...resolveProviderAttributionHeaders("openai"),
    };
    const socket = this.webSocketFactory(url, { headers });
    this.socket = socket;
    this.closeRequested = false;
    this.transportFailureEmitted = false;
    this.turnEventState.clear();

    await new Promise<void>((resolve, reject) => {
      let started = false;
      const handleOpen = () => {
        if (this.socket !== socket || this.closeRequested) {
          return;
        }
        started = true;
        const defaultInterruptResponse = this.options.transport !== "discord";
        this.send({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "semantic_vad",
              eagerness: this.options.turnDetection?.vadEagerness ?? "low",
              create_response: this.options.transport !== "discord",
              interrupt_response:
                this.options.turnDetection?.interruptResponse ?? defaultInterruptResponse,
            },
            ...(this.bootstrap?.instructions ? { instructions: this.bootstrap.instructions } : {}),
            ...(this.voice ? { voice: this.voice } : {}),
            ...(this.availableTools.length > 0
              ? {
                  tools: this.availableTools.map((tool) => ({
                    type: "function",
                    name: tool.name,
                    ...(tool.description ? { description: tool.description } : {}),
                    ...(tool.parameters ? { parameters: tool.parameters } : {}),
                  })),
                }
              : {}),
          },
        });
        this.seedConversationHistory();
        resolve();
      };
      const handleError = (error: Error) => {
        if (!started) {
          reject(error);
          return;
        }
        if (this.socket !== socket) {
          return;
        }
        this.emitTransportFailure(error.message, true);
      };
      socket.on("open", handleOpen);
      socket.on("error", handleError);
      socket.on("message", (data) => {
        if (this.socket !== socket || this.closeRequested) {
          return;
        }
        this.handleMessage(this.normalizeMessageData(data));
      });
      socket.on("close", () => {
        if (this.socket === socket) {
          this.socket = null;
        }
        if (!this.closeRequested) {
          this.emitTransportFailure("OpenAI realtime connection closed.", true);
        }
      });
    });
  }

  async sendText(text: string): Promise<void> {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.send({ type: "response.create" });
  }

  async sendAudio(pcm: Buffer, options: { sampleRate: number; channels: number }): Promise<void> {
    const normalized = convertInterleavedPcm16ToMono24k({
      pcm,
      inputSampleRate: options.sampleRate,
      channels: options.channels,
    });
    if (normalized.length === 0) {
      return;
    }
    logger.info(
      `openai realtime: appending input audio bytes=${normalized.length} sampleRate=${REALTIME_AUDIO_SAMPLE_RATE}`,
    );
    for (let offset = 0; offset < normalized.length; offset += OPENAI_REALTIME_AUDIO_CHUNK_BYTES) {
      const chunk = normalized.subarray(offset, offset + OPENAI_REALTIME_AUDIO_CHUNK_BYTES);
      this.send({
        type: "input_audio_buffer.append",
        audio: chunk.toString("base64"),
      });
    }
    if (this.options.transport === "discord") {
      this.send({ type: "input_audio_buffer.commit" });
      this.send({ type: "response.create" });
    }
  }

  async interrupt(): Promise<void> {
    this.send({ type: "response.cancel" });
  }

  async submitToolResult(toolCallId: string, output: string): Promise<void> {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: toolCallId,
        output,
      },
    });
    this.send({ type: "response.create" });
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.closeRequested = true;
    this.socket = null;
    this.turnEventState.clear();
    socket?.close();
  }

  subscribe(listener: (event: RealtimeProviderEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async resolveApiKey(): Promise<string> {
    if (this.options.apiKey) {
      return this.options.apiKey;
    }
    this.apiKeyPromise ??= resolveApiKeyForProvider({
      provider: this.provider,
      cfg: this.options.cfg,
      agentDir: this.options.agentDir,
    }).then((resolved) => {
      if (!resolved.apiKey) {
        throw new Error("OpenAI realtime provider requires an API key");
      }
      return resolved.apiKey;
    });
    return this.apiKeyPromise;
  }

  private seedConversationHistory(): void {
    for (const item of this.bootstrap?.history ?? []) {
      const text = item.text.trim();
      if (!text) {
        continue;
      }
      this.send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: item.role,
          content: [
            item.role === "assistant"
              ? {
                  type: "text",
                  text,
                }
              : {
                  type: "input_text",
                  text,
                },
          ],
        },
      });
    }
  }

  private handleMessage(raw: string): void {
    let event: OpenAIRealtimeEvent;
    try {
      event = JSON.parse(raw) as OpenAIRealtimeEvent;
    } catch {
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
      this.logProviderEvent(event.type, this.normalizeTurnId(event));
      this.emit({
        type: "transcript.partial",
        itemId: event.item_id ?? event.item?.id ?? "user-transcript",
        role: "user",
        text: event.delta,
      });
      return;
    }

    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      event.transcript
    ) {
      this.logProviderEvent(event.type, this.normalizeTurnId(event));
      this.emit({
        type: "transcript.final",
        itemId: event.item_id ?? event.item?.id ?? "user-transcript",
        role: "user",
        text: event.transcript,
      });
      return;
    }

    if (
      event.type === "response.output_item.done" &&
      event.item?.type === "function_call" &&
      typeof event.item.call_id === "string" &&
      typeof event.item.name === "string"
    ) {
      this.logProviderEvent(event.type, this.normalizeTurnId(event));
      this.emit({
        type: "tool.call",
        toolCallId: event.item.call_id,
        toolName: event.item.name,
        args: parseFunctionCallArgs(event.item.arguments),
      });
      return;
    }

    if (
      (event.type === "response.output_text.delta" ||
        event.type === "response.audio_transcript.delta" ||
        event.type === "response.output_audio_transcript.delta") &&
      event.delta
    ) {
      this.logAssistantTextEvent(event);
      this.emit({
        type: "transcript.partial",
        itemId: event.item_id ?? this.normalizeTurnId(event) ?? "assistant-transcript",
        role: "assistant",
        text: event.delta,
      });
      this.emit({
        type: "assistant.turn",
        turnId: this.normalizeTurnId(event),
        state: "speaking",
      });
      return;
    }

    if (
      (event.type === "response.output_text.done" ||
        event.type === "response.audio_transcript.done" ||
        event.type === "response.output_audio_transcript.done") &&
      (event.text || event.transcript)
    ) {
      this.logProviderEvent(event.type, this.normalizeTurnId(event));
      this.emit({
        type: "transcript.final",
        itemId: event.item_id ?? this.normalizeTurnId(event) ?? "assistant-transcript",
        role: "assistant",
        text: event.text ?? event.transcript ?? "",
      });
      return;
    }

    if (
      (event.type === "response.audio.delta" || event.type === "response.output_audio.delta") &&
      event.delta
    ) {
      this.logAssistantAudioEvent(event);
      this.emit({
        type: "audio.output",
        itemId: event.item_id ?? this.normalizeTurnId(event) ?? "assistant-audio",
        chunk: Buffer.from(event.delta, "base64"),
        sampleRate: REALTIME_AUDIO_SAMPLE_RATE,
        mimeType: "audio/pcm;rate=24000",
      });
      this.emit({
        type: "assistant.turn",
        turnId: this.normalizeTurnId(event),
        state: "speaking",
      });
      return;
    }

    if (event.type === "response.created") {
      this.logAssistantThinkingEvent(event);
      this.emit({
        type: "assistant.turn",
        turnId: this.normalizeTurnId(event),
        state: "thinking",
      });
      return;
    }

    if (event.type === "response.audio.done" || event.type === "response.output_audio.done") {
      this.logProviderEvent(event.type, this.normalizeTurnId(event));
      this.emit({
        type: "assistant.turn",
        turnId: this.normalizeTurnId(event),
        state: "completed",
      });
      return;
    }

    if (event.type === "response.done") {
      const turnId = this.normalizeTurnId(event);
      this.logProviderEvent(event.type, turnId);
      this.emit({
        type: "assistant.turn",
        turnId,
        state: event.response?.status === "cancelled" ? "interrupted" : "completed",
      });
      return;
    }

    if (
      event.type === "input_audio_buffer.speech_started" ||
      event.type === "input_audio_buffer.speech_stopped" ||
      event.type === "input_audio_buffer.committed"
    ) {
      this.logProviderEvent(event.type, this.normalizeTurnId(event));
      return;
    }

    if (
      event.type === "response.content_part.added" ||
      event.type === "response.output_item.added"
    ) {
      this.logProviderEvent(event.type, this.normalizeTurnId(event));
      return;
    }

    if (event.type === "error") {
      this.logProviderError(event);
      if (this.shouldIgnoreProviderError(event)) {
        return;
      }
      this.emit({
        type: "error",
        code: event.error?.code ?? "OPENAI_REALTIME_ERROR",
        message: event.error?.message ?? "OpenAI realtime error",
      });
      this.emit({
        type: "assistant.turn",
        turnId: this.normalizeTurnId(event),
        state: "completed",
      });
      return;
    }
  }

  private shouldIgnoreProviderError(event: OpenAIRealtimeEvent): boolean {
    if (event.type !== "error") {
      return false;
    }
    const code = event.error?.code?.trim().toLowerCase();
    const message = event.error?.message?.trim().toLowerCase() ?? "";
    return code === "response_cancel_not_active" || message.includes("no active response found");
  }

  private normalizeTurnId(event: OpenAIRealtimeEvent): string | undefined {
    return typeof event.response?.id === "string" ? event.response.id : undefined;
  }

  private getTurnEventState(turnId?: string): {
    loggedThinking: boolean;
    loggedAssistantText: boolean;
    loggedAssistantAudio: boolean;
  } | null {
    if (!turnId) {
      return null;
    }
    let state = this.turnEventState.get(turnId);
    if (!state) {
      state = {
        loggedThinking: false,
        loggedAssistantText: false,
        loggedAssistantAudio: false,
      };
      this.turnEventState.set(turnId, state);
    }
    return state;
  }

  private logProviderEvent(type: string, turnId?: string): void {
    logger.info(`openai realtime: event ${type}${turnId ? ` turn=${turnId}` : ""}`);
    if (
      type === "response.audio.done" ||
      type === "response.output_audio.done" ||
      type === "response.done"
    ) {
      if (turnId) {
        this.turnEventState.delete(turnId);
      }
    }
  }

  private logProviderError(event: OpenAIRealtimeEvent): void {
    const turnId = this.normalizeTurnId(event);
    const code = event.error?.code?.trim();
    const message = event.error?.message?.trim();
    logger.info(
      `openai realtime: event error${turnId ? ` turn=${turnId}` : ""}${code ? ` code=${code}` : ""}${message ? ` message=${message}` : ""}`,
    );
  }

  private logAssistantThinkingEvent(event: OpenAIRealtimeEvent): void {
    const turnId = this.normalizeTurnId(event);
    const state = this.getTurnEventState(turnId);
    if (state?.loggedThinking) {
      return;
    }
    if (state) {
      state.loggedThinking = true;
    }
    this.logProviderEvent(event.type ?? "response.created", turnId);
  }

  private logAssistantTextEvent(event: OpenAIRealtimeEvent): void {
    const turnId = this.normalizeTurnId(event);
    const state = this.getTurnEventState(turnId);
    if (state?.loggedAssistantText) {
      return;
    }
    if (state) {
      state.loggedAssistantText = true;
    }
    this.logProviderEvent(event.type ?? "response.output_text.delta", turnId);
  }

  private logAssistantAudioEvent(event: OpenAIRealtimeEvent): void {
    const turnId = this.normalizeTurnId(event);
    const state = this.getTurnEventState(turnId);
    if (state?.loggedAssistantAudio) {
      return;
    }
    if (state) {
      state.loggedAssistantAudio = true;
    }
    this.logProviderEvent(event.type ?? "response.audio.delta", turnId);
  }

  private emitTransportFailure(message: string, retryable: boolean): void {
    if (this.transportFailureEmitted) {
      return;
    }
    this.transportFailureEmitted = true;
    this.emit({
      type: "error",
      code: "OPENAI_REALTIME_TRANSPORT_ERROR",
      message,
      retryable,
    });
    this.emit({
      type: "fallback",
      reason: "provider_failed",
    });
  }

  private normalizeMessageData(data: unknown): string {
    if (Buffer.isBuffer(data)) {
      return data.toString("utf8");
    }
    if (Array.isArray(data) && data.every((item) => Buffer.isBuffer(item))) {
      return Buffer.concat(data).toString("utf8");
    }
    if (typeof data === "string") {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString("utf8");
    }
    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
    }
    return "";
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private emit(event: RealtimeProviderEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
