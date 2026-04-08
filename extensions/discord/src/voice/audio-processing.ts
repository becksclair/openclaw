import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Readable } from "node:stream";
import { resolveAgentDir } from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { logVerbose, shouldLogVerbose } from "openclaw/plugin-sdk/runtime-env";
import { formatErrorMessage } from "openclaw/plugin-sdk/ssrf-runtime";
import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/temp-path";
import { getDiscordRuntime } from "../runtime.js";

const require = createRequire(import.meta.url);

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BIT_DEPTH = 16;

export const DISCORD_VOICE_SAMPLE_RATE = SAMPLE_RATE;
export const DISCORD_VOICE_CHANNELS = CHANNELS;

type OpusDecoder = {
  decode: (buffer: Buffer) => Buffer;
};

let warnedOpusMissing = false;

function buildWavBuffer(params: { pcm: Buffer; sampleRate: number; channels: number }): Buffer {
  const blockAlign = (params.channels * BIT_DEPTH) / 8;
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
  header.writeUInt16LE(BIT_DEPTH, 34);
  header.write("data", 36);
  header.writeUInt32LE(params.pcm.length, 40);
  return Buffer.concat([header, params.pcm]);
}

function createOpusDecoder(logger: {
  warn(message: string): void;
}): { decoder: OpusDecoder; name: string } | null {
  try {
    const OpusScript = require("opusscript") as {
      new (sampleRate: number, channels: number, application: number): OpusDecoder;
      Application: { AUDIO: number };
    };
    const decoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
    return { decoder, name: "opusscript" };
  } catch (err) {
    if (!warnedOpusMissing) {
      warnedOpusMissing = true;
      logger.warn(
        `discord voice: opusscript unavailable (${formatErrorMessage(err)}); cannot decode voice audio`,
      );
    }
  }
  return null;
}

export async function decodeDiscordOpusStream(params: {
  stream: Readable;
  logger: { warn(message: string): void };
  logVerbose: (message: string) => void;
}): Promise<Buffer> {
  const selected = createOpusDecoder(params.logger);
  if (!selected) {
    return Buffer.alloc(0);
  }
  params.logVerbose(`opus decoder: ${selected.name}`);
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of params.stream) {
      if (!chunk || !(chunk instanceof Buffer) || chunk.length === 0) {
        continue;
      }
      const decoded = selected.decoder.decode(chunk);
      if (decoded && decoded.length > 0) {
        chunks.push(Buffer.from(decoded));
      }
    }
  } catch (err) {
    if (shouldLogVerbose()) {
      logVerbose(`discord voice: opus decode failed: ${formatErrorMessage(err)}`);
    }
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
}

export async function writeDiscordVoiceWavFile(
  pcm: Buffer,
): Promise<{ path: string; durationSeconds: number }> {
  return await writeDiscordVoicePcmWavFile({
    pcm,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
  });
}

export async function writeDiscordVoicePcmWavFile(params: {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
}): Promise<{ path: string; durationSeconds: number }> {
  const tempDir = await fs.mkdtemp(path.join(resolvePreferredOpenClawTmpDir(), "discord-voice-"));
  const filePath = path.join(tempDir, `segment-${randomUUID()}.wav`);
  const wav = buildWavBuffer(params);
  await fs.writeFile(filePath, wav);
  scheduleDiscordVoiceTempCleanup(tempDir);
  return {
    path: filePath,
    durationSeconds:
      params.pcm.length / (((BIT_DEPTH / 8) * params.channels || 1) * params.sampleRate),
  };
}

function scheduleDiscordVoiceTempCleanup(tempDir: string, delayMs: number = 30 * 60 * 1000): void {
  const timer = setTimeout(() => {
    fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
      if (shouldLogVerbose()) {
        logVerbose(`discord voice: temp cleanup failed for ${tempDir}: ${formatErrorMessage(err)}`);
      }
    });
  }, delayMs);
  timer.unref();
}

export async function transcribeDiscordVoiceAudio(params: {
  cfg: OpenClawConfig;
  agentId: string;
  filePath: string;
}): Promise<string | undefined> {
  const result = await getDiscordRuntime().mediaUnderstanding.transcribeAudioFile({
    filePath: params.filePath,
    cfg: params.cfg,
    agentDir: resolveAgentDir(params.cfg, params.agentId),
    mime: "audio/wav",
  });
  return result.text?.trim() || undefined;
}
