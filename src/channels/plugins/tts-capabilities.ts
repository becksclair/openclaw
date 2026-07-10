import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import { loadBundledPluginPublicArtifactModuleSync } from "../../plugins/public-surface-loader.js";
import { normalizeAnyChannelId } from "../registry.js";
import { getLoadedChannelPluginById } from "./registry-loaded.js";
import type { ChannelTtsVoiceDeliveryCapabilities } from "./types.core.js";

type ChannelTtsCapabilitiesApi = {
  channelTtsVoiceDelivery?: ChannelTtsVoiceDeliveryCapabilities;
};

type LoadedChannelTtsCapabilities = {
  capabilities?: {
    tts?: {
      voice?: ChannelTtsVoiceDeliveryCapabilities;
    };
  } | null;
};

const TTS_CAPABILITIES_API_ARTIFACT_BASENAME = "tts-capabilities-api.js";
const MISSING_PUBLIC_SURFACE_PREFIX = "Unable to resolve bundled plugin public surface ";

function normalizeChannelArtifactDirName(channel: string | undefined): string | undefined {
  const channelId = normalizeLowercaseStringOrEmpty(channel);
  return channelId &&
    channelId !== "." &&
    channelId !== ".." &&
    !channelId.includes("/") &&
    !channelId.includes("\\") &&
    !channelId.includes(":")
    ? channelId
    : undefined;
}

function loadBundledChannelTtsCapabilitiesApi(
  channelId: string,
): ChannelTtsCapabilitiesApi | undefined {
  try {
    return loadBundledPluginPublicArtifactModuleSync<ChannelTtsCapabilitiesApi>({
      dirName: channelId,
      artifactBasename: TTS_CAPABILITIES_API_ARTIFACT_BASENAME,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(MISSING_PUBLIC_SURFACE_PREFIX)) {
      return undefined;
    }
    throw error;
  }
}

export function resolveChannelTtsVoiceDelivery(
  channel: string | undefined,
): ChannelTtsVoiceDeliveryCapabilities | undefined {
  const loadedChannelId = normalizeAnyChannelId(channel);
  const artifactChannelId = loadedChannelId ?? normalizeChannelArtifactDirName(channel);
  if (!artifactChannelId) {
    return undefined;
  }
  const loadedChannelPlugin = loadedChannelId
    ? (getLoadedChannelPluginById(loadedChannelId) as LoadedChannelTtsCapabilities | undefined)
    : undefined;
  return (
    loadedChannelPlugin?.capabilities?.tts?.voice ??
    loadBundledChannelTtsCapabilitiesApi(artifactChannelId)?.channelTtsVoiceDelivery
  );
}
