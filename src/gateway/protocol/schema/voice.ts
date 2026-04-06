import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const VoiceTranscribeAudioFormatSchema = Type.Union([Type.Literal("pcm16")]);

export const VoiceTranscribeParamsSchema = Type.Object(
  {
    audioBase64: NonEmptyString,
    sampleRate: Type.Integer({ minimum: 1 }),
    channels: Type.Integer({ minimum: 1 }),
    format: Type.Optional(VoiceTranscribeAudioFormatSchema),
  },
  { additionalProperties: false },
);

export const VoiceTranscribeResultSchema = Type.Object(
  {
    transcript: NonEmptyString,
    durationMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
