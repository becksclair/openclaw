import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { isTauriRuntime } from "./tauri.ts";

export async function readAutostartEnabled() {
  if (!isTauriRuntime()) {
    return false;
  }
  return await isEnabled();
}

export async function writeAutostartEnabled(enabled: boolean) {
  if (!isTauriRuntime()) {
    return enabled;
  }
  if (enabled) {
    await enable();
  } else {
    await disable();
  }
  return await isEnabled();
}
