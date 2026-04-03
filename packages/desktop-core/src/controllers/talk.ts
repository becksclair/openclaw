import type { GatewayBrowserClient, GatewayEventFrame } from "../gateway.ts";

export type DesktopTalkConfig = {
  interruptOnSpeech: boolean | null;
  mainSessionKey: string | null;
  modelId: string | null;
  outputFormat: string | null;
  provider: string | null;
  silenceTimeoutMs: number | null;
  voiceId: string | null;
};

export type DesktopTalkSpeakResult = {
  audioBase64: string;
  fileExtension: string | null;
  mimeType: string | null;
  outputFormat: string | null;
  provider: string | null;
  voiceCompatible: boolean | null;
};

export type DesktopTalkModeEvent = {
  enabled: boolean;
  phase: string | null;
  ts: number | null;
};

export type DesktopTalkTranscriptionResult = {
  model: string | null;
  provider: string | null;
  text: string;
};

type TalkConfigPayload = {
  config?: {
    session?: { mainKey?: string };
    talk?: {
      interruptOnSpeech?: boolean;
      modelId?: string;
      outputFormat?: string;
      provider?: string;
      resolved?: {
        provider?: string;
        config?: {
          modelId?: string;
          outputFormat?: string;
          voiceId?: string;
        };
      };
      silenceTimeoutMs?: number;
      voiceId?: string;
    };
  };
};

type TalkSpeakPayload = {
  audioBase64?: string;
  fileExtension?: string;
  mimeType?: string;
  outputFormat?: string;
  provider?: string;
  voiceCompatible?: boolean;
};

type TalkTranscribePayload = {
  model?: string;
  provider?: string;
  text?: string;
};

function trimString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function loadDesktopTalkConfig(
  client: GatewayBrowserClient,
): Promise<DesktopTalkConfig> {
  const result = await client.request<TalkConfigPayload>("talk.config", {});
  const talk = result.config?.talk;
  return {
    interruptOnSpeech: typeof talk?.interruptOnSpeech === "boolean" ? talk.interruptOnSpeech : null,
    mainSessionKey: trimString(result.config?.session?.mainKey),
    modelId: trimString(talk?.resolved?.config?.modelId) ?? trimString(talk?.modelId),
    outputFormat:
      trimString(talk?.resolved?.config?.outputFormat) ?? trimString(talk?.outputFormat),
    provider: trimString(talk?.resolved?.provider) ?? trimString(talk?.provider),
    silenceTimeoutMs: typeof talk?.silenceTimeoutMs === "number" ? talk.silenceTimeoutMs : null,
    voiceId: trimString(talk?.resolved?.config?.voiceId) ?? trimString(talk?.voiceId),
  };
}

export async function speakDesktopTalkText(
  client: GatewayBrowserClient,
  params: { text: string },
): Promise<DesktopTalkSpeakResult> {
  const result = await client.request<TalkSpeakPayload>("talk.speak", {
    text: params.text,
  });
  return {
    audioBase64: trimString(result.audioBase64) ?? "",
    fileExtension: trimString(result.fileExtension),
    mimeType: trimString(result.mimeType),
    outputFormat: trimString(result.outputFormat),
    provider: trimString(result.provider),
    voiceCompatible: typeof result.voiceCompatible === "boolean" ? result.voiceCompatible : null,
  };
}

export async function transcribeDesktopTalkAudio(
  client: GatewayBrowserClient,
  params: { audioBase64: string; fileName?: string; mimeType?: string },
): Promise<DesktopTalkTranscriptionResult> {
  const fileName = trimString(params.fileName);
  const mimeType = trimString(params.mimeType);
  const result = await client.request<TalkTranscribePayload>("talk.transcribe", {
    audioBase64: params.audioBase64,
    ...(fileName ? { fileName } : {}),
    ...(mimeType ? { mimeType } : {}),
  });
  const text = trimString(result.text);
  if (!text) {
    throw new Error("talk.transcribe returned no text");
  }
  return {
    model: trimString(result.model),
    provider: trimString(result.provider),
    text,
  };
}

export async function publishDesktopTalkMode(
  client: GatewayBrowserClient,
  params: { enabled: boolean; phase?: string | null },
): Promise<DesktopTalkModeEvent> {
  const result = await client.request<DesktopTalkModeEvent>("talk.mode", {
    enabled: params.enabled,
    phase: trimString(params.phase) ?? undefined,
  });
  return {
    enabled: Boolean(result.enabled),
    phase: trimString(result.phase),
    ts: typeof result.ts === "number" ? result.ts : null,
  };
}

export function readDesktopTalkModeEvent(
  event: GatewayEventFrame | null,
): DesktopTalkModeEvent | null {
  if (
    !event ||
    event.event !== "talk.mode" ||
    !event.payload ||
    typeof event.payload !== "object"
  ) {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  return {
    enabled: Boolean(payload.enabled),
    phase: trimString(payload.phase),
    ts: typeof payload.ts === "number" ? payload.ts : null,
  };
}
