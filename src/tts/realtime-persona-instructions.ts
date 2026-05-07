import type { OpenClawConfig } from "../config/types.js";
import type { ResolvedTtsPersona } from "../config/types.tts.js";
import type { TtsConfigResolutionContext } from "./tts-config.js";
import { getTtsPersona, resolveTtsConfig, resolveTtsPrefsPath } from "./tts.js";

function normalizeInstructionText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function appendField(lines: string[], label: string, value: string | undefined): void {
  const normalized = normalizeInstructionText(value);
  if (normalized) {
    lines.push(`${label}: ${normalized}`);
  }
}

export function renderTtsPersonaDeliveryInstructions(
  persona: ResolvedTtsPersona | undefined,
): string | undefined {
  if (!persona) {
    return undefined;
  }

  const lines: string[] = [];
  appendField(lines, "Name", persona.label);
  appendField(lines, "Description", persona.description);
  appendField(lines, "Profile", persona.prompt?.profile);
  appendField(lines, "Scene", persona.prompt?.scene);
  appendField(lines, "Context", persona.prompt?.sampleContext);
  appendField(lines, "Style", persona.prompt?.style);
  appendField(lines, "Accent", persona.prompt?.accent);
  appendField(lines, "Pacing", persona.prompt?.pacing);

  for (const constraint of persona.prompt?.constraints ?? []) {
    appendField(lines, "Constraint", constraint);
  }

  return lines.length > 0 ? lines.join("\n") : undefined;
}

export function resolveTtsPersonaDeliveryInstructions(
  cfg: OpenClawConfig,
  context?: TtsConfigResolutionContext,
): string | undefined {
  const ttsConfig = resolveTtsConfig(cfg, context);
  const prefsPath = resolveTtsPrefsPath(ttsConfig);
  return renderTtsPersonaDeliveryInstructions(getTtsPersona(ttsConfig, prefsPath));
}
