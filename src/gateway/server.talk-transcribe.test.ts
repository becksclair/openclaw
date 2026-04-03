import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from "../infra/device-identity.js";
import { buildDeviceAuthPayload } from "./device-auth.js";
import {
  connectOk,
  installGatewayTestHooks,
  readConnectChallengeNonce,
  rpcReq,
} from "./test-helpers.js";
import { withServer } from "./test-with-server.js";

const { runMediaUnderstandingFileMock } = vi.hoisted(() => ({
  runMediaUnderstandingFileMock: vi.fn(),
}));

vi.mock("../media-understanding/runtime.js", () => ({
  runMediaUnderstandingFile: runMediaUnderstandingFileMock,
}));

installGatewayTestHooks({ scope: "suite" });

type GatewaySocket = Parameters<Parameters<typeof withServer>[0]>[0];
const DEVICE_PATH = path.join(os.tmpdir(), `openclaw-talk-transcribe-${process.pid}.json`);
const DEVICE = loadOrCreateDeviceIdentity(DEVICE_PATH);

type TalkTranscribePayload = {
  model?: string;
  provider?: string;
  text?: string;
};

async function createFreshOperatorDevice(scopes: string[], nonce: string) {
  const signedAtMs = Date.now();
  const payload = buildDeviceAuthPayload({
    deviceId: DEVICE.deviceId,
    clientId: "test",
    clientMode: "test",
    role: "operator",
    scopes,
    signedAtMs,
    token: "secret",
    nonce,
  });
  return {
    id: DEVICE.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(DEVICE.publicKeyPem),
    signature: signDevicePayload(DEVICE.privateKeyPem, payload),
    signedAt: signedAtMs,
    nonce,
  };
}

async function connectOperator(ws: GatewaySocket, scopes: string[]) {
  const nonce = await readConnectChallengeNonce(ws);
  await connectOk(ws, {
    token: "secret",
    scopes,
    device: await createFreshOperatorDevice(scopes, String(nonce)),
  });
}

async function fetchTalkTranscribe(ws: GatewaySocket, params: Record<string, unknown>) {
  return rpcReq<TalkTranscribePayload>(ws, "talk.transcribe", params);
}

describe("gateway talk.transcribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transcribes audio through the shared media-understanding runtime", async () => {
    runMediaUnderstandingFileMock.mockResolvedValue({
      text: "fixture transcript",
      provider: "deepgram",
      model: "nova-3",
    });

    await withServer(async (ws) => {
      await connectOperator(ws, ["operator.write"]);
      const res = await fetchTalkTranscribe(ws, {
        audioBase64: Buffer.from("RIFF").toString("base64"),
        fileName: "sample.wav",
        mimeType: "audio/wav",
      });
      expect(res.ok).toBe(true);
      expect(res.payload).toEqual({
        text: "fixture transcript",
        provider: "deepgram",
        model: "nova-3",
      });
    });

    expect(runMediaUnderstandingFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "audio",
        filePath: expect.stringMatching(/sample\.wav$/),
        mime: "audio/wav",
      }),
    );
  });

  it("rejects invalid base64 payloads", async () => {
    await withServer(async (ws) => {
      await connectOperator(ws, ["operator.write"]);
      const res = await fetchTalkTranscribe(ws, {
        audioBase64: "not-valid-base64!",
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain("invalid base64 audio payload");
    });

    expect(runMediaUnderstandingFileMock).not.toHaveBeenCalled();
  });

  it("returns unavailable when the runtime produces no transcript", async () => {
    runMediaUnderstandingFileMock.mockResolvedValue({ text: undefined });

    await withServer(async (ws) => {
      await connectOperator(ws, ["operator.write"]);
      const res = await fetchTalkTranscribe(ws, {
        audioBase64: Buffer.from("RIFF").toString("base64"),
        fileName: "empty.wav",
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain("audio transcription produced no text");
    });
  });
});
