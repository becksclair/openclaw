import fs from "node:fs/promises";
import path from "node:path";
import { sha256Text } from "./agent-base-prompt-file.js";

export const VOICE_AGENT_BASE_PROMPT_FILENAME = "voice-agent-base.md";

export type VoiceAgentBasePrompt =
  | {
      source: "agent-file";
      path: string;
      text: string;
      fingerprint: string;
    }
  | {
      source: "none";
    };

export function resolveVoiceAgentBasePromptPath(agentDir: string): string {
  return path.join(agentDir, VOICE_AGENT_BASE_PROMPT_FILENAME);
}

export async function readVoiceAgentBasePrompt(params: {
  agentDir: string;
}): Promise<VoiceAgentBasePrompt> {
  const promptPath = resolveVoiceAgentBasePromptPath(params.agentDir);
  try {
    const text = await fs.readFile(promptPath, "utf8");
    return {
      source: "agent-file",
      path: promptPath,
      text,
      fingerprint: sha256Text(text),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { source: "none" };
    }
    throw error;
  }
}
