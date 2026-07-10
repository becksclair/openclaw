import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import {
  isVoiceCompatibleAudio,
  transcodeAudioBufferToOpus,
} from "openclaw/plugin-sdk/media-runtime";

function resolveTelegramVoiceDecision(opts: {
  wantsVoice: boolean;
  contentType?: string | null;
  fileName?: string | null;
}): { useVoice: boolean; reason?: string } {
  if (!opts.wantsVoice) {
    return { useVoice: false };
  }
  if (isVoiceCompatibleAudio(opts)) {
    return { useVoice: true };
  }
  const contentType = opts.contentType ?? "unknown";
  const fileName = opts.fileName ?? "unknown";
  return {
    useVoice: false,
    reason: `media is ${contentType} (${fileName})`,
  };
}

export function resolveTelegramVoiceSend(opts: {
  wantsVoice: boolean;
  contentType?: string | null;
  fileName?: string | null;
  logFallback?: (message: string) => void;
}): { useVoice: boolean } {
  const decision = resolveTelegramVoiceDecision(opts);
  if (decision.reason && opts.logFallback) {
    opts.logFallback(
      `Telegram voice requested but ${decision.reason}; sending as audio file instead.`,
    );
  }
  return { useVoice: decision.useVoice };
}

export async function prepareTelegramVoiceMedia(opts: {
  wantsVoice: boolean;
  buffer: Buffer;
  contentType?: string | null;
  fileName?: string | null;
  logFallback?: (message: string) => void;
}): Promise<{
  useVoice: boolean;
  buffer: Buffer;
  contentType?: string | null;
  fileName?: string | null;
}> {
  const decision = resolveTelegramVoiceDecision(opts);
  if (!decision.reason) {
    return {
      useVoice: decision.useVoice,
      buffer: opts.buffer,
      contentType: opts.contentType,
      fileName: opts.fileName,
    };
  }
  try {
    const buffer = await transcodeAudioBufferToOpus({
      audioBuffer: opts.buffer,
      inputFileName: opts.fileName ?? undefined,
      outputFileName: "voice.ogg",
      tempPrefix: "telegram-voice-",
    });
    return {
      useVoice: true,
      buffer,
      contentType: "audio/ogg",
      fileName: "voice.ogg",
    };
  } catch (err) {
    opts.logFallback?.(
      `Telegram voice requested but ${decision.reason} and transcoding failed: ${formatErrorMessage(
        err,
      )}; sending as audio file instead.`,
    );
    return {
      useVoice: false,
      buffer: opts.buffer,
      contentType: opts.contentType,
      fileName: opts.fileName,
    };
  }
}
