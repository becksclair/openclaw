import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const AGENT_BASE_PROMPT_FILENAME = "agent-base.md";

export type AgentBasePrompt =
  | {
      source: "agent-file";
      path: string;
      text: string;
      fingerprint: string;
    }
  | {
      source: "none";
    };

export function sha256Text(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function resolveAgentBasePromptPath(agentDir: string): string {
  return path.join(agentDir, AGENT_BASE_PROMPT_FILENAME);
}

export async function readAgentBasePrompt(params: { agentDir: string }): Promise<AgentBasePrompt> {
  const promptPath = resolveAgentBasePromptPath(params.agentDir);
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
