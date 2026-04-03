import { useEffect, useMemo, useState } from "react";
import {
  loadDesktopSettings,
  persistDesktopSettings,
  readGatewayTokenForUrl,
  type DesktopSettings,
  type DesktopTab,
} from "../desktop/settings.ts";

export function useDesktopSettings() {
  const [settings, setSettings] = useState<DesktopSettings>(() => loadDesktopSettings());

  useEffect(() => {
    persistDesktopSettings(settings);
  }, [settings]);

  const api = useMemo(
    () => ({
      setGatewayUrl(this: void, gatewayUrl: string) {
        setSettings((current) => ({
          ...current,
          gatewayToken: readGatewayTokenForUrl(gatewayUrl),
          gatewayUrl,
        }));
      },
      setGatewayToken(this: void, gatewayToken: string) {
        setSettings((current) => ({ ...current, gatewayToken }));
      },
      setLastTab(this: void, lastTab: DesktopTab) {
        setSettings((current) => ({ ...current, lastTab }));
      },
      setLaunchAtLogin(this: void, launchAtLogin: boolean) {
        setSettings((current) => ({ ...current, launchAtLogin }));
      },
      toggleBackgroundVoiceEnabled(this: void) {
        setSettings((current) => ({
          ...current,
          backgroundVoiceEnabled: !current.backgroundVoiceEnabled,
        }));
      },
      togglePushToTalkEnabled(this: void) {
        setSettings((current) => ({ ...current, pushToTalkEnabled: !current.pushToTalkEnabled }));
      },
      toggleTalkEnabled(this: void) {
        setSettings((current) => ({ ...current, talkEnabled: !current.talkEnabled }));
      },
      toggleVadEnabled(this: void) {
        setSettings((current) => ({ ...current, vadEnabled: !current.vadEnabled }));
      },
    }),
    [],
  );

  return { settings, ...api };
}
