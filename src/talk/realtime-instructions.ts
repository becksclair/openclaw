import type { VoiceAgentBasePrompt } from "../agents/voice-agent-base-prompt-file.js";
import { REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME } from "./agent-consult-tool.js";
import { REALTIME_VOICE_AGENT_CONTROL_TOOL_NAME } from "./agent-run-control-shared.js";

export const DEFAULT_TALK_REALTIME_INSTRUCTIONS = [
  "You are OpenClaw's realtime voice interface. Keep spoken replies concise.",
  `If the user asks for code, repository state, files, current OpenClaw context, tool-backed actions, or deeper reasoning, call ${REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME} and then summarize the result naturally.`,
  `Do not claim you cannot use tools, perform actions, or reach OpenClaw unless ${REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME} returns that failure.`,
  `When ${REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME} is in progress, speak one brief acknowledgement such as "Let me check that for you", then wait for the final OpenClaw result before answering with the actual result.`,
  `If OpenClaw is already working through ${REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME} and the user asks in any language for progress, cancellation, a redirect/change, or a follow-up, call ${REALTIME_VOICE_AGENT_CONTROL_TOOL_NAME} with the semantic mode.`,
  "For greetings and casual chatter while OpenClaw is working, answer naturally and do not redirect the active work.",
].join(" ");

export type TalkRealtimeContextPacketForInstructions = {
  text?: string;
};

export type BuildTalkRealtimeInstructionsParams = {
  voiceBasePrompt?: VoiceAgentBasePrompt;
  contextPacket?: TalkRealtimeContextPacketForInstructions;
  configuredInstructions?: string;
};

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function appendSection(parts: string[], heading: string, text: string): void {
  parts.push(`${heading}:\n${text}`);
}

export function buildTalkRealtimeInstructions(
  params: BuildTalkRealtimeInstructionsParams = {},
): string {
  const voiceText =
    params.voiceBasePrompt?.source === "agent-file" ? params.voiceBasePrompt.text : undefined;
  const contextText = normalizeOptionalString(params.contextPacket?.text);
  const configuredInstructions = normalizeOptionalString(params.configuredInstructions);

  if (!voiceText && !contextText) {
    if (!configuredInstructions) {
      return DEFAULT_TALK_REALTIME_INSTRUCTIONS;
    }
    return `${DEFAULT_TALK_REALTIME_INSTRUCTIONS}\n\nAdditional realtime instructions:\n${configuredInstructions}`;
  }

  const parts: string[] = [];
  if (voiceText) {
    parts.push(voiceText);
  } else {
    parts.push(DEFAULT_TALK_REALTIME_INSTRUCTIONS);
  }

  if (voiceText) {
    appendSection(parts, "Realtime operational rules", DEFAULT_TALK_REALTIME_INSTRUCTIONS);
  }
  if (contextText) {
    appendSection(parts, "Realtime context", contextText);
  }
  if (configuredInstructions) {
    appendSection(parts, "Additional realtime instructions", configuredInstructions);
  }

  return parts.join("\n\n");
}
