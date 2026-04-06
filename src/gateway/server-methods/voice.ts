import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentDir } from "openclaw/plugin-sdk/agent-runtime";
import { transcribeAudioFile } from "openclaw/plugin-sdk/media-understanding-runtime";
import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/temp-path";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateVoiceTranscribeParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const PCM16_BYTES_PER_SAMPLE = 2;
const WAV_BIT_DEPTH = 16;

function buildPcm16WavBuffer(params: {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
}): Buffer {
  const blockAlign = params.channels * PCM16_BYTES_PER_SAMPLE;
  const byteRate = params.sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + params.pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(params.channels, 22);
  header.writeUInt32LE(params.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(WAV_BIT_DEPTH, 34);
  header.write("data", 36);
  header.writeUInt32LE(params.pcm.length, 40);
  return Buffer.concat([header, params.pcm]);
}

function computeDurationMs(params: {
  pcmBytes: number;
  sampleRate: number;
  channels: number;
}): number {
  const bytesPerSecond = params.sampleRate * params.channels * PCM16_BYTES_PER_SAMPLE;
  if (bytesPerSecond <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((params.pcmBytes / bytesPerSecond) * 1000));
}

export const voiceHandlers: GatewayRequestHandlers = {
  "voice.transcribe": async ({ params, respond }) => {
    if (!validateVoiceTranscribeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid voice.transcribe params: ${formatValidationErrors(validateVoiceTranscribeParams.errors)}`,
        ),
      );
      return;
    }

    const typedParams = params;
    const pcm = Buffer.from(typedParams.audioBase64, "base64");
    if (pcm.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "voice.transcribe requires audio"),
      );
      return;
    }

    const cfg = loadConfig();
    const agentId = resolveDefaultAgentId(cfg);
    const tmpDir = await fs.mkdtemp(
      path.join(resolvePreferredOpenClawTmpDir(), "voice-transcribe-"),
    );
    const filePath = path.join(tmpDir, "turn.wav");
    const durationMs = computeDurationMs({
      pcmBytes: pcm.length,
      sampleRate: typedParams.sampleRate,
      channels: typedParams.channels,
    });

    try {
      const wav = buildPcm16WavBuffer({
        pcm,
        sampleRate: typedParams.sampleRate,
        channels: typedParams.channels,
      });
      await fs.writeFile(filePath, wav);
      const result = await transcribeAudioFile({
        filePath,
        cfg,
        agentDir: resolveAgentDir(cfg, agentId),
        mime: "audio/wav",
      });
      const transcript = result.text?.trim();
      if (!transcript) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "voice.transcribe returned no transcript"),
        );
        return;
      }
      respond(
        true,
        {
          transcript,
          durationMs,
        },
        undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `voice.transcribe failed: ${message}`),
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  },
};
