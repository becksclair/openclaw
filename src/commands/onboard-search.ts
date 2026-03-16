import {
  describeCodexNativeWebSearch,
  isCodexNativeWebSearchRelevant,
} from "../agents/codex-native-web-search.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  DEFAULT_SECRET_PROVIDER_ALIAS,
  type SecretInput,
  type SecretRef,
  hasConfiguredSecretInput,
  normalizeSecretInputString,
} from "../config/types.secrets.js";
import { enablePluginInConfig } from "../plugins/enable.js";
import { resolvePluginWebSearchProviders } from "../plugins/web-search-providers.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type { SecretInputMode } from "./onboard-types.js";

export type SearchProvider = NonNullable<
  NonNullable<NonNullable<NonNullable<OpenClawConfig["tools"]>["web"]>["search"]>["provider"]
>;

const SEARCH_PROVIDER_IDS = ["brave", "firecrawl", "gemini", "grok", "kimi", "perplexity"] as const;

function isSearchProvider(value: string): value is SearchProvider {
  return (SEARCH_PROVIDER_IDS as readonly string[]).includes(value);
}

function hasSearchProviderId<T extends { id: string }>(
  provider: T,
): provider is T & { id: SearchProvider } {
  return isSearchProvider(provider.id);
}

type SearchProviderEntry = {
  value: SearchProvider;
  label: string;
  hint: string;
  envKeys: string[];
  placeholder: string;
  signupUrl: string;
};

export const SEARCH_PROVIDER_OPTIONS: readonly SearchProviderEntry[] =
  resolvePluginWebSearchProviders({
    bundledAllowlistCompat: true,
  })
    .filter(hasSearchProviderId)
    .map((provider) => ({
      value: provider.id,
      label: provider.label,
      hint: provider.hint,
      envKeys: provider.envVars,
      placeholder: provider.placeholder,
      signupUrl: provider.signupUrl,
    }));

export function hasKeyInEnv(entry: SearchProviderEntry): boolean {
  return entry.envKeys.some((k) => Boolean(process.env[k]?.trim()));
}

function rawKeyValue(config: OpenClawConfig, provider: SearchProvider): unknown {
  const search = config.tools?.web?.search;
  const entry = resolvePluginWebSearchProviders({
    config,
    bundledAllowlistCompat: true,
  }).find((candidate) => candidate.id === provider);
  return entry?.getCredentialValue(search as Record<string, unknown> | undefined);
}

/** Returns the plaintext key string, or undefined for SecretRefs/missing. */
export function resolveExistingKey(
  config: OpenClawConfig,
  provider: SearchProvider,
): string | undefined {
  return normalizeSecretInputString(rawKeyValue(config, provider));
}

/** Returns true if a key is configured (plaintext string or SecretRef). */
export function hasExistingKey(config: OpenClawConfig, provider: SearchProvider): boolean {
  return hasConfiguredSecretInput(rawKeyValue(config, provider));
}

/** Build an env-backed SecretRef for a search provider. */
function buildSearchEnvRef(provider: SearchProvider): SecretRef {
  const entry = SEARCH_PROVIDER_OPTIONS.find((e) => e.value === provider);
  const envVar = entry?.envKeys.find((k) => Boolean(process.env[k]?.trim())) ?? entry?.envKeys[0];
  if (!envVar) {
    throw new Error(
      `No env var mapping for search provider "${provider}" in secret-input-mode=ref.`,
    );
  }
  return { source: "env", provider: DEFAULT_SECRET_PROVIDER_ALIAS, id: envVar };
}

/** Resolve a plaintext key into the appropriate SecretInput based on mode. */
function resolveSearchSecretInput(
  provider: SearchProvider,
  key: string,
  secretInputMode?: SecretInputMode,
): SecretInput {
  const useSecretRefMode = secretInputMode === "ref"; // pragma: allowlist secret
  if (useSecretRefMode) {
    return buildSearchEnvRef(provider);
  }
  return key;
}

export function applySearchKey(
  config: OpenClawConfig,
  provider: SearchProvider,
  key: SecretInput,
): OpenClawConfig {
  const search = { ...config.tools?.web?.search, provider, enabled: true };
  const entry = resolvePluginWebSearchProviders({
    config,
    bundledAllowlistCompat: true,
  }).find((candidate) => candidate.id === provider);
  if (entry) {
    entry.setCredentialValue(search as Record<string, unknown>, key);
  }
  const next = {
    ...config,
    tools: {
      ...config.tools,
      web: { ...config.tools?.web, search },
    },
  };
  if (provider !== "firecrawl") {
    return next;
  }
  return enablePluginInConfig(next, "firecrawl").config;
}

function applyProviderOnly(config: OpenClawConfig, provider: SearchProvider): OpenClawConfig {
  const next = {
    ...config,
    tools: {
      ...config.tools,
      web: {
        ...config.tools?.web,
        search: {
          ...config.tools?.web?.search,
          provider,
          enabled: true,
        },
      },
    },
  };
  if (provider !== "firecrawl") {
    return next;
  }
  return enablePluginInConfig(next, "firecrawl").config;
}

function preserveDisabledState(original: OpenClawConfig, result: OpenClawConfig): OpenClawConfig {
  if (original.tools?.web?.search?.enabled !== false) {
    return result;
  }
  return {
    ...result,
    tools: {
      ...result.tools,
      web: { ...result.tools?.web, search: { ...result.tools?.web?.search, enabled: false } },
    },
  };
}

function applyCodexNativeSearchConfig(
  config: OpenClawConfig,
  params: { enabled: boolean; mode?: "cached" | "live" },
): OpenClawConfig {
  return {
    ...config,
    tools: {
      ...config.tools,
      web: {
        ...config.tools?.web,
        search: {
          ...config.tools?.web?.search,
          enabled: params.enabled ? true : config.tools?.web?.search?.enabled,
          openaiCodex: {
            ...config.tools?.web?.search?.openaiCodex,
            enabled: params.enabled,
            ...(params.mode ? { mode: params.mode } : {}),
          },
        },
      },
    },
  };
}

export type SetupSearchOptions = {
  agentId?: string;
  agentDir?: string;
  quickstartDefaults?: boolean;
  secretInputMode?: SecretInputMode;
};

export async function setupSearch(
  config: OpenClawConfig,
  _runtime: RuntimeEnv,
  prompter: WizardPrompter,
  opts?: SetupSearchOptions,
): Promise<OpenClawConfig> {
  await prompter.note(
    [
      "Web search lets your agent look things up online.",
      "You can configure a managed provider now, and Codex-capable models can also use native Codex web search.",
      "Docs: https://docs.openclaw.ai/tools/web",
    ].join("\n"),
    "Web search",
  );

  const enableSearch = await prompter.confirm({
    message: "Enable web_search?",
    initialValue: config.tools?.web?.search?.enabled !== false,
  });
  if (!enableSearch) {
    return {
      ...config,
      tools: {
        ...config.tools,
        web: {
          ...config.tools?.web,
          search: {
            ...config.tools?.web?.search,
            enabled: false,
          },
        },
      },
    };
  }

  let nextConfig: OpenClawConfig = {
    ...config,
    tools: {
      ...config.tools,
      web: {
        ...config.tools?.web,
        search: {
          ...config.tools?.web?.search,
          enabled: true,
        },
      },
    },
  };
  const codexRelevant = isCodexNativeWebSearchRelevant({
    config: nextConfig,
    agentId: opts?.agentId,
    agentDir: opts?.agentDir,
  });
  if (codexRelevant) {
    const currentNativeSummary = describeCodexNativeWebSearch(nextConfig);
    await prompter.note(
      [
        "Codex-capable models can optionally use native Codex web search.",
        "This does not replace managed web_search for other models.",
        "If you skip managed provider setup, non-Codex models still rely on provider auto-detect and may have no search available.",
        ...(currentNativeSummary ? [currentNativeSummary] : ["Recommended mode: cached."]),
      ].join("\n"),
      "Codex native search",
    );
    const enableCodexNative = await prompter.confirm({
      message: "Enable native Codex web search for Codex-capable models?",
      initialValue: config.tools?.web?.search?.openaiCodex?.enabled === true,
    });
    if (enableCodexNative) {
      const codexMode = await prompter.select<"cached" | "live">({
        message: "Codex native web search mode",
        options: [
          {
            value: "cached",
            label: "cached (recommended)",
            hint: "Uses cached web content",
          },
          {
            value: "live",
            label: "live",
            hint: "Allows live external web access",
          },
        ],
        initialValue: config.tools?.web?.search?.openaiCodex?.mode ?? "cached",
      });
      nextConfig = applyCodexNativeSearchConfig(nextConfig, {
        enabled: true,
        mode: codexMode,
      });
      const configureManagedProvider = await prompter.confirm({
        message: "Configure a managed web search provider now?",
        initialValue: Boolean(config.tools?.web?.search?.provider),
      });
      if (!configureManagedProvider) {
        return nextConfig;
      }
    } else {
      nextConfig = applyCodexNativeSearchConfig(nextConfig, { enabled: false });
    }
  }

  const existingProvider = nextConfig.tools?.web?.search?.provider;

  const options = SEARCH_PROVIDER_OPTIONS.map((entry) => {
    const configured = hasExistingKey(nextConfig, entry.value) || hasKeyInEnv(entry);
    const hint = configured ? `${entry.hint} · configured` : entry.hint;
    return { value: entry.value, label: entry.label, hint };
  });

  const defaultProvider: SearchProvider = (() => {
    if (existingProvider && SEARCH_PROVIDER_OPTIONS.some((e) => e.value === existingProvider)) {
      return existingProvider;
    }
    const detected = SEARCH_PROVIDER_OPTIONS.find(
      (e) => hasExistingKey(nextConfig, e.value) || hasKeyInEnv(e),
    );
    if (detected) {
      return detected.value;
    }
    return SEARCH_PROVIDER_OPTIONS[0].value;
  })();

  type PickerValue = SearchProvider | "__skip__";
  const choice = await prompter.select<PickerValue>({
    message: "Search provider",
    options: [
      ...options,
      {
        value: "__skip__" as const,
        label: "Skip for now",
        hint: "Configure later with openclaw configure --section web",
      },
    ],
    initialValue: defaultProvider,
  });

  if (choice === "__skip__") {
    return nextConfig;
  }

  const entry = SEARCH_PROVIDER_OPTIONS.find((e) => e.value === choice)!;
  const existingKey = resolveExistingKey(nextConfig, choice);
  const keyConfigured = hasExistingKey(nextConfig, choice);
  const envAvailable = hasKeyInEnv(entry);

  if (opts?.quickstartDefaults && (keyConfigured || envAvailable)) {
    const result = existingKey
      ? applySearchKey(nextConfig, choice, existingKey)
      : applyProviderOnly(nextConfig, choice);
    return preserveDisabledState(nextConfig, result);
  }

  const useSecretRefMode = opts?.secretInputMode === "ref"; // pragma: allowlist secret
  if (useSecretRefMode) {
    if (keyConfigured) {
      return preserveDisabledState(nextConfig, applyProviderOnly(nextConfig, choice));
    }
    const ref = buildSearchEnvRef(choice);
    await prompter.note(
      [
        "Secret references enabled — OpenClaw will store a reference instead of the API key.",
        `Env var: ${ref.id}${envAvailable ? " (detected)" : ""}.`,
        ...(envAvailable ? [] : [`Set ${ref.id} in the Gateway environment.`]),
        "Docs: https://docs.openclaw.ai/tools/web",
      ].join("\n"),
      "Web search",
    );
    return applySearchKey(nextConfig, choice, ref);
  }

  const keyInput = await prompter.text({
    message: keyConfigured
      ? `${entry.label} API key (leave blank to keep current)`
      : envAvailable
        ? `${entry.label} API key (leave blank to use env var)`
        : `${entry.label} API key`,
    placeholder: keyConfigured ? "Leave blank to keep current" : entry.placeholder,
  });

  const key = keyInput?.trim() ?? "";
  if (key) {
    const secretInput = resolveSearchSecretInput(choice, key, opts?.secretInputMode);
    return applySearchKey(nextConfig, choice, secretInput);
  }

  if (existingKey) {
    return preserveDisabledState(nextConfig, applySearchKey(nextConfig, choice, existingKey));
  }

  if (keyConfigured || envAvailable) {
    return preserveDisabledState(nextConfig, applyProviderOnly(nextConfig, choice));
  }

  await prompter.note(
    [
      "No API key stored — web_search won't work until a key is available.",
      `Get your key at: ${entry.signupUrl}`,
      "Docs: https://docs.openclaw.ai/tools/web",
    ].join("\n"),
    "Web search",
  );

  return {
    ...nextConfig,
    tools: {
      ...nextConfig.tools,
      web: {
        ...nextConfig.tools?.web,
        search: {
          ...nextConfig.tools?.web?.search,
          provider: choice,
        },
      },
    },
  };
}
