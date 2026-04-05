// Public gateway/client helpers for plugins that talk to the host gateway surface.

export * from "../gateway/channel-status-patches.js";
export { GatewayClient } from "../gateway/client.js";
export {
  createOperatorApprovalsGatewayClient,
  withOperatorApprovalsGatewayClient,
} from "../gateway/operator-approvals-client.js";
export type { EventFrame } from "../gateway/protocol/index.js";
export type { GatewayRequestHandlerOptions } from "../gateway/server-methods/types.js";
export {
  createManagedRealtimeConversationRuntime,
  type ManagedRealtimeConversationRuntime,
  type ManagedRealtimeConversationRuntimeOptions,
  type ManagedRealtimeConversationTurnDetectionOptions,
} from "../gateway/realtime-audio/runtime.js";
export {
  mergeRealtimeHistoryItems,
  trimRealtimeHistoryItems,
  type RealtimeHistoryItem,
} from "../gateway/realtime-audio/history.js";
