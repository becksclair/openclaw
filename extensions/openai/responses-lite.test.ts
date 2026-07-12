import type { StreamFn } from "openclaw/plugin-sdk/agent-core";
import type { Context, Model } from "openclaw/plugin-sdk/llm";
import { describe, expect, it } from "vitest";
import { buildOpenAIResponsesProviderHooks } from "./shared.js";

const GPT_56_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;

function captureRequest(tools: unknown[] = [{ type: "function", name: "memory_search" }]) {
  let payload: Record<string, unknown> | undefined;
  let headers: Record<string, string> | undefined;
  const streamFn: StreamFn = (model, _context, options) => {
    headers = options?.headers;
    const nextPayload: Record<string, unknown> = {
      model: model.id,
      instructions: "Use memory tools selectively.",
      input: [{ type: "message", role: "user", content: "Recall this." }],
      tools,
      parallel_tool_calls: true,
      reasoning: { effort: "low" },
    };
    options?.onPayload?.(nextPayload, model);
    payload = nextPayload;
    return {} as ReturnType<StreamFn>;
  };
  return {
    streamFn,
    getPayload: () => payload,
    getHeaders: () => headers,
  };
}

function runHook(params: {
  modelId: string;
  simple: boolean;
  extraParams?: Record<string, unknown>;
  thinkingLevel?: "off" | "low";
}) {
  const capture = captureRequest();
  const hooks = buildOpenAIResponsesProviderHooks();
  const hook = params.simple ? hooks.wrapSimpleCompletionStreamFn : hooks.wrapStreamFn;
  const wrapped = hook?.({
    provider: "openai",
    modelId: params.modelId,
    extraParams: params.extraParams,
    thinkingLevel: params.thinkingLevel,
    streamFn: capture.streamFn,
  } as never);
  const model = {
    api: "openai-chatgpt-responses",
    provider: "openai",
    id: params.modelId,
    baseUrl: "https://chatgpt.com/backend-api/codex",
  } as Model<"openai-chatgpt-responses">;
  void wrapped?.(model, { messages: [] } as Context, {});
  return capture;
}

describe("OpenAI Responses Lite", () => {
  it("adds the Codex-compatible identity through provider-owned turn state", () => {
    const hooks = buildOpenAIResponsesProviderHooks();
    const state = hooks.resolveTransportTurnState?.({
      provider: "openai",
      modelId: "gpt-5.6-luna",
      model: {
        provider: "openai",
        id: "gpt-5.6-luna",
        baseUrl: "https://chatgpt.com/backend-api/codex",
      },
      turnId: "turn-1",
      attempt: 1,
      transport: "stream",
    } as never);

    expect(state?.headers).toMatchObject({
      originator: "Codex Desktop",
      "User-Agent": "Codex Desktop/0.144.1 (OpenClaw Responses Lite)",
      "x-openai-internal-codex-responses-lite": "true",
    });
  });

  it.each(GPT_56_MODELS)("rewrites full agent payloads for %s", (modelId) => {
    const capture = runHook({ modelId, simple: false });

    expect(capture.getHeaders()).toMatchObject({
      "x-openai-internal-codex-responses-lite": "true",
    });
    expect(capture.getPayload()).toEqual({
      model: modelId,
      input: [
        {
          type: "additional_tools",
          role: "developer",
          tools: [{ type: "function", name: "memory_search" }],
        },
        {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "Use memory tools selectively." }],
        },
        { type: "message", role: "user", content: "Recall this." },
      ],
      parallel_tool_calls: false,
      tool_choice: "auto",
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "low", context: "all_turns" },
    });
  });

  it("preserves fast mode through the Responses Lite wrapper stack", () => {
    const capture = runHook({
      modelId: "gpt-5.6-luna",
      simple: false,
      extraParams: { fastMode: true },
    });

    expect(capture.getPayload()?.service_tier).toBe("priority");
  });

  it("preserves thinking off through the composed Responses Lite wrapper stack", () => {
    const capture = runHook({
      modelId: "gpt-5.6-luna",
      simple: false,
      thinkingLevel: "off",
    });

    expect(capture.getPayload()).not.toHaveProperty("reasoning");
    expect(capture.getPayload()).not.toHaveProperty("include");
  });

  it.each(GPT_56_MODELS)("rewrites simple-completion payloads for %s", (modelId) => {
    const capture = runHook({ modelId, simple: true });
    expect(capture.getHeaders()).toMatchObject({
      "x-openai-internal-codex-responses-lite": "true",
    });
    expect(capture.getPayload()).not.toHaveProperty("instructions");
    expect(capture.getPayload()).not.toHaveProperty("tools");
    expect(capture.getPayload()?.parallel_tool_calls).toBe(false);
  });

  it("emits the empty additional_tools envelope required by Responses Lite", () => {
    const capture = captureRequest([]);
    const hooks = buildOpenAIResponsesProviderHooks();
    const wrapped = hooks.wrapSimpleCompletionStreamFn?.({
      provider: "openai",
      modelId: "gpt-5.6-luna",
      streamFn: capture.streamFn,
    } as never);
    void wrapped?.(
      {
        api: "openai-chatgpt-responses",
        provider: "openai",
        id: "gpt-5.6-luna",
        baseUrl: "https://chatgpt.com/backend-api/codex",
      } as Model<"openai-chatgpt-responses">,
      { messages: [] } as Context,
      {},
    );
    expect(capture.getPayload()?.input).toContainEqual(
      expect.objectContaining({ type: "additional_tools", tools: [] }),
    );
  });

  it("enforces the Lite contract after outer request shapers run", async () => {
    const capture = captureRequest();
    const hooks = buildOpenAIResponsesProviderHooks();
    const wrapped = hooks.wrapStreamFn?.({
      provider: "openai",
      modelId: "gpt-5.6-luna",
      streamFn: capture.streamFn,
    } as never);
    void wrapped?.(
      {
        api: "openai-chatgpt-responses",
        provider: "openai",
        id: "gpt-5.6-luna",
        baseUrl: "https://chatgpt.com/backend-api/codex",
      } as Model<"openai-chatgpt-responses">,
      { messages: [] } as Context,
      {
        onPayload: (payload) => {
          (payload as Record<string, unknown>).parallel_tool_calls = true;
        },
      },
    );
    await Promise.resolve();

    expect(capture.getPayload()?.parallel_tool_calls).toBe(false);
  });

  it.each(["gpt-5.5", "gpt-5.4"])("leaves non-Lite model %s unchanged", (modelId) => {
    const capture = runHook({ modelId, simple: true });
    expect(capture.getHeaders()).toBeUndefined();
    expect(capture.getPayload()).toMatchObject({
      instructions: "Use memory tools selectively.",
      tools: [{ type: "function", name: "memory_search" }],
      parallel_tool_calls: true,
      reasoning: { effort: "low" },
    });
  });
});
