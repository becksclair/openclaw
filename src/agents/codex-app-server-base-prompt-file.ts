import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readAgentBasePrompt, resolveAgentBasePromptPath } from "./agent-base-prompt-file.js";

export const CODEX_APP_SERVER_BASE_PROMPT_FILENAME = "app-server-base.md";

export type CodexAppServerAgentBasePrompt =
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

export function resolveCodexAppServerAgentBasePromptPath(agentDir: string): string {
  return path.join(agentDir, CODEX_APP_SERVER_BASE_PROMPT_FILENAME);
}

export function resolveCodexAppServerCanonicalAgentBasePromptPath(agentDir: string): string {
  return resolveAgentBasePromptPath(agentDir);
}

export async function readCodexAppServerAgentBasePrompt(params: {
  agentDir: string;
}): Promise<CodexAppServerAgentBasePrompt> {
  const agentBasePrompt = await readAgentBasePrompt(params);
  if (agentBasePrompt.source === "agent-file") {
    return agentBasePrompt;
  }

  const promptPath = resolveCodexAppServerAgentBasePromptPath(params.agentDir);
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
