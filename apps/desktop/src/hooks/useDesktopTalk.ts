import {
  loadDesktopTalkConfig,
  publishDesktopTalkMode,
  readDesktopTalkModeEvent,
  speakDesktopTalkText,
  transcribeDesktopTalkAudio,
  type DesktopTalkConfig,
  type DesktopTalkModeEvent,
} from "@openclaw/desktop-core/controllers/talk";
import type { GatewayBrowserClient, GatewayEventFrame } from "@openclaw/desktop-core/gateway";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDesktopTalkFixtureAudio } from "../desktop/talk.ts";
import { isTauriRuntime } from "../desktop/tauri.ts";

type PlaybackState = "error" | "idle" | "speaking" | "synthesizing";
type SpeakSource = "assistant-reply" | "test" | "user";
type TranscriptionSource = "file" | "fixture";

type DesktopTalkState = {
  config: DesktopTalkConfig | null;
  configLoading: boolean;
  lastError: string | null;
  lastRemoteMode: DesktopTalkModeEvent | null;
  lastSpokenText: string | null;
  lastTranscript: string | null;
  playbackState: PlaybackState;
  statusMessage: string;
  transcribing: boolean;
  transcriptionModel: string | null;
  transcriptionProvider: string | null;
  transcriptionStatusMessage: string;
};

const INITIAL_STATE: DesktopTalkState = {
  config: null,
  configLoading: false,
  lastError: null,
  lastRemoteMode: null,
  lastSpokenText: null,
  lastTranscript: null,
  playbackState: "idle",
  statusMessage: "Connect to the gateway to bootstrap Talk.",
  transcribing: false,
  transcriptionModel: null,
  transcriptionProvider: null,
  transcriptionStatusMessage: "Choose an audio clip or use the fixture to test transcription.",
};

function trimText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function decodeAudioBlob(audioBase64: string, mimeType: string | null): Blob {
  const decoded = atob(audioBase64);
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType ?? "audio/mpeg" });
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function useDesktopTalk(params: {
  client: GatewayBrowserClient | null;
  connected: boolean;
  lastEvent: GatewayEventFrame | null;
  messages: Array<{ content: string; role: string; timestamp?: number }>;
  talkEnabled: boolean;
}) {
  const [state, setState] = useState<DesktopTalkState>(INITIAL_STATE);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
  const endedListenerRef = useRef<(() => void) | null>(null);
  const errorListenerRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);
  const latestSeenAssistantKeyRef = useRef<string | null>(null);
  const autoSpeakInitializedRef = useRef(false);

  const clearObjectUrl = useCallback(() => {
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }
  }, []);

  const detachAudioListeners = useCallback((audio: HTMLAudioElement | null) => {
    if (!audio) {
      return;
    }
    if (endedListenerRef.current) {
      audio.removeEventListener("ended", endedListenerRef.current);
      endedListenerRef.current = null;
    }
    if (errorListenerRef.current) {
      audio.removeEventListener("error", errorListenerRef.current);
      errorListenerRef.current = null;
    }
  }, []);

  const publishModeBestEffort = useCallback(
    async (enabled: boolean, phase: string) => {
      if (!params.client || !params.connected) {
        return;
      }
      try {
        await publishDesktopTalkMode(params.client, { enabled, phase });
      } catch {
        // best-effort telemetry only
      }
    },
    [params.client, params.connected],
  );

  const stop = useCallback(
    async (options?: { publishMode?: boolean; statusMessage?: string }) => {
      generationRef.current += 1;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        detachAudioListeners(audio);
        audio.removeAttribute("src");
      }
      clearObjectUrl();
      setState((current) => ({
        ...current,
        playbackState: "idle",
        statusMessage: options?.statusMessage ?? "Talk idle.",
      }));
      if (options?.publishMode !== false) {
        await publishModeBestEffort(false, "idle");
      }
    },
    [clearObjectUrl, detachAudioListeners, publishModeBestEffort],
  );

  const refreshConfig = useCallback(async () => {
    if (!params.client || !params.connected) {
      setState((current) => ({
        ...current,
        config: null,
        configLoading: false,
        lastError: null,
        statusMessage: "Connect to the gateway to bootstrap Talk.",
      }));
      return;
    }

    setState((current) => ({
      ...current,
      configLoading: true,
      lastError: null,
      statusMessage:
        current.playbackState === "speaking" ? current.statusMessage : "Loading Talk config…",
    }));

    try {
      const config = await loadDesktopTalkConfig(params.client);
      setState((current) => ({
        ...current,
        config,
        configLoading: false,
        lastError: null,
        statusMessage: config.provider
          ? `Talk ready via ${config.provider}.`
          : "Talk config readable, but no provider is configured yet.",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((current) => ({
        ...current,
        config: null,
        configLoading: false,
        lastError: message,
        playbackState: current.playbackState === "speaking" ? current.playbackState : "error",
        statusMessage: `Talk config failed: ${message}`,
      }));
    }
  }, [params.client, params.connected]);

  const speakText = useCallback(
    async (text: string, source: SpeakSource = "user") => {
      const cleaned = trimText(text);
      if (!cleaned) {
        return false;
      }
      if (typeof Audio === "undefined") {
        setState((current) => ({
          ...current,
          lastError: "Audio playback is unavailable in this runtime.",
          playbackState: "error",
          statusMessage: "Desktop Talk needs browser audio playback support.",
        }));
        return false;
      }
      if (!params.client || !params.connected) {
        setState((current) => ({
          ...current,
          lastError: "Connect to the gateway before using Talk.",
          playbackState: "error",
          statusMessage: "Talk needs a live gateway connection.",
        }));
        return false;
      }

      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.pause();
      detachAudioListeners(audio);
      audio.removeAttribute("src");
      clearObjectUrl();

      setState((current) => ({
        ...current,
        lastError: null,
        playbackState: "synthesizing",
        statusMessage:
          source === "assistant-reply"
            ? "Synthesizing the latest assistant reply…"
            : source === "test"
              ? "Synthesizing a desktop Talk test phrase…"
              : "Synthesizing speech…",
      }));

      await publishModeBestEffort(true, "synthesizing");

      try {
        const result = await speakDesktopTalkText(params.client, { text: cleaned });
        if (generationRef.current !== generation) {
          return false;
        }
        if (!result.audioBase64) {
          throw new Error("Talk returned empty audio.");
        }

        const objectUrl = URL.createObjectURL(decodeAudioBlob(result.audioBase64, result.mimeType));
        activeObjectUrlRef.current = objectUrl;

        const handleEnded = () => {
          if (generationRef.current !== generation) {
            return;
          }
          clearObjectUrl();
          setState((current) => ({
            ...current,
            playbackState: "idle",
            statusMessage: "Finished speaking.",
          }));
          void publishModeBestEffort(false, "idle");
        };
        const handleError = () => {
          if (generationRef.current !== generation) {
            return;
          }
          clearObjectUrl();
          setState((current) => ({
            ...current,
            lastError: "Audio playback failed.",
            playbackState: "error",
            statusMessage: "Desktop Talk could not play the synthesized audio.",
          }));
          void publishModeBestEffort(false, "error");
        };
        endedListenerRef.current = handleEnded;
        errorListenerRef.current = handleError;
        audio.addEventListener("ended", handleEnded);
        audio.addEventListener("error", handleError);
        audio.src = objectUrl;

        setState((current) => ({
          ...current,
          config:
            current.config && !current.config.provider && result.provider
              ? { ...current.config, provider: result.provider }
              : current.config,
          lastSpokenText: cleaned,
          playbackState: "speaking",
          statusMessage: `Speaking via ${result.provider ?? current.config?.provider ?? "Talk"}.`,
        }));

        await publishModeBestEffort(true, "speaking");

        await audio.play();
        return true;
      } catch (error) {
        if (generationRef.current !== generation) {
          return false;
        }
        clearObjectUrl();
        const message = error instanceof Error ? error.message : String(error);
        setState((current) => ({
          ...current,
          lastError: message,
          playbackState: "error",
          statusMessage: `Talk failed: ${message}`,
        }));
        await publishModeBestEffort(false, "error");
        return false;
      }
    },
    [clearObjectUrl, detachAudioListeners, params.client, params.connected, publishModeBestEffort],
  );

  const transcribeAudioBytes = useCallback(
    async (
      audio: { bytes: Uint8Array; fileName: string; mimeType?: string },
      source: TranscriptionSource,
    ) => {
      if (!params.client || !params.connected) {
        setState((current) => ({
          ...current,
          lastError: "Connect to the gateway before transcribing audio.",
          transcriptionStatusMessage: "Transcription needs a live gateway connection.",
        }));
        return false;
      }

      setState((current) => ({
        ...current,
        lastError: null,
        transcribing: true,
        transcriptionModel: null,
        transcriptionProvider: null,
        transcriptionStatusMessage:
          source === "fixture"
            ? "Transcribing the desktop fixture audio…"
            : `Transcribing ${audio.fileName}…`,
      }));

      await publishModeBestEffort(true, "transcribing");

      try {
        const result = await transcribeDesktopTalkAudio(params.client, {
          audioBase64: encodeBytesToBase64(audio.bytes),
          fileName: audio.fileName,
          mimeType: audio.mimeType,
        });
        setState((current) => ({
          ...current,
          lastError: null,
          lastTranscript: result.text,
          transcribing: false,
          transcriptionModel: result.model,
          transcriptionProvider: result.provider,
          transcriptionStatusMessage: `Transcribed via ${result.provider ?? "audio runtime"}.`,
        }));
        await publishModeBestEffort(false, "idle");
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState((current) => ({
          ...current,
          lastError: message,
          transcribing: false,
          transcriptionStatusMessage: `Transcription failed: ${message}`,
        }));
        await publishModeBestEffort(false, "error");
        return false;
      }
    },
    [params.client, params.connected, publishModeBestEffort],
  );

  const lastAssistantReply = useMemo(() => {
    for (let index = params.messages.length - 1; index >= 0; index -= 1) {
      const message = params.messages[index];
      if (message.role === "assistant" && trimText(message.content)) {
        return message;
      }
    }
    return null;
  }, [params.messages]);

  useEffect(() => {
    const remoteMode = readDesktopTalkModeEvent(params.lastEvent);
    if (!remoteMode) {
      return;
    }
    setState((current) => ({
      ...current,
      lastRemoteMode: remoteMode,
    }));
  }, [params.lastEvent]);

  useEffect(() => {
    if (!params.connected || !params.client) {
      autoSpeakInitializedRef.current = false;
      latestSeenAssistantKeyRef.current = null;
      void stop({ publishMode: false, statusMessage: "Talk idle." });
      setState((current) => ({
        ...current,
        config: null,
        configLoading: false,
        lastError: null,
        lastRemoteMode: null,
        lastTranscript: null,
        playbackState: "idle",
        statusMessage: "Connect to the gateway to bootstrap Talk.",
        transcribing: false,
        transcriptionModel: null,
        transcriptionProvider: null,
        transcriptionStatusMessage: "Choose an audio clip or use the fixture to test transcription.",
      }));
      return;
    }
    void refreshConfig();
  }, [params.client, params.connected, refreshConfig, stop]);

  useEffect(() => {
    if (params.talkEnabled) {
      return;
    }
    void stop({ statusMessage: "Talk mode disabled." });
  }, [params.talkEnabled, stop]);

  useEffect(() => {
    const assistantContent = lastAssistantReply?.content ?? null;
    const assistantKey = lastAssistantReply
      ? `${lastAssistantReply.timestamp ?? 0}:${lastAssistantReply.content}`
      : null;
    if (!assistantKey || !assistantContent) {
      return;
    }
    if (!autoSpeakInitializedRef.current) {
      autoSpeakInitializedRef.current = true;
      latestSeenAssistantKeyRef.current = assistantKey;
      return;
    }
    if (assistantKey === latestSeenAssistantKeyRef.current) {
      return;
    }
    latestSeenAssistantKeyRef.current = assistantKey;
    if (!params.talkEnabled) {
      return;
    }
    void speakText(assistantContent, "assistant-reply");
  }, [lastAssistantReply, params.talkEnabled, speakText]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        detachAudioListeners(audio);
        audio.removeAttribute("src");
      }
      clearObjectUrl();
    };
  }, [clearObjectUrl, detachAudioListeners]);

  return {
    ...state,
    canSpeakLatestReply: Boolean(lastAssistantReply),
    canTranscribeFixture: isTauriRuntime(),
    lastAssistantReply,
    refreshConfig,
    speakLastAssistantReply: async () => {
      if (!lastAssistantReply) {
        return false;
      }
      return await speakText(lastAssistantReply.content, "assistant-reply");
    },
    speakTestPhrase: async () =>
      await speakText(
        "OpenClaw desktop Talk bootstrap is alive. The shell can now ask the gateway to synthesize speech and play it locally.",
        "test",
      ),
    speakText: async (text: string) => await speakText(text, "user"),
    stop,
    transcribeFixtureAudio: async () => {
      const fixture = await loadDesktopTalkFixtureAudio();
      if (!fixture) {
        setState((current) => ({
          ...current,
          lastError: "Fixture audio is only available in the Tauri desktop runtime.",
          transcriptionStatusMessage: "Fixture audio is unavailable in this runtime.",
        }));
        return false;
      }
      return await transcribeAudioBytes(fixture, "fixture");
    },
    transcribeFile: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await transcribeAudioBytes(
        {
          bytes,
          fileName: file.name || "audio.wav",
          mimeType: file.type || undefined,
        },
        "file",
      );
    },
  };
}
