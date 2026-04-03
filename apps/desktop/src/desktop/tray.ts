import { defaultWindowIcon } from "@tauri-apps/api/app";
import { Menu } from "@tauri-apps/api/menu/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { isTauriRuntime } from "./tauri.ts";

type TrayOptions = {
  backgroundVoiceEnabled: boolean;
  onHide: () => Promise<void>;
  onQuit: () => Promise<void>;
  onShow: () => Promise<void>;
  onToggleBackgroundVoice: () => void;
};

let tray: TrayIcon | null = null;
let syncBackgroundVoiceLabel: ((enabled: boolean) => Promise<void>) | null = null;

export async function ensureDesktopTray(options: TrayOptions) {
  if (!isTauriRuntime()) {
    return null;
  }
  if (tray) {
    await syncDesktopTray(options.backgroundVoiceEnabled);
    return tray;
  }

  const backgroundVoiceItem = {
    id: "toggle-background-voice",
    text: options.backgroundVoiceEnabled ? "Disable background voice" : "Enable background voice",
    action: () => options.onToggleBackgroundVoice(),
  };

  const menu = await Menu.new({
    id: "desktop-tray-menu",
    items: [
      {
        text: "Open OpenClaw Desktop",
        action: () => {
          void options.onShow();
        },
      },
      {
        text: "Hide window",
        action: () => {
          void options.onHide();
        },
      },
      backgroundVoiceItem,
      {
        text: "Quit",
        action: () => {
          void options.onQuit();
        },
      },
    ],
  });

  syncBackgroundVoiceLabel = async (enabled: boolean) => {
    const nextItem = await menu.get(backgroundVoiceItem.id);
    if (nextItem && "setText" in nextItem) {
      await nextItem.setText(enabled ? "Disable background voice" : "Enable background voice");
    }
  };

  tray = await TrayIcon.new({
    id: "openclaw-desktop-tray",
    icon: await defaultWindowIcon(),
    menu,
    menuOnLeftClick: false,
    tooltip: "OpenClaw Desktop",
    action: (event) => {
      if (event.type === "Click" && event.button === "Left" && event.buttonState === "Up") {
        void options.onShow();
      }
    },
  });

  return tray;
}

export async function syncDesktopTray(backgroundVoiceEnabled: boolean) {
  await syncBackgroundVoiceLabel?.(backgroundVoiceEnabled);
}
