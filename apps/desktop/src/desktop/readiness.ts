import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri.ts";

export type BrowserPermissionState = "granted" | "prompt" | "denied" | "unavailable";

export type NativeDesktopReadiness = {
  desktopEnvironment: string | null;
  platform: string;
  portalLikelyAvailable: boolean;
  runtime: "browser" | "tauri";
  sessionType: string | null;
  windowVisible: boolean;
};

const DEFAULT_NATIVE_READINESS: NativeDesktopReadiness = {
  desktopEnvironment: null,
  platform: typeof navigator === "undefined" ? "unknown" : navigator.platform || "unknown",
  portalLikelyAvailable: false,
  runtime: "browser",
  sessionType: null,
  windowVisible: true,
};

type MicrophonePermissionDescriptor = PermissionDescriptor & {
  name: PermissionName | "microphone";
};

function normalizeBrowserPermission(
  value: NotificationPermission | PermissionState | null | undefined,
): BrowserPermissionState {
  if (value === "granted") {
    return "granted";
  }
  if (value === "denied") {
    return "denied";
  }
  if (value === "default" || value === "prompt") {
    return "prompt";
  }
  return "unavailable";
}

export async function probeNativeDesktopReadiness(): Promise<NativeDesktopReadiness> {
  if (!isTauriRuntime()) {
    return DEFAULT_NATIVE_READINESS;
  }
  try {
    return await invoke<NativeDesktopReadiness>("desktop_readiness_probe");
  } catch {
    return {
      ...DEFAULT_NATIVE_READINESS,
      runtime: "tauri",
    };
  }
}

export async function readMicrophonePermissionState(): Promise<BrowserPermissionState> {
  if (typeof navigator === "undefined") {
    return "unavailable";
  }

  try {
    const permissionApi = navigator.permissions;
    if (permissionApi?.query) {
      const status = await permissionApi.query({
        name: "microphone",
      } as MicrophonePermissionDescriptor);
      return normalizeBrowserPermission(status.state);
    }
  } catch {
    return typeof navigator.mediaDevices?.getUserMedia === "function" ? "prompt" : "unavailable";
  }

  return typeof navigator.mediaDevices?.getUserMedia === "function" ? "prompt" : "unavailable";
}

export async function requestMicrophonePermissionAccess(): Promise<BrowserPermissionState> {
  if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function") {
    return "unavailable";
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
  } catch {
    return await readMicrophonePermissionState();
  }

  return await readMicrophonePermissionState();
}

export async function readNotificationPermissionState(): Promise<BrowserPermissionState> {
  if (typeof Notification === "undefined") {
    return "unavailable";
  }
  return normalizeBrowserPermission(Notification.permission);
}

export async function requestNotificationPermissionAccess(): Promise<BrowserPermissionState> {
  if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function") {
    return "unavailable";
  }
  const permission = await Notification.requestPermission();
  return normalizeBrowserPermission(permission);
}
