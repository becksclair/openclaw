import type { OpenClawConfig } from "../../../config/config.js";
import { canonicalizeRealtimeVoiceProviderId } from "../../../realtime-voice/provider-registry.js";
import type { ManagedRealtimeConversationTurnDetectionOptions } from "../runtime.js";
import type { RealtimeConversationTransport } from "../types.js";
import { GoogleLiveRealtimeProviderAdapter } from "./google-live.js";
import { OpenAIRealtimeProviderAdapter } from "./openai.js";
import type { RealtimeProviderAdapter } from "./types.js";

export type RealtimeProviderId = string;

export type CreateRealtimeProviderAdapterOptions = {
  provider: RealtimeProviderId;
  cfg?: OpenClawConfig;
  agentDir?: string;
  model?: string;
  transport?: RealtimeConversationTransport;
  turnDetection?: ManagedRealtimeConversationTurnDetectionOptions;
};

function canonicalizeGatewayRealtimeProviderId(
  providerId: RealtimeProviderId,
  cfg?: OpenClawConfig,
): RealtimeProviderId {
  if (providerId === "google-live") {
    return providerId;
  }
  return canonicalizeRealtimeVoiceProviderId(providerId, cfg) ?? providerId;
}

export function createRealtimeProviderAdapter(
  options: CreateRealtimeProviderAdapterOptions,
): RealtimeProviderAdapter {
  const providerId = canonicalizeGatewayRealtimeProviderId(options.provider, options.cfg);
  if (providerId === "openai") {
    return new OpenAIRealtimeProviderAdapter({
      cfg: options.cfg,
      agentDir: options.agentDir,
      model: options.model,
      transport: options.transport,
      turnDetection: options.turnDetection,
    });
  }
  if (providerId === "google-live") {
    return new GoogleLiveRealtimeProviderAdapter();
  }
  throw new Error(`Unsupported realtime voice provider: ${providerId}`);
}

export { GoogleLiveRealtimeProviderAdapter } from "./google-live.js";
export { OpenAIRealtimeProviderAdapter } from "./openai.js";
export type { RealtimeProviderAdapter } from "./types.js";
