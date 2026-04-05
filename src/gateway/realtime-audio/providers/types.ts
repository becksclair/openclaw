import type {
  RealtimeProviderEvent,
  RealtimeSessionBootstrap,
  RealtimeToolDefinition,
} from "../types.js";

export interface RealtimeProviderAdapter {
  configureTools?(tools: RealtimeToolDefinition[]): void;
  configureBootstrap?(bootstrap: RealtimeSessionBootstrap): void;
  start(): Promise<void>;
  sendText?(text: string): Promise<void>;
  sendAudio?(pcm: Buffer, options: { sampleRate: number; channels: number }): Promise<void>;
  interrupt(target?: "assistant" | "user-input"): Promise<void>;
  submitToolResult?(toolCallId: string, output: string): Promise<void>;
  close(): Promise<void>;
  subscribe(listener: (event: RealtimeProviderEvent) => void): () => void;
}
