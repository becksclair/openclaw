import type { OpenClawConfig } from "../../../config/config.js";
import type { ManagedRealtimeConversationTurnDetectionOptions } from "../runtime.js";
import type { RealtimeConversationTransport } from "../types.js";
import { GoogleLiveRealtimeProviderAdapter } from "./google-live.js";
import { OpenAIRealtimeProviderAdapter } from "./openai.js";
import type { RealtimeProviderAdapter } from "./types.js";

export type RealtimeProviderId = "openai" | "google-live";

export type CreateRealtimeProviderAdapterOptions = {
  provider: RealtimeProviderId;
  cfg?: OpenClawConfig;
  agentDir?: string;
  model?: string;
  transport?: RealtimeConversationTransport;
  turnDetection?: ManagedRealtimeConversationTurnDetectionOptions;
};

export function createRealtimeProviderAdapter(
  options: CreateRealtimeProviderAdapterOptions,
): RealtimeProviderAdapter {
  if (options.provider === "openai") {
    return new OpenAIRealtimeProviderAdapter({
      cfg: options.cfg,
      agentDir: options.agentDir,
      model: options.model,
      transport: options.transport,
      turnDetection: options.turnDetection,
    });
  }
  return new GoogleLiveRealtimeProviderAdapter();
}

export { GoogleLiveRealtimeProviderAdapter } from "./google-live.js";
export { OpenAIRealtimeProviderAdapter } from "./openai.js";
export type { RealtimeProviderAdapter } from "./types.js";
