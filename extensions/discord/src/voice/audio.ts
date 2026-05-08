import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";
import { logVerbose, shouldLogVerbose } from "openclaw/plugin-sdk/runtime-env";
import { formatErrorMessage } from "openclaw/plugin-sdk/ssrf-runtime";
import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/temp-path";

const require = createRequire(import.meta.url);

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BIT_DEPTH = 16;

type OpusDecoder = {
  decode: (buffer: Buffer) => Buffer;
};

type OpusDecoderFactory = {
  load: () => OpusDecoder;
  name: string;
};

let warnedOpusMissing = false;
let cachedOpusDecoderFactory: OpusDecoderFactory | null | "unresolved" = "unresolved";

function buildWavBuffer(pcm: Buffer): Buffer {
  const blockAlign = (CHANNELS * BIT_DEPTH) / 8;
  const byteRate = SAMPLE_RATE * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BIT_DEPTH, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function resolveOpusDecoderFactory(params: {
  onWarn: (message: string) => void;
}): OpusDecoderFactory | null {
  const factories: OpusDecoderFactory[] = [
    {
      name: "@discordjs/opus",
      load: () => {
        const DiscordOpus = require("@discordjs/opus") as {
          OpusEncoder: new (
            sampleRate: number,
            channels: number,
          ) => {
            decode: (buffer: Buffer) => Buffer;
          };
        };
        return new DiscordOpus.OpusEncoder(SAMPLE_RATE, CHANNELS);
      },
    },
    {
      name: "opusscript",
      load: () => {
        const OpusScript = require("opusscript") as {
          new (sampleRate: number, channels: number, application: number): OpusDecoder;
          Application: { AUDIO: number };
        };
        return new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
      },
    },
  ];

  const failures: string[] = [];
  for (const factory of factories) {
    try {
      factory.load();
      return factory;
    } catch (err) {
      failures.push(`${factory.name}: ${formatErrorMessage(err)}`);
    }
  }

  if (!warnedOpusMissing) {
    warnedOpusMissing = true;
    params.onWarn(
      `discord voice: no usable opus decoder available (${failures.join("; ")}); cannot decode voice audio`,
    );
  }
  return null;
}

function getOrCreateOpusDecoderFactory(params: {
  onWarn: (message: string) => void;
}): OpusDecoderFactory | null {
  if (cachedOpusDecoderFactory !== "unresolved") {
    return cachedOpusDecoderFactory;
  }
  cachedOpusDecoderFactory = resolveOpusDecoderFactory(params);
  return cachedOpusDecoderFactory;
}

function createOpusDecoder(params: {
  onWarn: (message: string) => void;
}): { decoder: OpusDecoder; name: string } | null {
  const factory = getOrCreateOpusDecoderFactory(params);
  if (!factory) {
    return null;
  }
  return { decoder: factory.load(), name: factory.name };
}

export async function decodeOpusStream(
  stream: Readable,
  params: { onVerbose: (message: string) => void; onWarn: (message: string) => void },
): Promise<Buffer> {
  const selected = createOpusDecoder({ onWarn: params.onWarn });
  if (!selected) {
    return Buffer.alloc(0);
  }
  params.onVerbose(`opus decoder: ${selected.name}`);
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) {
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

export async function decodeOpusStreamRealtime(
  stream: Readable,
  params: {
    onPcm24kMono: (pcm: Buffer) => void | Promise<void>;
    onVerbose: (message: string) => void;
    onWarn: (message: string) => void;
  },
): Promise<void> {
  const selected = createOpusDecoder({ onWarn: params.onWarn });
  if (!selected) {
    return;
  }
  params.onVerbose(`opus decoder: ${selected.name}`);
  try {
    for await (const chunk of stream) {
      if (!chunk || !(chunk instanceof Buffer) || chunk.length === 0) {
        continue;
      }
      const decoded = selected.decoder.decode(chunk);
      if (!decoded || decoded.length === 0) {
        continue;
      }
      const pcm24kMono = convertDiscordPcmToRealtimeInput(decoded);
      if (pcm24kMono.length > 0) {
        await params.onPcm24kMono(pcm24kMono);
      }
    }
  } catch (err) {
    if (shouldLogVerbose()) {
      logVerbose(`discord voice: opus realtime decode failed: ${formatErrorMessage(err)}`);
    }
  }
}

export function convertDiscordPcmToRealtimeInput(pcm48kStereo: Buffer): Buffer {
  return downmixStereo48kPcm16ToMono24k(pcm48kStereo);
}

export function convertRealtimeOutputToDiscordPcm(pcm24kMono: Buffer): Buffer {
  return upsampleMono24kPcm16ToStereo48k(pcm24kMono);
}

export function createDiscordRawPcmStream(): PassThrough {
  return new PassThrough({ highWaterMark: SAMPLE_RATE * CHANNELS * 2 });
}

function downmixStereo48kPcm16ToMono24k(pcm: Buffer): Buffer {
  const sourceFrames = Math.floor(pcm.length / 4);
  const outputSamples = Math.floor(sourceFrames / 2);
  const output = Buffer.alloc(outputSamples * 2);
  for (let sample = 0; sample < outputSamples; sample += 1) {
    const offset = sample * 8;
    const average = Math.round(
      (pcm.readInt16LE(offset) +
        pcm.readInt16LE(offset + 2) +
        pcm.readInt16LE(offset + 4) +
        pcm.readInt16LE(offset + 6)) /
        4,
    );
    output.writeInt16LE(Math.max(-32768, Math.min(32767, average)), sample * 2);
  }
  return output;
}

function upsampleMono24kPcm16ToStereo48k(pcm: Buffer): Buffer {
  const sampleCount = Math.floor(pcm.length / 2);
  const output = Buffer.alloc(sampleCount * 8);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const value = pcm.readInt16LE(sample * 2);
    const offset = sample * 8;
    output.writeInt16LE(value, offset);
    output.writeInt16LE(value, offset + 2);
    output.writeInt16LE(value, offset + 4);
    output.writeInt16LE(value, offset + 6);
  }
  return output;
}

function estimateDurationSeconds(pcm: Buffer): number {
  const bytesPerSample = (BIT_DEPTH / 8) * CHANNELS;
  if (bytesPerSample <= 0) {
    return 0;
  }
  return pcm.length / (bytesPerSample * SAMPLE_RATE);
}

export async function writeVoiceWavFile(
  pcm: Buffer,
): Promise<{ path: string; durationSeconds: number }> {
  const tempDir = await fs.mkdtemp(path.join(resolvePreferredOpenClawTmpDir(), "discord-voice-"));
  const filePath = path.join(tempDir, `segment-${randomUUID()}.wav`);
  const wav = buildWavBuffer(pcm);
  await fs.writeFile(filePath, wav);
  scheduleTempCleanup(tempDir);
  return { path: filePath, durationSeconds: estimateDurationSeconds(pcm) };
}

function scheduleTempCleanup(tempDir: string, delayMs: number = 30 * 60 * 1000): void {
  const timer = setTimeout(() => {
    fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
      if (shouldLogVerbose()) {
        logVerbose(`discord voice: temp cleanup failed for ${tempDir}: ${formatErrorMessage(err)}`);
      }
    });
  }, delayMs);
  timer.unref();
}
