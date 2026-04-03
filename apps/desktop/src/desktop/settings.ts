export type DesktopTab = "chat" | "voice" | "settings";

export type DesktopSettings = {
  backgroundVoiceEnabled: boolean;
  gatewayToken: string;
  gatewayUrl: string;
  lastTab: DesktopTab;
  launchAtLogin: boolean;
  pushToTalkEnabled: boolean;
  talkEnabled: boolean;
  vadEnabled: boolean;
};

type PersistedDesktopSettings = Omit<DesktopSettings, "gatewayToken"> & {
  gatewayToken?: never;
};

const STORAGE_KEY = "openclaw.desktop.settings.v2";
const LEGACY_STORAGE_KEY = "openclaw.desktop.settings.v1";
const TOKEN_SESSION_KEY_PREFIX = "openclaw.desktop.gateway-token.v1:";

const DEFAULT_SETTINGS: DesktopSettings = {
  backgroundVoiceEnabled: false,
  gatewayToken: "",
  gatewayUrl: "ws://127.0.0.1:18789",
  lastTab: "chat",
  launchAtLogin: false,
  pushToTalkEnabled: false,
  talkEnabled: false,
  vadEnabled: false,
};

function isStorage(value: unknown): value is Storage {
  return (
    Boolean(value) &&
    typeof (value as Storage).getItem === "function" &&
    typeof (value as Storage).setItem === "function"
  );
}

function getSafeStorage(name: "localStorage" | "sessionStorage"): Storage | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  try {
    const storage = window[name];
    return isStorage(storage) ? storage : null;
  } catch {
    return null;
  }
}

function getSafeLocalStorage(): Storage | null {
  return getSafeStorage("localStorage");
}

function getSafeSessionStorage(): Storage | null {
  return getSafeStorage("sessionStorage");
}

function normalizeGatewayScope(gatewayUrl: string): string {
  const trimmed = gatewayUrl.trim();
  if (!trimmed) {
    return "default";
  }
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `ws://${trimmed}`);
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/u, "") || parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return trimmed;
  }
}

function tokenSessionKeyForGateway(gatewayUrl: string): string {
  return `${TOKEN_SESSION_KEY_PREFIX}${normalizeGatewayScope(gatewayUrl)}`;
}

function loadGatewayToken(gatewayUrl: string): string {
  try {
    return getSafeSessionStorage()?.getItem(tokenSessionKeyForGateway(gatewayUrl))?.trim() ?? "";
  } catch {
    return "";
  }
}

function persistGatewayToken(gatewayUrl: string, token: string) {
  try {
    const storage = getSafeSessionStorage();
    if (!storage) {
      return;
    }
    const key = tokenSessionKeyForGateway(gatewayUrl);
    const normalized = token.trim();
    if (normalized) {
      storage.setItem(key, normalized);
      return;
    }
    storage.removeItem(key);
  } catch {
    // best-effort only
  }
}

export function loadDesktopSettings(): DesktopSettings {
  const storage = getSafeLocalStorage();
  try {
    const raw = storage?.getItem(STORAGE_KEY) ?? storage?.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<DesktopSettings>;
    const gatewayUrl =
      typeof parsed.gatewayUrl === "string" ? parsed.gatewayUrl : DEFAULT_SETTINGS.gatewayUrl;
    const settings: DesktopSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      gatewayToken: loadGatewayToken(gatewayUrl),
      gatewayUrl,
      lastTab: isDesktopTab(parsed.lastTab) ? parsed.lastTab : DEFAULT_SETTINGS.lastTab,
    };
    if ("gatewayToken" in parsed) {
      persistDesktopSettings(settings);
    }
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function persistDesktopSettings(settings: DesktopSettings) {
  persistGatewayToken(settings.gatewayUrl, settings.gatewayToken);
  const storage = getSafeLocalStorage();
  if (!storage) {
    return;
  }
  const persisted: PersistedDesktopSettings = {
    backgroundVoiceEnabled: settings.backgroundVoiceEnabled,
    gatewayUrl: settings.gatewayUrl,
    lastTab: settings.lastTab,
    launchAtLogin: settings.launchAtLogin,
    pushToTalkEnabled: settings.pushToTalkEnabled,
    talkEnabled: settings.talkEnabled,
    vadEnabled: settings.vadEnabled,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  storage.removeItem(LEGACY_STORAGE_KEY);
}

export function readGatewayTokenForUrl(gatewayUrl: string): string {
  return loadGatewayToken(gatewayUrl);
}

function isDesktopTab(value: unknown): value is DesktopTab {
  return value === "chat" || value === "voice" || value === "settings";
}
