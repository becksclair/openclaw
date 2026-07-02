// Codex tests cover attempt context plugin behavior.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EmbeddedRunAttemptParams } from "openclaw/plugin-sdk/agent-harness-runtime";
import { describe, expect, it } from "vitest";
import {
  buildCodexContextEnginePromptBudget,
  buildCodexPromptSurfaceProfile,
  buildCodexWorkspaceBootstrapContext,
  buildCodexSystemPromptReport,
  readContextEngineThreadBootstrapProjection,
  remapCodexContextFilePath,
  resolveContextEngineBootstrapProjectionDecision,
} from "./attempt-context.js";
import type { CodexDynamicToolSpec } from "./protocol.js";
import type { CodexAppServerContextEngineBinding } from "./session-binding.js";

describe("Codex app-server attempt context", () => {
  it("returns a run context report without deferred Codex dynamic tool schemas", () => {
    const tools = [
      {
        type: "function",
        name: "message",
        description: "Send a message.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
        },
      },
      {
        type: "namespace",
        name: "openclaw",
        description: "",
        tools: [
          {
            type: "function",
            name: "web_search",
            description: "Search the web.",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
            },
            deferLoading: true,
          },
        ],
      },
    ] as CodexDynamicToolSpec[];

    const report = buildCodexSystemPromptReport({
      attempt: {
        sessionId: "session-1",
        provider: "codex",
        modelId: "gpt-5.4-codex",
      } as EmbeddedRunAttemptParams,
      sessionKey: "agent:main:session-1",
      workspaceDir: path.join("tmp", "workspace"),
      developerInstructions: "test developer instructions",
      workspaceBootstrapContext: {
        bootstrapFiles: [],
        contextFiles: [],
        promptContextFiles: [],
        developerInstructionFiles: [],
        heartbeatReferenceFiles: [],
      },
      skillsPrompt: "",
      tools,
    });

    expect(report.source).toBe("run");
    expect(report.provider).toBe("codex");
    expect(report.model).toBe("gpt-5.4-codex");
    expect(report.systemPrompt.chars).toBeGreaterThan(0);
    expect(report.systemPrompt.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.skills.hash).toMatch(/^[a-f0-9]{64}$/u);

    const message = report.tools.entries.find((tool) => tool.name === "message");
    const webSearch = report.tools.entries.find((tool) => tool.name === "web_search");
    expect(message?.schemaChars).toBeGreaterThan(0);
    expect(message?.summaryHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(message?.schemaHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(webSearch?.schemaChars).toBe(0);
    expect(webSearch?.summaryHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(webSearch?.schemaHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.tools.schemaChars).toBe(message?.schemaChars);
  });

  it("builds content-free prompt surface profiles for profiler diagnostics", () => {
    const sensitiveText = "secret-never-log";
    const tools = [
      {
        type: "function",
        name: "message",
        description: `Send ${sensitiveText}.`,
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
        },
      },
    ] as CodexDynamicToolSpec[];
    const report = buildCodexSystemPromptReport({
      attempt: {
        sessionId: "session-1",
        provider: "codex",
        modelId: "gpt-5.4-codex",
      } as EmbeddedRunAttemptParams,
      sessionKey: "agent:main:session-1",
      workspaceDir: path.join("tmp", "workspace"),
      developerInstructions: `developer ${sensitiveText}`,
      workspaceBootstrapContext: {
        bootstrapFiles: [
          {
            name: "AGENTS.md",
            path: path.join("tmp", "workspace", "AGENTS.md"),
            content: `project ${sensitiveText}`,
            missing: false,
          },
        ],
        contextFiles: [],
        promptContextFiles: [
          {
            path: path.join("tmp", "workspace", "AGENTS.md"),
            content: `project ${sensitiveText}`,
          },
        ],
        developerInstructionFiles: [],
        heartbeatReferenceFiles: [],
      },
      skillsPrompt: `<skill><name>memory-recall</name><content>${sensitiveText}</content></skill>`,
      tools,
    });

    const profile = buildCodexPromptSurfaceProfile({
      systemPromptReport: report,
      turnPrompt: `turn ${sensitiveText}`,
      rawPrompt: `raw ${sensitiveText}`,
      developerInstructions: `developer ${sensitiveText}`,
      threadDeveloperInstructions: `thread ${sensitiveText}`,
      turnCollaborationInstructions: `collaboration ${sensitiveText}`,
      baseInstructions: `base ${sensitiveText}`,
      openClawPromptContext: `frame ${sensitiveText}`,
      contextEngine: {
        active: true,
        projectionMode: "per_turn",
        prePromptMessageCount: 3,
        promptContextChars: 27,
      },
    });

    expect(profile.source).toBe("codex-app-server");
    expect(profile.totals.promptChars).toBe(`turn ${sensitiveText}`.length);
    expect(profile.contextEngine).toEqual({
      active: true,
      projectionMode: "per_turn",
      prePromptMessageCount: 3,
      promptContextChars: 27,
    });
    expect(profile.buckets.map((entry) => entry.name)).toContain("tools.definitions");
    expect(profile.topWorkspaceFiles[0]).toMatchObject({ name: "AGENTS.md" });
    expect(profile.topSkills[0]).toMatchObject({ name: "memory-recall" });
    expect(profile.topTools[0]).toMatchObject({ name: "message" });
    expect(JSON.stringify(profile)).not.toContain(sensitiveText);
  });

  it("builds context-engine budget accounting from host-owned Codex prompt surfaces", () => {
    const buildReport = (skillsPrompt: string) =>
      buildCodexSystemPromptReport({
        attempt: {
          sessionId: "session-1",
          provider: "codex",
          modelId: "gpt-5.4-codex",
        } as EmbeddedRunAttemptParams,
        sessionKey: "agent:main:session-1",
        workspaceDir: path.join("tmp", "workspace"),
        developerInstructions: "developer instructions".repeat(20),
        workspaceBootstrapContext: {
          bootstrapFiles: [],
          contextFiles: [],
        },
        skillsPrompt,
        tools: [
          {
            type: "function",
            name: "message",
            description: "Send a message.",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
            },
          },
        ] as CodexDynamicToolSpec[],
      });
    const report = buildReport("");
    const reportWithSkills = buildReport("<skill>large skill prompt</skill>".repeat(2_000));

    const budget = buildCodexContextEnginePromptBudget({
      promptTokenBudget: 1_000,
      systemPromptReport: report,
      turnPrompt: "current user request",
      developerInstructions: "developer instructions".repeat(20),
      baseInstructions: "base instructions".repeat(30),
      openClawPromptContext: "workspace frame".repeat(10),
    });

    expect(budget.schemaVersion).toBe(1);
    expect(budget.source).toBe("host_estimate");
    expect(budget.promptTokenBudget).toBe(1_000);
    expect(budget.nonEnginePromptTokens).toBeGreaterThan(0);
    expect(budget.enginePromptTokenBudget).toBe(
      Math.max(0, budget.promptTokenBudget! - budget.nonEnginePromptTokens!),
    );

    const attributedSkillsBudget = buildCodexContextEnginePromptBudget({
      promptTokenBudget: 1_000,
      systemPromptReport: reportWithSkills,
      turnPrompt: "current user request",
      developerInstructions: "developer instructions".repeat(20),
      baseInstructions: "base instructions".repeat(30),
      openClawPromptContext: "workspace frame".repeat(10),
    });
    expect(attributedSkillsBudget.nonEnginePromptTokens).toBe(budget.nonEnginePromptTokens);

    const renderedSkillsBudget = buildCodexContextEnginePromptBudget({
      promptTokenBudget: 1_000,
      systemPromptReport: reportWithSkills,
      turnPrompt: "current user request",
      developerInstructions:
        "developer instructions".repeat(20) + "<skill>large skill prompt</skill>".repeat(2_000),
      baseInstructions: "base instructions".repeat(30),
      openClawPromptContext: "workspace frame".repeat(10),
    });
    expect(renderedSkillsBudget.nonEnginePromptTokens).toBeGreaterThan(
      budget.nonEnginePromptTokens!,
    );
    expect(renderedSkillsBudget.enginePromptTokenBudget).toBe(0);
  });

  it("keeps MEMORY.md injected when sandbox effective workspace differs", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memory-workspace-"));
    const sandboxWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memory-sandbox-"));
    const memorySummary = "Sandboxed turns need bounded memory fallback.";
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), memorySummary);

    const context = await buildCodexWorkspaceBootstrapContext({
      params: {
        sessionId: "session-1",
        sessionKey: "agent:main:session-1",
        config: {
          agents: {
            defaults: {
              workspace: workspaceDir,
            },
          },
        },
      } as EmbeddedRunAttemptParams,
      resolvedWorkspace: workspaceDir,
      effectiveWorkspace: sandboxWorkspaceDir,
      sessionKey: "agent:main:session-1",
      sessionAgentId: "main",
      memoryToolNames: ["memory_search", "memory_get"],
    });

    expect(context.memoryReferenceFiles).toEqual([]);
    expect(context.promptContext).toContain(memorySummary);
    expect(context.memoryToolRouted).toBe(false);
  });

  it("skips workspace bootstrap context for the memory recall prompt profile", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memory-profile-"));
    await fs.writeFile(path.join(workspaceDir, "AGENTS.md"), "Do visible workspace things.");
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Visible workspace memory.");

    const context = await buildCodexWorkspaceBootstrapContext({
      params: {
        sessionId: "session-1",
        sessionKey: "agent:main:session-1:active-memory:recall",
        promptProfile: "memory_recall",
      } as EmbeddedRunAttemptParams,
      resolvedWorkspace: workspaceDir,
      effectiveWorkspace: workspaceDir,
      sessionKey: "agent:main:session-1:active-memory:recall",
      sessionAgentId: "main",
      memoryToolNames: ["memory_search", "memory_get"],
    });

    expect(context.bootstrapFiles).toEqual([]);
    expect(context.contextFiles).toEqual([]);
    expect(context.promptContextFiles).toEqual([]);
    expect(context.developerInstructionFiles).toEqual([]);
    expect(context.turnScopedDeveloperInstructionFiles).toEqual([]);
    expect(context.heartbeatReferenceFiles).toEqual([]);
    expect(context.memoryReferenceFiles).toEqual([]);
    expect(context.memoryToolRoutedBootstrapFiles).toEqual([]);
    expect(context.memoryToolNames).toEqual([]);
    expect(context.memoryToolRouted).toBe(false);
    expect(context.promptContext).toBeUndefined();
    expect(context.developerInstructions).toBeUndefined();
    expect(context.memoryCollaborationInstructions).toBeUndefined();
  });

  it("remaps Codex bootstrap files under dot-prefixed workspace directories", () => {
    expect(
      remapCodexContextFilePath({
        file: {
          path: "/real/workspace/..context/SOUL.md",
          content: "Soul voice goes here.",
        },
        sourceWorkspaceDir: "/real/workspace",
        targetWorkspaceDir: "/sandbox/workspace",
      }),
    ).toEqual({
      path: "/sandbox/workspace/..context/SOUL.md",
      content: "Soul voice goes here.",
    });
    expect(
      remapCodexContextFilePath({
        file: {
          path: "/outside/SOUL.md",
          content: "outside",
        },
        sourceWorkspaceDir: "/real/workspace",
        targetWorkspaceDir: "/sandbox/workspace",
      }),
    ).toEqual({
      path: "/outside/SOUL.md",
      content: "outside",
    });
  });

  it("reads and compares thread-bootstrap context-engine projections", () => {
    const projection = readContextEngineThreadBootstrapProjection({
      mode: "thread_bootstrap",
      epoch: " epoch-1 ",
      fingerprint: " fingerprint-1 ",
    });
    expect(projection).toEqual({
      mode: "thread_bootstrap",
      epoch: "epoch-1",
      fingerprint: "fingerprint-1",
    });

    const expectedBinding = {
      schemaVersion: 1,
      engineId: "lossless",
      policyFingerprint: "policy-v1",
      projection: {
        schemaVersion: 1,
        mode: "thread_bootstrap",
        epoch: "epoch-1",
        fingerprint: "fingerprint-1",
      },
    } satisfies CodexAppServerContextEngineBinding;
    expect(
      resolveContextEngineBootstrapProjectionDecision({
        startupBinding: {
          threadId: "thread-existing",
          dynamicToolsFingerprint: "same-tools",
          contextEngine: expectedBinding,
        } as never,
        expectedBinding,
        projection: projection!,
        dynamicToolsFingerprint: "same-tools",
      }),
    ).toEqual({
      project: false,
      reason: "matching-thread-bootstrap-binding",
    });
    expect(
      resolveContextEngineBootstrapProjectionDecision({
        startupBinding: {
          threadId: "thread-existing",
          dynamicToolsFingerprint: "old-tools",
          contextEngine: expectedBinding,
        } as never,
        expectedBinding,
        projection: projection!,
        dynamicToolsFingerprint: "new-tools",
      }),
    ).toEqual({
      project: true,
      reason: "dynamic-tools-mismatch",
    });
  });
});
