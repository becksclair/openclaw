import type { OpenClawConfig } from "../config/types.js";

export type MediaAudioRuntimeOverrides = {
  provider?: string;
  model?: string;
  language?: string;
  prompt?: string;
  timeoutMs?: number;
};

export function buildMediaAudioRuntimeConfig(
  cfg: OpenClawConfig,
  overrides: MediaAudioRuntimeOverrides,
): OpenClawConfig {
  const provider = overrides.provider?.trim();
  const model = overrides.model?.trim();
  const language = overrides.language?.trim();
  const prompt = overrides.prompt?.trim();
  const timeoutMs = overrides.timeoutMs;
  const hasTimeout = timeoutMs !== undefined;

  if (!provider && !model && !language && !prompt && !hasTimeout) {
    return cfg;
  }

  return {
    ...cfg,
    tools: {
      ...cfg.tools,
      media: {
        ...cfg.tools?.media,
        audio: {
          ...cfg.tools?.media?.audio,
          ...(hasTimeout
            ? {
                timeoutSeconds: Math.ceil(timeoutMs / 1_000),
              }
            : {}),
          ...(language ? { _requestLanguageOverride: language, language } : {}),
          ...(prompt ? { _requestPromptOverride: prompt, prompt } : {}),
          ...(provider
            ? {
                models: [
                  {
                    provider,
                    ...(model ? { model } : {}),
                  },
                ],
              }
            : {}),
        },
      },
    },
  };
}
