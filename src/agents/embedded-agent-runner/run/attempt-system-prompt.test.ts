// Coverage for assembling provider-transformed embedded attempt system prompts.
import { beforeAll, describe, expect, it } from "vitest";
import {
  splitSystemPromptCacheBoundary,
  SYSTEM_PROMPT_CACHE_BOUNDARY,
} from "../../system-prompt-cache-boundary.js";

let buildAttemptSystemPrompt: typeof import("./attempt-system-prompt.js").buildAttemptSystemPrompt;

beforeAll(async () => {
  ({ buildAttemptSystemPrompt } = await import("./attempt-system-prompt.js"));
});

const baseProviderTransform = {
  provider: "openai",
  workspaceDir: "/tmp/openclaw",
  context: {
    provider: "openai",
    modelId: "gpt-5.5",
    promptMode: "full" as const,
  },
};

const transformProviderSystemPrompt: Parameters<
  typeof buildAttemptSystemPrompt
>[0]["transformProviderSystemPrompt"] = ({ context }) => context.systemPrompt;

describe("buildAttemptSystemPrompt", () => {
  it("injects workspace identity context", () => {
    // Workspace identity files are part of the base system prompt and must
    // survive provider transformation.
    const result = buildAttemptSystemPrompt({
      isRawModelRun: false,
      transformProviderSystemPrompt,
      embeddedSystemPrompt: {
        workspaceDir: "/tmp/openclaw",
        reasoningTagHint: false,
        runtimeInfo: {
          host: "test-host",
          os: "Darwin",
          arch: "arm64",
          node: "v22.0.0",
          model: "openai/gpt-5.5",
        },
        tools: [],
        modelAliasLines: [],
        userTimezone: "UTC",
        contextFiles: [
          { path: "/tmp/openclaw/SOUL.md", content: "SOUL_CONTEXT_MARKER" },
          { path: "/tmp/openclaw/IDENTITY.md", content: "IDENTITY_CONTEXT_MARKER" },
          { path: "/tmp/openclaw/USER.md", content: "USER_CONTEXT_MARKER" },
        ],
      },
      providerTransform: baseProviderTransform,
    });

    expect(result.systemPrompt).toContain("# Project Context");
    expect(result.systemPrompt).toContain("## /tmp/openclaw/SOUL.md");
    expect(result.systemPrompt).toContain("SOUL_CONTEXT_MARKER");
    expect(result.systemPrompt).toContain("## /tmp/openclaw/IDENTITY.md");
    expect(result.systemPrompt).toContain("IDENTITY_CONTEXT_MARKER");
    expect(result.systemPrompt).toContain("## /tmp/openclaw/USER.md");
    expect(result.systemPrompt).toContain("USER_CONTEXT_MARKER");
  });

  it("preserves bootstrap Project Context", () => {
    const result = buildAttemptSystemPrompt({
      isRawModelRun: false,
      transformProviderSystemPrompt,
      embeddedSystemPrompt: {
        workspaceDir: "/tmp/openclaw",
        reasoningTagHint: false,
        runtimeInfo: {
          host: "test-host",
          os: "Darwin",
          arch: "arm64",
          node: "v22.0.0",
          model: "openai/gpt-5.5",
        },
        tools: [],
        modelAliasLines: [],
        userTimezone: "UTC",
        bootstrapMode: "full",
        bootstrapTruncationNotice: "Bootstrap context was truncated.",
        contextFiles: [
          {
            path: "/tmp/openclaw/BOOTSTRAP.md",
            content: "Reply with BOOTSTRAP_OK.",
          },
          {
            path: "/tmp/openclaw/SOUL.md",
            content: "SOUL_CONTEXT_MARKER",
          },
          {
            path: "/tmp/openclaw/IDENTITY.md",
            content: "IDENTITY_CONTEXT_MARKER",
          },
          {
            path: "/tmp/openclaw/USER.md",
            content: "USER_CONTEXT_MARKER",
          },
        ],
      },
      providerTransform: baseProviderTransform,
    });

    expect(result.systemPrompt).toContain("Current model identity: openai/gpt-5.5.");
    expect(result.systemPrompt).toContain("## Bootstrap Pending");
    expect(result.systemPrompt).toContain("BOOTSTRAP.md is included below in Project Context");
    expect(result.systemPrompt).toContain("## Bootstrap Context Notice");
    expect(result.systemPrompt).toContain("Bootstrap context was truncated.");
    expect(result.systemPrompt).toContain("# Project Context");
    expect(result.systemPrompt).toContain("## /tmp/openclaw/SOUL.md");
    expect(result.systemPrompt).toContain("SOUL_CONTEXT_MARKER");
    expect(result.systemPrompt).toContain("## /tmp/openclaw/IDENTITY.md");
    expect(result.systemPrompt).toContain("IDENTITY_CONTEXT_MARKER");
    expect(result.systemPrompt).toContain("## /tmp/openclaw/USER.md");
    expect(result.systemPrompt).toContain("USER_CONTEXT_MARKER");
    expect(result.systemPrompt).toContain("## /tmp/openclaw/BOOTSTRAP.md");
    expect(result.systemPrompt).toContain("Reply with BOOTSTRAP_OK.");
  });

  it("preserves runtime extra system prompt context", () => {
    const result = buildAttemptSystemPrompt({
      isRawModelRun: false,
      transformProviderSystemPrompt,
      embeddedSystemPrompt: {
        workspaceDir: "/tmp/openclaw",
        reasoningTagHint: false,
        runtimeInfo: {
          host: "test-host",
          os: "Darwin",
          arch: "arm64",
          node: "v22.0.0",
          model: "openai/gpt-5.5",
        },
        tools: [],
        modelAliasLines: [],
        userTimezone: "UTC",
        promptMode: "minimal",
        extraSystemPrompt:
          "# Subagent Context\n\n## Your Role\n- You were created to handle: RUN_MODE_TASK_77950",
        bootstrapMode: "full",
        contextFiles: [],
      },
      providerTransform: baseProviderTransform,
    });

    expect(result.systemPrompt).toContain("Current model identity: openai/gpt-5.5.");
    expect(result.systemPrompt).toContain("## Subagent Context");
    expect(result.systemPrompt).toContain("RUN_MODE_TASK_77950");
  });

  it("uses an agent base prompt as the cache-stable prefix for full embedded runs", () => {
    const customBasePrompt =
      "  CUSTOM_AGENT_BASE\n\n## Tooling\nUser-owned stable tool policy.\n\n";
    const result = buildAttemptSystemPrompt({
      isRawModelRun: false,
      transformProviderSystemPrompt,
      embeddedSystemPrompt: {
        workspaceDir: "/tmp/openclaw",
        reasoningTagHint: false,
        runtimeInfo: {
          host: "test-host",
          os: "Darwin",
          arch: "arm64",
          node: "v22.0.0",
          model: "openai/gpt-5.5",
          channel: "telegram",
        },
        tools: [{ name: "message", description: "Send message", parameters: {} }],
        modelAliasLines: [],
        userTimezone: "UTC",
        agentBasePrompt: customBasePrompt,
        promptContribution: {
          stablePrefix: "PROVIDER_STABLE_SHOULD_NOT_APPEAR",
          dynamicSuffix: "PROVIDER_DYNAMIC_SHOULD_NOT_APPEAR",
          sectionOverrides: {
            interaction_style: "PROVIDER_STYLE_SHOULD_NOT_APPEAR",
          },
        },
        includeMemorySection: true,
        skillsPrompt: "SKILL_CONTEXT_MARKER",
        contextFiles: [
          { path: "/tmp/openclaw/SOUL.md", content: "SOUL_CONTEXT_MARKER" },
          { path: "/tmp/openclaw/HEARTBEAT.md", content: "HEARTBEAT_CONTEXT_MARKER" },
        ],
      },
      providerTransform: baseProviderTransform,
    });

    const split = splitSystemPromptCacheBoundary(result.systemPrompt);
    expect(
      result.systemPrompt.startsWith(`${customBasePrompt}${SYSTEM_PROMPT_CACHE_BOUNDARY}`),
    ).toBe(true);
    expect(split?.stablePrefix).toBe(
      "  CUSTOM_AGENT_BASE\n\n## Tooling\nUser-owned stable tool policy.",
    );
    expect(
      Array.from(result.systemPrompt.matchAll(new RegExp(SYSTEM_PROMPT_CACHE_BOUNDARY, "g"))),
    ).toHaveLength(1);
    expect(split?.dynamicSuffix).toContain("## Workspace");
    expect(split?.dynamicSuffix).toContain("Your working directory is: /tmp/openclaw");
    expect(split?.dynamicSuffix).toContain("## Skills");
    expect(split?.dynamicSuffix).toContain("SKILL_CONTEXT_MARKER");
    expect(split?.dynamicSuffix).toContain("# Project Context");
    expect(split?.dynamicSuffix).toContain("## /tmp/openclaw/SOUL.md");
    expect(split?.dynamicSuffix).toContain("SOUL_CONTEXT_MARKER");
    expect(split?.dynamicSuffix).toContain("## /tmp/openclaw/HEARTBEAT.md");
    expect(split?.dynamicSuffix).toContain("HEARTBEAT_CONTEXT_MARKER");
    expect(split?.dynamicSuffix).toContain("## Messaging");
    expect(split?.dynamicSuffix).toContain("## Assistant Output Directives");
    expect(split?.dynamicSuffix).toContain("## Silent Replies");
    expect(split?.dynamicSuffix).toContain("## Current Date & Time");
    expect(split?.dynamicSuffix).toContain("## Runtime");
    expect(split?.dynamicSuffix).toContain("Current model identity: openai/gpt-5.5.");
    expect(result.systemPrompt).not.toContain(
      "You are a personal assistant running inside OpenClaw.",
    );
    expect(result.systemPrompt).not.toContain("PROVIDER_STABLE_SHOULD_NOT_APPEAR");
    expect(result.systemPrompt).not.toContain("PROVIDER_DYNAMIC_SHOULD_NOT_APPEAR");
    expect(result.systemPrompt).not.toContain("PROVIDER_STYLE_SHOULD_NOT_APPEAR");
  });

  it("omits system prompts for raw model probes", () => {
    // Raw model probes still build a base prompt for diagnostics, but the final
    // provider prompt must be empty.
    const result = buildAttemptSystemPrompt({
      isRawModelRun: true,
      transformProviderSystemPrompt,
      embeddedSystemPrompt: {
        workspaceDir: "/tmp/openclaw",
        reasoningTagHint: false,
        runtimeInfo: {
          host: "test-host",
          os: "Darwin",
          arch: "arm64",
          node: "v22.0.0",
          model: "openai/gpt-5.5",
        },
        tools: [],
        modelAliasLines: [],
        userTimezone: "UTC",
        bootstrapMode: "full",
        contextFiles: [
          {
            path: "/tmp/openclaw/BOOTSTRAP.md",
            content: "Reply with BOOTSTRAP_OK.",
          },
        ],
      },
      providerTransform: baseProviderTransform,
    });

    expect(result.baseSystemPrompt).toContain("BOOTSTRAP.md is included below in Project Context");
    expect(result.systemPrompt).toBe("");
  });
});
