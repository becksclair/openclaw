import type { ChannelTtsVoiceDeliveryCapabilities } from "openclaw/plugin-sdk/channel-contract";

export const telegramTtsVoiceDelivery = {
  synthesisTarget: "voice-note",
  transcodesAudio: true,
} as const satisfies ChannelTtsVoiceDeliveryCapabilities;
