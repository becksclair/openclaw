import { stripMarkdownForSpeech } from "./strip-markdown-for-speech.ts";

export type SpeechGatewayClient = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
};

type TalkSpeakResult = {
  audioBase64: string;
  mimeType?: string;
  fileExtension?: string;
  outputFormat?: string;
};

type BrowserAudioContext = AudioContext;
type BrowserAudioContextCtor = typeof AudioContext;

let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let currentAudioContext: BrowserAudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let speechGeneration = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getAudioContextCtor(): BrowserAudioContextCtor | null {
  const global = globalThis as Record<string, unknown>;
  return (global.AudioContext ??
    global.webkitAudioContext ??
    null) as BrowserAudioContextCtor | null;
}

export function isTtsSupported(): boolean {
  return (
    typeof atob === "function" &&
    (getAudioContextCtor() !== null ||
      (typeof Audio !== "undefined" &&
        typeof Blob !== "undefined" &&
        typeof URL !== "undefined" &&
        typeof URL.createObjectURL === "function"))
  );
}

function isCurrentSpeechGeneration(generation: number): boolean {
  return generation === speechGeneration;
}

function clearCurrentAudio(): void {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {}
    currentSource.disconnect();
    currentSource = null;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio.load();
    currentAudio = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
}

function decodeBase64Audio(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

async function prepareAudioContext(): Promise<BrowserAudioContext | null> {
  const Ctor = getAudioContextCtor();
  if (!Ctor) {
    return null;
  }
  const context = currentAudioContext ?? new Ctor();
  currentAudioContext = context;
  if (context.state === "suspended") {
    await context.resume();
  }
  return context;
}

function inferAudioMimeType(result: TalkSpeakResult): string {
  const mimeType = result.mimeType?.trim();
  if (mimeType) {
    return mimeType;
  }
  const extension = result.fileExtension?.trim().toLowerCase();
  if (extension === ".wav") {
    return "audio/wav";
  }
  if (extension === ".webm") {
    return "audio/webm";
  }
  if (extension === ".ogg" || extension === ".opus") {
    return "audio/ogg";
  }
  const outputFormat = result.outputFormat?.trim().toLowerCase() ?? "";
  if (outputFormat === "opus" || outputFormat.startsWith("opus_")) {
    return "audio/ogg";
  }
  return "audio/mpeg";
}

function parseTalkSpeakResult(value: unknown): TalkSpeakResult | null {
  if (!isRecord(value) || typeof value.audioBase64 !== "string" || !value.audioBase64.trim()) {
    return null;
  }
  return {
    audioBase64: value.audioBase64,
    ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}),
    ...(typeof value.fileExtension === "string" ? { fileExtension: value.fileExtension } : {}),
    ...(typeof value.outputFormat === "string" ? { outputFormat: value.outputFormat } : {}),
  };
}

export async function speakText(
  text: string,
  client: SpeechGatewayClient,
  opts?: {
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (error: string) => void;
  },
): Promise<boolean> {
  if (!isTtsSupported()) {
    opts?.onError?.("Audio playback is not supported in this browser");
    return false;
  }

  stopTts();
  const cleaned = stripMarkdownForSpeech(text);
  if (!cleaned.trim()) {
    return false;
  }
  const generation = speechGeneration;

  let preparedContext: BrowserAudioContext | null = null;
  try {
    preparedContext = await prepareAudioContext();
  } catch {
    // Fall back to element playback below.
  }
  if (!isCurrentSpeechGeneration(generation)) {
    return false;
  }

  let resultPayload: unknown;
  try {
    resultPayload = await client.request("talk.speak", { text: cleaned });
  } catch (error) {
    if (!isCurrentSpeechGeneration(generation)) {
      return false;
    }
    opts?.onError?.(error instanceof Error ? error.message : String(error));
    return false;
  }
  if (!isCurrentSpeechGeneration(generation)) {
    return false;
  }

  const result = parseTalkSpeakResult(resultPayload);
  if (!result) {
    opts?.onError?.("Talk returned no audio");
    return false;
  }

  try {
    const arrayBuffer = decodeBase64Audio(result.audioBase64);

    if (preparedContext) {
      try {
        const decoded = await preparedContext.decodeAudioData(arrayBuffer.slice(0));
        if (!isCurrentSpeechGeneration(generation)) {
          return false;
        }
        const source = preparedContext.createBufferSource();
        source.buffer = decoded;
        source.connect(preparedContext.destination);
        currentSource = source;
        source.addEventListener("ended", () => {
          if (!isCurrentSpeechGeneration(generation)) {
            return;
          }
          if (currentSource === source) {
            clearCurrentAudio();
          }
          opts?.onEnd?.();
        });
        if (!isCurrentSpeechGeneration(generation)) {
          return false;
        }
        source.start();
        opts?.onStart?.();
        return true;
      } catch {
        if (!isCurrentSpeechGeneration(generation)) {
          return false;
        }
      }
    }

    if (!isCurrentSpeechGeneration(generation)) {
      return false;
    }

    const blob = new Blob([arrayBuffer], { type: inferAudioMimeType(result) });
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);

    currentAudio = audio;
    currentAudioUrl = audioUrl;
    audio.addEventListener("ended", () => {
      if (!isCurrentSpeechGeneration(generation)) {
        return;
      }
      if (currentAudio === audio) {
        clearCurrentAudio();
      }
      opts?.onEnd?.();
    });
    audio.addEventListener("error", () => {
      if (!isCurrentSpeechGeneration(generation)) {
        return;
      }
      if (currentAudio === audio) {
        clearCurrentAudio();
      }
      opts?.onError?.("Audio playback failed");
    });

    await audio.play();
    if (!isCurrentSpeechGeneration(generation)) {
      clearCurrentAudio();
      return false;
    }
    opts?.onStart?.();
    return true;
  } catch (error) {
    if (!isCurrentSpeechGeneration(generation)) {
      return false;
    }
    clearCurrentAudio();
    opts?.onError?.(error instanceof Error ? error.message : String(error));
    return false;
  }
}

export function stopTts(): void {
  speechGeneration += 1;
  clearCurrentAudio();
}
