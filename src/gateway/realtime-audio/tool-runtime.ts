import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { toToolDefinitions } from "../../agents/pi-tool-definition-adapter.js";
import { createOpenClawCodingTools } from "../../agents/pi-tools.js";
import type { AnyAgentTool } from "../../agents/pi-tools.types.js";
import { stringifyToolPayload } from "../../agents/tools/common.js";
import type { OpenClawConfig } from "../../config/config.js";
import type {
  RealtimeToolCallUpdate,
  RealtimeToolDefinition,
  RealtimeToolRuntime,
} from "./types.js";

const DEFAULT_REALTIME_TOOL_NAMES = new Set(["web_search", "web_fetch", "read", "write", "exec"]);

type ToolDefinition = ReturnType<typeof toToolDefinitions>[number];

type RealtimeToolRuntimeOptions = {
  config?: OpenClawConfig;
  workspaceDir?: string;
  sessionKey?: string;
  agentDir?: string;
  messageProvider?: string;
  agentAccountId?: string;
  senderIsOwner?: boolean;
  toolNames?: string[];
  tools?: AnyAgentTool[];
};

function extractResultText(result: AgentToolResult<unknown>): string | undefined {
  const text = result.content
    .filter(
      (entry): entry is Extract<(typeof result.content)[number], { type: "text"; text: string }> =>
        entry.type === "text" && "text" in entry && typeof entry.text === "string",
    )
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (text) {
    return text;
  }
  if (result.details !== undefined) {
    return stringifyToolPayload(result.details).trim() || undefined;
  }
  return undefined;
}

function normalizeToolFailure(
  result: AgentToolResult<unknown>,
): { code: string; message: string } | undefined {
  const details = result.details as { status?: unknown; error?: unknown } | undefined;
  if (typeof details?.error === "string" && details.error.trim()) {
    return {
      code: typeof details.status === "string" ? details.status : "tool_failed",
      message: details.error,
    };
  }
  const text = extractResultText(result);
  if (!text) {
    return undefined;
  }
  return {
    code: typeof details?.status === "string" ? details.status : "tool_failed",
    message: text,
  };
}

export class DefaultRealtimeToolRuntime implements RealtimeToolRuntime {
  private readonly toolDefinitions = new Map<string, ToolDefinition>();
  private readonly listeners = new Set<(update: RealtimeToolCallUpdate) => void>();

  constructor(options: RealtimeToolRuntimeOptions = {}) {
    const rawTools =
      options.tools ??
      createOpenClawCodingTools({
        config: options.config,
        workspaceDir: options.workspaceDir,
        sessionKey: options.sessionKey,
        agentDir: options.agentDir,
        messageProvider: options.messageProvider,
        agentAccountId: options.agentAccountId,
        senderIsOwner: options.senderIsOwner,
      });
    const allowlist = new Set(options.toolNames ?? DEFAULT_REALTIME_TOOL_NAMES);
    for (const tool of toToolDefinitions(rawTools).filter((entry) => allowlist.has(entry.name))) {
      this.toolDefinitions.set(tool.name, tool);
    }
  }

  listTools(): RealtimeToolDefinition[] {
    return [...this.toolDefinitions.values()].map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters)
        ? { parameters: tool.parameters as Record<string, unknown> }
        : {}),
    }));
  }

  async invoke(
    toolCallId: string,
    toolName: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<unknown>> {
    const tool = this.toolDefinitions.get(toolName);
    if (!tool) {
      const error = {
        code: "tool_not_available",
        message: `Realtime tool not available: ${toolName}`,
      };
      this.emit({
        toolCallId,
        toolName,
        status: "failed",
        error,
      });
      throw new Error(error.message);
    }

    this.emit({
      toolCallId,
      toolName,
      status: "queued",
    });
    this.emit({
      toolCallId,
      toolName,
      status: "running",
    });

    const result: AgentToolResult<unknown> = await tool.execute(
      toolCallId,
      params,
      signal,
      (update) => {
        const text = stringifyToolPayload(update).trim();
        this.emit({
          toolCallId,
          toolName,
          status: "running",
          ...(text ? { text } : {}),
        });
      },
      {} as never,
    );

    const details = result.details as
      | {
          status?: unknown;
          approvalId?: unknown;
          approvalSlug?: unknown;
          expiresAtMs?: unknown;
        }
      | undefined;
    if (details?.status === "approval-pending") {
      this.emit({
        toolCallId,
        toolName,
        status: "approval",
        text: extractResultText(result),
        approval: {
          approvalId: typeof details.approvalId === "string" ? details.approvalId : toolCallId,
          ...(typeof details.approvalSlug === "string"
            ? { approvalSlug: details.approvalSlug }
            : {}),
          ...(typeof details.expiresAtMs === "number" ? { expiresAtMs: details.expiresAtMs } : {}),
        },
      });
      return result;
    }

    if (details?.status === "approval-unavailable") {
      const error = normalizeToolFailure(result) ?? {
        code: "approval_unavailable",
        message: "Realtime exec approval is unavailable.",
      };
      this.emit({
        toolCallId,
        toolName,
        status: "failed",
        text: extractResultText(result),
        error,
      });
      return result;
    }

    if (details?.status === "failed" || details?.status === "error") {
      this.emit({
        toolCallId,
        toolName,
        status: "failed",
        text: extractResultText(result),
        error: normalizeToolFailure(result),
      });
      return result;
    }

    this.emit({
      toolCallId,
      toolName,
      status: "completed",
      text: extractResultText(result),
    });
    return result;
  }

  subscribe(listener: (update: RealtimeToolCallUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(update: RealtimeToolCallUpdate): void {
    for (const listener of this.listeners) {
      listener(update);
    }
  }
}
