// OpenAI provider-owned Responses Lite transport compatibility.
import { createRequire } from "node:module";
import type { StreamFn } from "openclaw/plugin-sdk/agent-core";
import type { ProviderTransportTurnState } from "openclaw/plugin-sdk/plugin-entry";
import {
  isRecord,
  normalizeLowercaseStringOrEmpty,
} from "openclaw/plugin-sdk/string-coerce-runtime";
import { isOpenAICodexBaseUrl } from "./base-url.js";

// oxlint-disable-next-line eslint/no-underscore-dangle -- Bundled builds replace this compile-time define identifier.
declare const __OPENCLAW_MANAGED_CODEX_VERSION__: string | undefined;

const RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";
const RESPONSES_LITE_MODEL_IDS = new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
// Responses Lite model eligibility is tied to the Codex Desktop transport identity.
// Keep the version aligned with the managed Codex train; scope both headers to Lite rows.
const RESPONSES_LITE_ORIGINATOR = "Codex Desktop";

function resolveManagedCodexVersion(): string {
  if (typeof __OPENCLAW_MANAGED_CODEX_VERSION__ === "string") {
    return __OPENCLAW_MANAGED_CODEX_VERSION__;
  }
  try {
    const require = createRequire(import.meta.url);
    const manifest = require("@openai/codex/package.json") as { version?: unknown };
    if (typeof manifest.version === "string" && manifest.version.trim()) {
      return manifest.version.trim();
    }
  } catch {
    // Source mode resolves the installed package; production builds inject the managed pin.
  }
  throw new Error("Unable to resolve the managed Codex runtime version for Responses Lite.");
}

const RESPONSES_LITE_CODEX_VERSION = resolveManagedCodexVersion();
const RESPONSES_LITE_USER_AGENT = `Codex Desktop/${RESPONSES_LITE_CODEX_VERSION} (OpenClaw Responses Lite)`;

export type OpenAIResponsesLitePatchResult = "not_applicable" | "invalid_input" | "patched";

function normalizeResponsesLiteInputRole(item: unknown): unknown {
  if (!isRecord(item) || item.role !== "system") {
    return item;
  }
  return { ...item, role: "developer" };
}

function shouldUseOpenAIResponsesLite(model: {
  provider?: unknown;
  id?: unknown;
  baseUrl?: unknown;
}): boolean {
  const provider = normalizeLowercaseStringOrEmpty(model.provider);
  const modelId = normalizeLowercaseStringOrEmpty(model.id);
  const baseUrl = typeof model.baseUrl === "string" ? model.baseUrl : undefined;
  return (
    provider === "openai" && RESPONSES_LITE_MODEL_IDS.has(modelId) && isOpenAICodexBaseUrl(baseUrl)
  );
}

export function applyOpenAIResponsesLiteTurnState(params: {
  model: { provider?: unknown; id?: unknown; baseUrl?: unknown };
  state: ProviderTransportTurnState | undefined;
}): ProviderTransportTurnState | undefined {
  if (!shouldUseOpenAIResponsesLite(params.model)) {
    return params.state;
  }
  return {
    ...params.state,
    headers: {
      ...params.state?.headers,
      [RESPONSES_LITE_HEADER]: "true",
      originator: RESPONSES_LITE_ORIGINATOR,
      "User-Agent": RESPONSES_LITE_USER_AGENT,
    },
  };
}

/** Apply the wire shape required by ChatGPT's Responses Lite endpoint. */
export function patchOpenAIResponsesLitePayload(params: {
  model: { provider?: unknown; id?: unknown; baseUrl?: unknown };
  payload: unknown;
}): OpenAIResponsesLitePatchResult {
  if (!shouldUseOpenAIResponsesLite(params.model)) {
    return "not_applicable";
  }
  if (!isRecord(params.payload)) {
    return "invalid_input";
  }
  const input = params.payload.input;
  if (!Array.isArray(input)) {
    return "invalid_input";
  }

  const instructions =
    typeof params.payload.instructions === "string" ? params.payload.instructions : "";
  const tools = Array.isArray(params.payload.tools) ? params.payload.tools : [];
  const prefix: Record<string, unknown>[] = [
    {
      type: "additional_tools",
      role: "developer",
      tools,
    },
  ];
  if (instructions) {
    prefix.push({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: instructions }],
    });
  }

  params.payload.input = [...prefix, ...input].map(normalizeResponsesLiteInputRole);
  delete params.payload.instructions;
  delete params.payload.tools;
  delete params.payload.max_output_tokens;
  params.payload.parallel_tool_calls = false;
  params.payload.tool_choice = "auto";
  params.payload.store = false;
  const include = Array.isArray(params.payload.include) ? params.payload.include : [];
  params.payload.include = Array.from(new Set([...include, "reasoning.encrypted_content"]));
  // Responses Lite requires the reasoning envelope even when the caller selected
  // thinking=off. Preserve any explicit effort while adding its mandatory context.
  params.payload.reasoning = isRecord(params.payload.reasoning)
    ? { ...params.payload.reasoning, context: "all_turns" }
    : { context: "all_turns" };
  return "patched";
}

/** Add the Responses Lite header and payload contract for entitled GPT-5.6 rows. */
export function createOpenAIResponsesLiteWrapper(
  baseStreamFn: StreamFn | undefined,
): StreamFn | undefined {
  if (!baseStreamFn) {
    return undefined;
  }
  return (model, context, options) => {
    if (!shouldUseOpenAIResponsesLite(model)) {
      return baseStreamFn(model, context, options);
    }
    const headers = {
      ...options?.headers,
      [RESPONSES_LITE_HEADER]: "true",
    };
    const liteModel = {
      ...model,
      headers: {
        ...model.headers,
        [RESPONSES_LITE_HEADER]: "true",
      },
    };
    const originalOnPayload = options?.onPayload;
    return baseStreamFn(liteModel, context, {
      ...options,
      headers,
      onPayload: (payload, requestModel) => {
        const nextPayload = originalOnPayload?.(payload, requestModel);
        if (nextPayload instanceof Promise) {
          return nextPayload.then((resolvedPayload) => {
            patchOpenAIResponsesLitePayload({ model, payload: resolvedPayload ?? payload });
            return resolvedPayload;
          });
        }
        patchOpenAIResponsesLitePayload({ model, payload: nextPayload ?? payload });
        return nextPayload;
      },
    });
  };
}
