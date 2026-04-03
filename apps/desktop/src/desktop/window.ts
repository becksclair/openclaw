import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "./tauri.ts";

let closeToTrayInstalled = false;
let allowQuit = false;

export async function installCloseToTrayBehavior() {
  if (!isTauriRuntime() || closeToTrayInstalled) {
    return;
  }
  closeToTrayInstalled = true;
  const appWindow = getCurrentWindow();
  await appWindow.onCloseRequested((event) => {
    if (allowQuit) {
      return;
    }
    event.preventDefault();
    void appWindow.hide();
  });
}

export async function showMainWindow() {
  if (!isTauriRuntime()) {
    return;
  }
  const appWindow = getCurrentWindow();
  await appWindow.unminimize();
  await appWindow.show();
  await appWindow.setFocus();
}

export async function hideMainWindow() {
  if (!isTauriRuntime()) {
    return;
  }
  await getCurrentWindow().hide();
}

export async function quitDesktopApp() {
  if (!isTauriRuntime()) {
    return;
  }
  allowQuit = true;
  await getCurrentWindow().close();
}
