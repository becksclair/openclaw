import os from "node:os";
import { resolveChannelCapabilities } from "../config/channel-capabilities.js";
import type { OpenClawConfig } from "../config/config.js";
import type { RealtimeToolDefinition } from "../gateway/realtime-audio/types.js";
import { getMachineDisplayName } from "../infra/machine-name.js";
import { buildTtsSystemPromptHint } from "../tts/tts.js";
import { resolveBootstrapContextForRun } from "./bootstrap-files.js";
import {
  listChannelSupportedActions,
  resolveChannelMessageToolHints,
  resolveChannelReactionGuidance,
} from "./channel-tools.js";
import { resolveOpenClawDocsPath } from "./docs-path.js";
import { buildModelAliasLines } from "./model-alias-lines.js";
import { resolveDefaultModelForAgent } from "./model-selection.js";
import { resolveOwnerDisplaySetting } from "./owner-display.js";
import { resolvePromptModeForSession } from "./pi-embedded-runner/run/attempt.prompt-helpers.js";
import { resolveEmbeddedRunSkillEntries } from "./pi-embedded-runner/skills-runtime.js";
import { detectRuntimeShell } from "./shell-utils.js";
import { resolveSkillsPromptForRun } from "./skills.js";
import { buildSystemPromptParams } from "./system-prompt-params.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";

export async function buildRealtimeSessionInstructions(params: {
  cfg: OpenClawConfig;
  agentId: string;
  sessionKey: string;
  provider: string;
  model: string;
  transport: "desktop" | "discord" | "test";
  workspaceDir: string;
  tools: RealtimeToolDefinition[];
}): Promise<string> {
  const { contextFiles } = await resolveBootstrapContextForRun({
    workspaceDir: params.workspaceDir,
    config: params.cfg,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
  });
  const { shouldLoadSkillEntries, skillEntries } = resolveEmbeddedRunSkillEntries({
    workspaceDir: params.workspaceDir,
    config: params.cfg,
  });
  const skillsPrompt = resolveSkillsPromptForRun({
    entries: shouldLoadSkillEntries ? skillEntries : undefined,
    config: params.cfg,
    workspaceDir: params.workspaceDir,
  });
  const runtimeChannel = params.transport === "discord" ? "discord" : undefined;
  const machineName = await getMachineDisplayName();
  const defaultModelRef = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const defaultModelLabel = `${defaultModelRef.provider}/${defaultModelRef.model}`;
  const channelActions = runtimeChannel
    ? listChannelSupportedActions({
        cfg: params.cfg,
        channel: runtimeChannel,
        sessionKey: params.sessionKey,
        agentId: params.agentId,
      })
    : undefined;
  const { runtimeInfo, userTimezone, userTime, userTimeFormat } = buildSystemPromptParams({
    config: params.cfg,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
    cwd: params.workspaceDir,
    runtime: {
      host: machineName,
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      node: process.version,
      model: `${params.provider}/${params.model}`,
      defaultModel: defaultModelLabel,
      shell: detectRuntimeShell(),
      channel: runtimeChannel,
      capabilities: resolveChannelCapabilities({
        cfg: params.cfg,
        channel: runtimeChannel,
      }),
      channelActions,
    },
  });
  const docsPath = await resolveOpenClawDocsPath({
    workspaceDir: params.workspaceDir,
    argv1: process.argv[1],
    cwd: params.workspaceDir,
    moduleUrl: import.meta.url,
  });
  const ownerDisplay = resolveOwnerDisplaySetting(params.cfg);
  return buildAgentSystemPrompt({
    workspaceDir: params.workspaceDir,
    skillsPrompt: skillsPrompt || undefined,
    docsPath: docsPath ?? undefined,
    ttsHint: buildTtsSystemPromptHint(params.cfg),
    promptMode: resolvePromptModeForSession(params.sessionKey),
    acpEnabled: params.cfg.acp?.enabled !== false,
    runtimeInfo,
    messageToolHints: resolveChannelMessageToolHints({
      cfg: params.cfg,
      channel: runtimeChannel,
    }),
    reactionGuidance: resolveChannelReactionGuidance({
      cfg: params.cfg,
      channel: runtimeChannel,
    }),
    toolNames: params.tools.map((tool) => tool.name),
    modelAliasLines: buildModelAliasLines(params.cfg),
    userTimezone,
    userTime,
    userTimeFormat,
    contextFiles,
    ownerDisplay: ownerDisplay.ownerDisplay,
    ownerDisplaySecret: ownerDisplay.ownerDisplaySecret,
  });
}
