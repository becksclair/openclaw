import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri.ts";

export type DesktopTalkFixtureAudio = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
};

type DesktopTalkFixturePayload = {
  bytes: number[];
  fileName: string;
  mimeType: string;
};

export async function loadDesktopTalkFixtureAudio(): Promise<DesktopTalkFixtureAudio | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const result = await invoke<DesktopTalkFixturePayload>("desktop_talk_test_fixture_audio");
  return {
    bytes: Uint8Array.from(result.bytes),
    fileName: result.fileName,
    mimeType: result.mimeType,
  };
}
