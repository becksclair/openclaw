// Realtime direct tool adapter for exposing selected OpenClaw tools to voice providers.
import { createOpenClawCodingTools } from "../agents/agent-tools.js";
import type { AnyAgentTool } from "../agents/agent-tools.types.js";
import { normalizeTalkToolPolicyConfig } from "../config/talk.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { ToolPolicyConfig } from "../config/types.tools.js";
import {
  DEFAULT_GATEWAY_HTTP_TOOL_DENY,
  GATEWAY_OWNER_ONLY_CORE_TOOLS,
} from "../security/dangerous-tools.js";
import { REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME } from "./agent-consult-tool.js";
import { REALTIME_VOICE_AGENT_CONTROL_TOOL_NAME } from "./agent-run-control-shared.js";
import type { RealtimeVoiceTool } from "./provider-types.js";

export const REALTIME_DIRECT_TOOL_RESULT_MAX_CHARS = 2_000;

export type RealtimeDirectToolResult = {
  ok: boolean;
  status: "ok" | "error";
  tool: string;
  text?: string;
  result?: unknown;
  error?: string;
};

export type RealtimeDirectToolExclusionReason =
  | "message-tool"
  | "reserved-name"
  | "unsupported-schema";

export type RealtimeDirectToolExecutor = (params: {
  callId: string;
  name: string;
  args: unknown;
  signal: AbortSignal;
}) => Promise<RealtimeDirectToolResult>;

export type RealtimeDirectTools = {
  tools: RealtimeVoiceTool[];
  executors: Map<string, RealtimeDirectToolExecutor>;
  excludedTools: Array<{ name: string; reason: RealtimeDirectToolExclusionReason }>;
};

type CreateOpenClawCodingToolsOptions = NonNullable<
  Parameters<typeof createOpenClawCodingTools>[0]
> & {
  runtimeToolPolicy?: ToolPolicyConfig;
  finalToolPredicate?: (tool: AnyAgentTool) => boolean;
};

type CreateOpenClawCodingToolsForRealtime = (
  options: CreateOpenClawCodingToolsOptions,
) => AnyAgentTool[];

export type RealtimeDirectToolsParams = {
  cfg: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  spawnedBy?: string;
  sessionId?: string;
  runId?: string;
  agentDir?: string;
  workspaceDir?: string;
  cwd?: string;
  messageProvider?: string;
  agentAccountId?: string;
  messageTo?: string;
  messageThreadId?: string | number;
  modelProvider?: string;
  modelId?: string;
  modelApi?: string;
  modelContextWindowTokens?: number;
  abortSignal?: AbortSignal;
  senderIsOwner?: boolean;
};

export type RealtimeDirectToolsDeps = {
  createTools?: CreateOpenClawCodingToolsForRealtime;
};

const RESERVED_REALTIME_DIRECT_TOOL_NAMES = new Set([
  REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME,
  REALTIME_VOICE_AGENT_CONTROL_TOOL_NAME,
]);

const MESSAGE_SENDING_TOOL_NAMES = new Set([
  "message",
  "send_message",
  "message_send",
  "sessions_send",
]);
const MESSAGE_SENDING_ACTION_NAMES = new Set([
  "image",
  "link",
  "message",
  "react",
  "reply",
  "send",
  "send_image",
  "send_link",
  "send_media",
  "send_message",
  "send_text",
]);
const JSON_SCHEMA_VARIANT_KEYS = ["allOf", "anyOf", "oneOf"] as const;
const DEFAULT_REALTIME_DIRECT_TOOL_DENY = ["edit", "write"] as const;
const MEDIA_RESULT_KEYS = new Set([
  "attachment",
  "attachments",
  "audio",
  "base64",
  "binary",
  "blob",
  "buffer",
  "bytes",
  "data",
  "file",
  "files",
  "image",
  "images",
  "media",
  "video",
  "videos",
]);
// Direct tool results are sent verbatim to the realtime voice provider, so credential-shaped
// fields must be redacted even when a tool legitimately returns them. Matched by compact suffix
// so `apiKey`/`accessToken`/`clientSecret` are caught while `tokenCount`/`totalTokens` are not.
const SECRET_RESULT_KEY_TERMS = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "authtoken",
  "clientsecret",
  "privatekey",
  "credential",
  "credentials",
  "authorization",
  "bearer",
  "cookie",
  "token",
];

function isSecretResultKey(key: string): boolean {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SECRET_RESULT_KEY_TERMS.some((term) => compact === term || compact.endsWith(term));
}

const defaultDeps: Required<RealtimeDirectToolsDeps> = {
  createTools: createOpenClawCodingTools as unknown as CreateOpenClawCodingToolsForRealtime,
};

export function createRealtimeDirectTools(
  params: RealtimeDirectToolsParams,
  deps: RealtimeDirectToolsDeps = {},
): RealtimeDirectTools {
  const runtimeToolPolicy = readRealtimeDirectRuntimeToolPolicy(params.cfg);
  if (!runtimeToolPolicy) {
    return { tools: [], executors: new Map(), excludedTools: [] };
  }

  const createTools = deps.createTools ?? defaultDeps.createTools;
  const gatewayDenySet = resolveRealtimeGatewayDenySet({
    cfg: params.cfg,
    runtimeToolPolicy,
    senderIsOwner: params.senderIsOwner,
  });
  const finalToolPredicate = (tool: AnyAgentTool) =>
    isRealtimeDirectToolSupported(tool) && !gatewayDenySet.has(tool.name);
  const agentTools = createTools({
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    spawnedBy: params.spawnedBy,
    sessionId: params.sessionId,
    runId: params.runId,
    agentDir: params.agentDir,
    workspaceDir: params.workspaceDir,
    cwd: params.cwd,
    config: params.cfg,
    abortSignal: params.abortSignal,
    messageProvider: params.messageProvider,
    agentAccountId: params.agentAccountId,
    messageTo: params.messageTo,
    messageThreadId: params.messageThreadId,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
    modelApi: params.modelApi,
    modelContextWindowTokens: params.modelContextWindowTokens,
    senderIsOwner: params.senderIsOwner,
    includeToolSearchControls: false,
    disableMessageTool: true,
    runtimeToolPolicy,
    finalToolPredicate,
  });

  return buildRealtimeDirectToolsFromAgentTools(agentTools.filter(finalToolPredicate), {
    abortSignal: params.abortSignal,
  });
}

function resolveRealtimeGatewayDenySet(params: {
  cfg: OpenClawConfig;
  runtimeToolPolicy?: ToolPolicyConfig;
  senderIsOwner?: boolean;
}): Set<string> {
  const gatewayToolsCfg = params.cfg.gateway?.tools;
  const realtimeAllow = new Set<string>([
    ...(Array.isArray(params.runtimeToolPolicy?.allow) ? params.runtimeToolPolicy.allow : []),
    ...(Array.isArray(params.runtimeToolPolicy?.alsoAllow)
      ? params.runtimeToolPolicy.alsoAllow
      : []),
  ]);
  const realtimeDefaultDeny = DEFAULT_REALTIME_DIRECT_TOOL_DENY.filter(
    (name) => !realtimeAllow.has(name),
  );
  const defaultGatewayDeny = DEFAULT_GATEWAY_HTTP_TOOL_DENY.filter(
    (name) => !gatewayToolsCfg?.allow?.includes(name),
  );
  const ownerOnlyGatewayDeny =
    params.senderIsOwner === true ? [] : [...GATEWAY_OWNER_ONLY_CORE_TOOLS];
  return new Set([
    ...defaultGatewayDeny,
    ...realtimeDefaultDeny,
    ...ownerOnlyGatewayDeny,
    ...(Array.isArray(gatewayToolsCfg?.deny) ? gatewayToolsCfg.deny : []),
  ]);
}

export function buildRealtimeDirectToolsFromAgentTools(
  agentTools: readonly AnyAgentTool[],
  options: { abortSignal?: AbortSignal } = {},
): RealtimeDirectTools {
  const tools: RealtimeVoiceTool[] = [];
  const executors = new Map<string, RealtimeDirectToolExecutor>();
  const excludedTools: Array<{ name: string; reason: RealtimeDirectToolExclusionReason }> = [];
  const seen = new Set<string>();

  for (const agentTool of agentTools) {
    if (seen.has(agentTool.name)) {
      continue;
    }
    const exclusionReason = realtimeDirectToolExclusionReason(agentTool);
    if (exclusionReason) {
      excludedTools.push({ name: agentTool.name, reason: exclusionReason });
      continue;
    }
    const realtimeTool = toRealtimeVoiceTool(agentTool)!;
    seen.add(agentTool.name);
    tools.push(realtimeTool);
    executors.set(agentTool.name, async (params) =>
      executeRealtimeDirectTool(agentTool, params.args, {
        callId: params.callId,
        signal: params.signal ?? options.abortSignal,
      }),
    );
  }

  return { tools, executors, excludedTools };
}

function readRealtimeDirectRuntimeToolPolicy(cfg: OpenClawConfig): ToolPolicyConfig | undefined {
  const root = isRecord(cfg) ? cfg : {};
  const talk = isRecord(root.talk) ? root.talk : undefined;
  const realtime = talk && isRecord(talk.realtime) ? talk.realtime : undefined;
  return normalizeTalkToolPolicyConfig(realtime?.tools);
}

function isRealtimeDirectToolSupported(tool: AnyAgentTool): boolean {
  return realtimeDirectToolExclusionReason(tool) === undefined;
}

function toRealtimeVoiceTool(tool: AnyAgentTool): RealtimeVoiceTool | undefined {
  const parameters = readObjectRootSchema(tool.parameters);
  if (!parameters) {
    return undefined;
  }
  return {
    type: "function",
    name: tool.name,
    description: tool.description ?? "",
    parameters,
  };
}

function readObjectRootSchema(value: unknown): RealtimeVoiceTool["parameters"] | undefined {
  if (!isRecord(value) || value.type !== "object") {
    return undefined;
  }
  const properties = isRecord(value.properties) ? value.properties : {};
  const required = Array.isArray(value.required)
    ? value.required.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return {
    type: "object",
    properties,
    ...(required && required.length > 0 ? { required } : {}),
  };
}

function realtimeDirectToolStripReason(
  name: string,
): RealtimeDirectToolExclusionReason | undefined {
  const normalized = name.trim().toLowerCase();
  if (RESERVED_REALTIME_DIRECT_TOOL_NAMES.has(normalized)) {
    return "reserved-name";
  }
  if (MESSAGE_SENDING_TOOL_NAMES.has(normalized)) {
    return "message-tool";
  }
  return /(?:send.*message|message.*send)/u.test(normalized) ? "message-tool" : undefined;
}

function schemaDeclaresMessageSendingAction(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => schemaDeclaresMessageSendingAction(entry));
  }
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.const === "string" && isMessageSendingActionName(value.const)) {
    return true;
  }
  if (
    Array.isArray(value.enum) &&
    value.enum.some((entry) => typeof entry === "string" && isMessageSendingActionName(entry))
  ) {
    return true;
  }
  return JSON_SCHEMA_VARIANT_KEYS.some((key) => schemaDeclaresMessageSendingAction(value[key]));
}

function schemaHasMessageSendingAction(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const properties = isRecord(value.properties) ? value.properties : undefined;
  if (properties && schemaDeclaresMessageSendingAction(properties.action)) {
    return true;
  }
  return JSON_SCHEMA_VARIANT_KEYS.some((key) => schemaHasMessageSendingAction(value[key]));
}

function isMessageSendingActionName(value: string): boolean {
  return MESSAGE_SENDING_ACTION_NAMES.has(value.trim().toLowerCase());
}

function realtimeDirectToolExclusionReason(
  tool: AnyAgentTool,
): RealtimeDirectToolExclusionReason | undefined {
  return (
    realtimeDirectToolStripReason(tool.name) ??
    (schemaHasMessageSendingAction(tool.parameters) ? "message-tool" : undefined) ??
    (toRealtimeVoiceTool(tool) ? undefined : "unsupported-schema")
  );
}

async function executeRealtimeDirectTool(
  tool: AnyAgentTool,
  args: unknown,
  options: { callId?: string; signal?: AbortSignal },
): Promise<RealtimeDirectToolResult> {
  try {
    const result = await tool.execute(
      options.callId ?? `realtime-direct-${tool.name}`,
      args,
      options.signal,
    );
    return compactRealtimeDirectToolResult(tool.name, result);
  } catch (error) {
    return compactRealtimeDirectToolError(tool.name, error);
  }
}

function compactRealtimeDirectToolResult(tool: string, result: unknown): RealtimeDirectToolResult {
  const safe = sanitizeRealtimeToolResultValue(result);
  const text = selectResultText(safe);
  const compactResult = text ? omitResultTextFields(safe) : safe;
  return {
    ok: true,
    status: "ok",
    tool,
    ...(text ? { text: capText(text) } : {}),
    result: capJsonSafeValue(compactResult),
  };
}

function compactRealtimeDirectToolError(tool: string, error: unknown): RealtimeDirectToolResult {
  return {
    ok: false,
    status: "error",
    tool,
    error: capText(error instanceof Error ? error.message : String(error)),
  };
}

function selectResultText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of ["text", "message", "result", "output", "summary"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function capJsonSafeValue(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (!json || json.length <= REALTIME_DIRECT_TOOL_RESULT_MAX_CHARS) {
    return value;
  }
  return `${json.slice(0, REALTIME_DIRECT_TOOL_RESULT_MAX_CHARS)}...[truncated]`;
}

function omitResultTextFields(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = ["text", "message", "result", "output", "summary"].includes(key)
      ? "[shown in text]"
      : entry;
  }
  return result;
}

function sanitizeRealtimeToolResultValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[truncated]";
  }
  if (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
  ) {
    return "[binary omitted]";
  }
  if (typeof value === "string") {
    return capText(value);
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeRealtimeToolResultValue(entry, depth + 1));
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol") {
    return value.description ? `Symbol(${value.description})` : "Symbol()";
  }
  if (!isRecord(value)) {
    return `[${typeof value}]`;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 40)) {
    result[key] = isSecretResultKey(key)
      ? "[redacted]"
      : MEDIA_RESULT_KEYS.has(key.toLowerCase())
        ? "[media omitted]"
        : sanitizeRealtimeToolResultValue(entry, depth + 1);
  }
  return result;
}

function capText(value: string): string {
  return value.length > REALTIME_DIRECT_TOOL_RESULT_MAX_CHARS
    ? `${value.slice(0, REALTIME_DIRECT_TOOL_RESULT_MAX_CHARS)}...[truncated]`
    : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
