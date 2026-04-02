/**
 * Browser-native speech services: STT via SpeechRecognition.
 * Chat read-aloud uses gateway Talk TTS and browser audio playback.
 */

// ─── STT (Speech-to-Text) ───

type SpeechRecognitionEvent = Event & {
  results: SpeechRecognitionResultList;
  resultIndex: number;
};

type SpeechRecognitionErrorEvent = Event & {
  error: string;
  message?: string;
};

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = globalThis as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as SpeechRecognitionCtor | null;
}

export function isSttSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export type SttCallbacks = {
  onTranscript: (text: string, isFinal: boolean) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
};

let activeRecognition: SpeechRecognitionInstance | null = null;

export function startStt(callbacks: SttCallbacks): boolean {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    callbacks.onError?.("Speech recognition is not supported in this browser");
    return false;
  }

  stopStt();

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";

  recognition.addEventListener("start", () => callbacks.onStart?.());

  recognition.addEventListener("result", (event) => {
    const speechEvent = event as unknown as SpeechRecognitionEvent;
    let interimTranscript = "";
    let finalTranscript = "";

    for (let i = speechEvent.resultIndex; i < speechEvent.results.length; i++) {
      const result = speechEvent.results[i];
      if (!result?.[0]) {
        continue;
      }
      const transcript = result[0].transcript;
      if (result.isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (finalTranscript) {
      callbacks.onTranscript(finalTranscript, true);
    } else if (interimTranscript) {
      callbacks.onTranscript(interimTranscript, false);
    }
  });

  recognition.addEventListener("error", (event) => {
    const speechEvent = event as unknown as SpeechRecognitionErrorEvent;
    if (speechEvent.error === "aborted" || speechEvent.error === "no-speech") {
      return;
    }
    callbacks.onError?.(speechEvent.error);
  });

  recognition.addEventListener("end", () => {
    if (activeRecognition === recognition) {
      activeRecognition = null;
    }
    callbacks.onEnd?.();
  });

  activeRecognition = recognition;
  recognition.start();
  return true;
}

export function stopStt(): void {
  if (activeRecognition) {
    const r = activeRecognition;
    activeRecognition = null;
    try {
      r.stop();
    } catch {
      // already stopped
    }
  }
}

export function isSttActive(): boolean {
  return activeRecognition !== null;
}

// ─── TTS (Text-to-Speech) ───

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

function getAudioContextCtor(): BrowserAudioContextCtor | null {
  const w = globalThis as Record<string, unknown>;
  return (w.AudioContext ?? w.webkitAudioContext ?? null) as BrowserAudioContextCtor | null;
}

export function isTtsSupported(): boolean {
  return (
    getAudioContextCtor() !== null ||
    (typeof Audio !== "undefined" && typeof URL?.createObjectURL === "function")
  );
}

let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let currentAudioContext: BrowserAudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

function clearCurrentAudio() {
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
  for (let i = 0; i < binary.length; i++) {
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
  if (outputFormat === "mp3" || outputFormat.startsWith("mp3_")) {
    return "audio/mpeg";
  }
  if (outputFormat === "opus" || outputFormat.startsWith("opus_")) {
    return "audio/ogg";
  }
  return "audio/mpeg";
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

  const cleaned = stripMarkdown(text);
  if (!cleaned.trim()) {
    return false;
  }

  let preparedContext: BrowserAudioContext | null = null;
  try {
    preparedContext = await prepareAudioContext();
  } catch {
    preparedContext = null;
  }

  let result: TalkSpeakResult;
  try {
    result = await client.request<TalkSpeakResult>("talk.speak", { text: cleaned });
  } catch (error) {
    opts?.onError?.(error instanceof Error ? error.message : String(error));
    return false;
  }

  if (!result.audioBase64?.trim()) {
    opts?.onError?.("Talk returned no audio");
    return false;
  }

  try {
    const arrayBuffer = decodeBase64Audio(result.audioBase64);

    if (preparedContext) {
      const decoded = await preparedContext.decodeAudioData(arrayBuffer.slice(0));
      const source = preparedContext.createBufferSource();
      source.buffer = decoded;
      source.connect(preparedContext.destination);
      currentSource = source;
      source.addEventListener("ended", () => {
        if (currentSource === source) {
          clearCurrentAudio();
        }
        opts?.onEnd?.();
      });
      source.start();
      opts?.onStart?.();
      return true;
    }

    const blob = new Blob([arrayBuffer], {
      type: inferAudioMimeType(result),
    });
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    currentAudio = audio;
    currentAudioUrl = audioUrl;

    audio.addEventListener("ended", () => {
      if (currentAudio === audio) {
        clearCurrentAudio();
      }
      opts?.onEnd?.();
    });
    audio.addEventListener("error", () => {
      if (currentAudio === audio) {
        clearCurrentAudio();
      }
      opts?.onError?.("Audio playback failed");
    });

    await audio.play();
    opts?.onStart?.();
    return true;
  } catch (error) {
    clearCurrentAudio();
    opts?.onError?.(error instanceof Error ? error.message : String(error));
    return false;
  }
}

export function stopTts(): void {
  clearCurrentAudio();
}

export function isTtsSpeaking(): boolean {
  return (
    currentSource !== null || (currentAudio !== null && !currentAudio.paused && !currentAudio.ended)
  );
}

/** Strip common markdown syntax for cleaner speech output. */
function stripMarkdown(text: string): string {
  return (
    text
      // code blocks
      .replace(/```[\s\S]*?```/g, "")
      // inline code
      .replace(/`[^`]+`/g, "")
      // images
      .replace(/!\[.*?\]\(.*?\)/g, "")
      // links → keep text
      .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
      // headings
      .replace(/^#{1,6}\s+/gm, "")
      // bold/italic
      .replace(/\*{1,3}(.*?)\*{1,3}/g, "$1")
      .replace(/_{1,3}(.*?)_{1,3}/g, "$1")
      // blockquotes
      .replace(/^>\s?/gm, "")
      // horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // list markers
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      // HTML tags
      .replace(/<[^>]+>/g, "")
      // collapse whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
