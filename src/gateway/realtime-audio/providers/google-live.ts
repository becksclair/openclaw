import type { RealtimeProviderEvent, RealtimeToolDefinition } from "../types.js";
import type { RealtimeProviderAdapter } from "./types.js";

export class GoogleLiveRealtimeProviderAdapter implements RealtimeProviderAdapter {
  readonly provider = "google-live";

  private readonly listeners = new Set<(event: RealtimeProviderEvent) => void>();

  configureTools(_tools: RealtimeToolDefinition[]): void {}

  async start(): Promise<void> {
    this.emit({
      type: "error",
      code: "GOOGLE_LIVE_NOT_IMPLEMENTED",
      message: "Google Live realtime adapter is not implemented yet.",
      retryable: false,
    });
  }

  async sendText(_text: string): Promise<void> {}

  async sendAudio(
    _pcm: Buffer,
    _options: { sampleRate: number; channels: number },
  ): Promise<void> {}

  async interrupt(): Promise<void> {}

  async submitToolResult(_toolCallId: string, _output: string): Promise<void> {}

  async close(): Promise<void> {}

  subscribe(listener: (event: RealtimeProviderEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: RealtimeProviderEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
