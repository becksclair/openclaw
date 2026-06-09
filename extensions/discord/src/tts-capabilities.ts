import type { ChannelTtsVoiceDeliveryCapabilities } from "openclaw/plugin-sdk/channel-contract";

export const discordTtsVoiceDelivery = {
  synthesisTarget: "voice-note",
  transcodesAudio: true,
} as const satisfies ChannelTtsVoiceDeliveryCapabilities;
