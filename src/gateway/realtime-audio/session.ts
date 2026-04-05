import { randomUUID } from "node:crypto";
import { stringifyToolPayload } from "../../agents/tools/common.js";
import { applyRealtimeProviderEvent, createRealtimeSessionState } from "./session-state.js";
import type {
  RealtimeConversationSession,
  RealtimeConversationTransport,
  RealtimeProviderEvent,
  RealtimeSessionCapabilities,
  RealtimeSessionEvent,
  RealtimeSessionProviderBinding,
  RealtimeSessionSnapshot,
  RealtimeSessionToolBinding,
  RealtimeSessionTransportBinding,
  RealtimeTransportSignal,
} from "./types.js";

function extractToolResultText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content
    .filter(
      (entry): entry is { type: "text"; text: string } =>
        !!entry &&
        typeof entry === "object" &&
        "type" in entry &&
        "text" in entry &&
        (entry as { type?: unknown }).type === "text" &&
        typeof (entry as { text?: unknown }).text === "string",
    )
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return text || undefined;
}

function toolResultStatus(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") {
    return undefined;
  }
  return typeof (details as { status?: unknown }).status === "string"
    ? (details as { status: string }).status
    : undefined;
}

function serializeToolResultForProvider(result: unknown): string {
  const text = extractToolResultText(result);
  if (text) {
    return text;
  }
  if (result && typeof result === "object" && "details" in result) {
    const details = (result as { details?: unknown }).details;
    if (details !== undefined) {
      const serialized = stringifyToolPayload(details).trim();
      if (serialized) {
        return serialized;
      }
    }
  }
  const serialized = stringifyToolPayload(result).trim();
  return serialized || "{}";
}

type PendingProviderToolCall = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type CreateRealtimeConversationSessionOptions = {
  sessionId?: string;
  transport: RealtimeConversationTransport;
  provider?: string;
  fallbackEnabled?: boolean;
  providerBinding?: RealtimeSessionProviderBinding;
  toolBinding?: RealtimeSessionToolBinding;
  transportBinding?: RealtimeSessionTransportBinding;
};

export class InMemoryRealtimeConversationSession implements RealtimeConversationSession {
  readonly id: string;

  private snapshot: RealtimeSessionSnapshot;
  private listeners = new Set<(event: RealtimeSessionEvent) => void>();
  private readonly providerBinding?: RealtimeSessionProviderBinding;
  private readonly toolBinding?: RealtimeSessionToolBinding;
  private readonly transportBinding?: RealtimeSessionTransportBinding;
  private readonly pendingProviderToolCalls = new Map<string, PendingProviderToolCall>();

  constructor(options: CreateRealtimeConversationSessionOptions) {
    this.id = options.sessionId ?? randomUUID();
    this.providerBinding = options.providerBinding;
    this.toolBinding = options.toolBinding;
    this.transportBinding = options.transportBinding;
    this.snapshot = createRealtimeSessionState({
      sessionId: this.id,
      transport: options.transport,
      provider: options.provider,
      fallbackEnabled: options.fallbackEnabled ?? true,
    });
  }

  async start(): Promise<void> {
    if (this.providerBinding && !this.providerBinding.unsubscribe) {
      if (this.toolBinding) {
        this.providerBinding.adapter.configureTools?.(this.toolBinding.runtime.listTools());
      }
      this.providerBinding.unsubscribe = this.providerBinding.adapter.subscribe((event) => {
        if (event.type === "tool.call") {
          void this.handleProviderToolCall(event);
          return;
        }
        this.handleProviderEvent(event);
      });
    }
    if (this.toolBinding && !this.toolBinding.unsubscribe) {
      this.toolBinding.unsubscribe = this.toolBinding.runtime.subscribe((update) => {
        this.emit({
          type: "tool.updated",
          sessionId: this.id,
          update,
        });
      });
    }
    if (this.transportBinding && !this.transportBinding.unsubscribe) {
      this.transportBinding.unsubscribe = this.transportBinding.bridge.subscribe((event) => {
        if (event.type === "transport.state") {
          this.emit({
            type: "transport.state.changed",
            sessionId: this.id,
            state: event.state,
          });
          return;
        }
        this.emit({
          type: "transport.signal",
          sessionId: this.id,
          signal: event.signal,
        });
      });
    }
    this.emit({
      type: "session.created",
      sessionId: this.id,
      mode: this.snapshot.mode,
      state: this.snapshot.state,
    });
    await this.transportBinding?.bridge.start?.();
    await this.providerBinding?.adapter.start();
  }

  async interrupt(target: "assistant" | "user-input" = "assistant"): Promise<void> {
    if (this.snapshot.state === "closed") {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      state: "idle",
      assistantTurn:
        target === "assistant"
          ? {
              ...this.snapshot.assistantTurn,
              state: this.snapshot.assistantTurn.state === "idle" ? "idle" : "interrupted",
            }
          : this.snapshot.assistantTurn,
    };
    this.emit({
      type: "interrupt.acknowledged",
      sessionId: this.id,
      target,
    });
    this.emit({
      type: "session.state.changed",
      sessionId: this.id,
      state: this.snapshot.state,
    });
    if (target === "assistant") {
      this.emit({
        type: "assistant.turn.updated",
        sessionId: this.id,
        turn: this.snapshot.assistantTurn,
      });
    }
    await this.providerBinding?.adapter.interrupt(target);
  }

  async close(reason?: string): Promise<void> {
    if (this.snapshot.state === "closed") {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      state: "closed",
      closedReason: reason,
    };
    this.pendingProviderToolCalls.clear();
    this.emit({
      type: "session.closed",
      sessionId: this.id,
      reason,
    });
    if (this.providerBinding) {
      this.providerBinding.unsubscribe?.();
      this.providerBinding.unsubscribe = undefined;
      await this.providerBinding.adapter.close();
    }
    if (this.toolBinding) {
      this.toolBinding.unsubscribe?.();
      this.toolBinding.unsubscribe = undefined;
    }
    if (this.transportBinding) {
      this.transportBinding.unsubscribe?.();
      this.transportBinding.unsubscribe = undefined;
      await this.transportBinding.bridge.close?.();
    }
  }

  async submitText(text: string): Promise<void> {
    const message = text.trim();
    if (!message) {
      return;
    }
    if (!this.providerBinding?.adapter.sendText) {
      throw new Error("Realtime provider does not support text input.");
    }
    await this.providerBinding.adapter.sendText(message);
  }

  async submitAudio(pcm: Buffer, options: { sampleRate: number; channels: number }): Promise<void> {
    if (!this.providerBinding?.adapter.sendAudio) {
      throw new Error("Realtime provider does not support audio input.");
    }
    await this.providerBinding.adapter.sendAudio(pcm, options);
  }

  async submitTransportSignal(signal: RealtimeTransportSignal): Promise<void> {
    if (!this.transportBinding) {
      throw new Error("Realtime transport bridge is not configured.");
    }
    await this.transportBinding.bridge.submitSignal(signal);
  }

  async submitPendingToolResult(toolCallId: string, output: string): Promise<void> {
    const pending = this.pendingProviderToolCalls.get(toolCallId);
    if (!pending) {
      throw new Error(`No pending realtime tool call found for ${toolCallId}.`);
    }
    this.pendingProviderToolCalls.delete(toolCallId);
    await this.providerBinding?.adapter.submitToolResult?.(toolCallId, output);
    this.emit({
      type: "tool.updated",
      sessionId: this.id,
      update: {
        toolCallId,
        toolName: pending.toolName,
        status: "completed",
        text: output,
      },
    });
  }

  async invokeToolCall(
    toolCallId: string,
    toolName: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.toolBinding) {
      throw new Error("Realtime tool runtime is not configured.");
    }
    return this.toolBinding.runtime.invoke(toolCallId, toolName, params, signal);
  }

  handleProviderEvent(event: RealtimeProviderEvent): void {
    const next = applyRealtimeProviderEvent(this.snapshot, event);
    this.snapshot = next.state;
    for (const emitted of next.events) {
      this.emit(emitted);
    }
  }

  getSnapshot(): RealtimeSessionSnapshot {
    return {
      ...this.snapshot,
      transcript: this.snapshot.transcript.map((item) => ({ ...item })),
      assistantTurn: { ...this.snapshot.assistantTurn },
    };
  }

  getCapabilities(): RealtimeSessionCapabilities {
    const provider = this.providerBinding?.adapter;
    const hasProviderToolContinuation =
      Boolean(this.toolBinding) && typeof provider?.submitToolResult === "function";
    return {
      textInput: typeof provider?.sendText === "function",
      audioInput: typeof provider?.sendAudio === "function",
      toolCalls: hasProviderToolContinuation,
      toolResultContinuation: hasProviderToolContinuation,
      transportSignal: Boolean(this.transportBinding),
    };
  }

  subscribe(listener: (event: RealtimeSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async handleProviderToolCall(
    event: Extract<RealtimeProviderEvent, { type: "tool.call" }>,
  ): Promise<void> {
    if (!this.toolBinding) {
      const message = "Realtime tool runtime is not configured.";
      this.emit({
        type: "tool.updated",
        sessionId: this.id,
        update: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: "failed",
          error: {
            code: "tool_runtime_not_configured",
            message,
          },
        },
      });
      await this.providerBinding?.adapter.submitToolResult?.(
        event.toolCallId,
        JSON.stringify({ ok: false, error: message }),
      );
      return;
    }

    try {
      const result = await this.toolBinding.runtime.invoke(
        event.toolCallId,
        event.toolName,
        event.args,
      );
      const status = toolResultStatus(result);
      if (status === "approval-pending") {
        this.pendingProviderToolCalls.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        return;
      }
      await this.providerBinding?.adapter.submitToolResult?.(
        event.toolCallId,
        serializeToolResultForProvider(result),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        type: "tool.updated",
        sessionId: this.id,
        update: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: "failed",
          error: {
            code: "tool_invoke_failed",
            message,
          },
        },
      });
      await this.providerBinding?.adapter.submitToolResult?.(
        event.toolCallId,
        JSON.stringify({ ok: false, error: message }),
      );
    }
  }

  private emit(event: RealtimeSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
