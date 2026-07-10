import type { ChannelTtsVoiceDeliveryCapabilities } from "openclaw/plugin-sdk/channel-contract";

export const matrixTtsVoiceDelivery = {
  synthesisTarget: "voice-note",
} as const satisfies ChannelTtsVoiceDeliveryCapabilities;
