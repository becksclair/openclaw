# OpenClaw desktop app

This workspace contains the in-progress Tauri desktop shell for OpenClaw.

## Current status

The desktop app is now a real runnable shell, not just a placeholder. The current slice includes:

- a Tauri + React desktop window
- tray-primary behavior with close-to-tray handling
- single-instance behavior
- launch-at-login wiring
- main-session-first chat against an existing Gateway
- session-scoped Gateway token entry so the desktop shell can authenticate against a real locked Gateway
- a real secondary Gateway session running as `role: "node"`
- desktop node pairing, approval, status, and a small safe invoke surface
- a real voice/setup readiness surface for gateway, node, permissions, autostart, and Talk config
- a first Talk bootstrap that loads gateway Talk config, speaks a test phrase or the last assistant reply, and plays the audio locally
- a first STT bootstrap that transcribes a chosen audio file or the bundled dev fixture through the gateway media runtime

The current node command surface is intentionally small and honest:

- `device.info`
- `device.status`
- `system.notify`

Not implemented yet:

- native Talk capture/runtime plumbing
- microphone capture behind the STT bootstrap
- media capture
- richer node command surfaces

## Development

Start an existing Gateway first, then run the desktop app. If the Gateway requires `gateway.auth.token`, use the same token source the dashboard uses and paste that into the desktop settings or provide it through the harness helper:

```bash
openclaw dashboard --no-open
cd apps/desktop
pnpm dev
```

Useful scripts from this workspace:

```bash
cd apps/desktop
pnpm dev
pnpm dev:web
pnpm build:web
pnpm preview
```

## Dev harness

The desktop app can expose a narrow dev-only localhost harness for automation and agent-driven smoke checks.

Enable it explicitly when starting the app:

```bash
cd apps/desktop
OPENCLAW_DESKTOP_HARNESS=1 pnpm dev
```

When enabled, the app prints a loopback URL and bearer token like this:

```bash
OPENCLAW_DESKTOP_HARNESS=http://127.0.0.1:40123 token=ocdth-...
```

Current harness endpoints:

- `GET /app/status`
- `POST /window/show`
- `POST /window/hide`
- `GET /settings`
- `POST /settings`
- `GET /ui/snapshot`
- `POST /ui/click`
- `POST /ui/type`

Agent-first CLI helper:

```bash
export OPENCLAW_DESKTOP_HARNESS_URL=http://127.0.0.1:40123
export OPENCLAW_DESKTOP_HARNESS_TOKEN=ocdth-...
pnpm desktop:harness -- status
pnpm desktop:harness -- wait-for --source status --path frontendReady --truthy
pnpm desktop:harness -- snapshot
pnpm desktop:harness -- click --target tab.settings
pnpm desktop:harness -- settings:set --gateway-url ws://127.0.0.1:18789 --gateway-token "$OPENCLAW_GATEWAY_TOKEN"
pnpm desktop:harness -- type --target settings.gatewayUrl --value ws://127.0.0.1:18789
pnpm desktop:harness -- type --target settings.gatewayToken --value "$OPENCLAW_GATEWAY_TOKEN"
pnpm desktop:harness -- chat:send --message "hello from harness"
pnpm desktop:harness -- node:invoke --action device.status
pnpm desktop:harness -- click --target voice.refreshReadiness
pnpm desktop:harness -- click --target voice.refreshTalkConfig
pnpm desktop:harness -- click --target voice.speakTestPhrase
pnpm desktop:harness -- click --target voice.speakLastAssistantReply
pnpm desktop:harness -- click --target voice.transcribeFixture
pnpm desktop:harness -- click --target voice.requestMicrophonePermission
pnpm desktop:harness -- click --target voice.requestNotificationPermission
pnpm desktop:harness -- settings:get
```

The helper is intentionally built for automation and debugging first: stable JSON output, semantic actions, polling support, and low-friction shell composition.

For authenticated local testing, prefer the token embedded in `openclaw dashboard --no-open` over `openclaw config get gateway.auth.token`; in this environment the dashboard path resolved the live token correctly while raw config lookup did not.

Guardrails:

- debug/dev builds only
- loopback only
- explicit opt-in via `OPENCLAW_DESKTOP_HARNESS=1`
- bearer-token auth required
- semantic app actions only, no arbitrary script execution

## What you can test right now

- gateway connection status
- tray hide/show behavior
- chat send/history in the `main` session
- desktop node session startup
- node pairing request / approval / retry flow
- pending pairing approvals
- voice/setup readiness state for microphone, notifications, autostart, Talk config, and desktop environment hints
- gateway-backed Talk synthesis and local desktop playback from the Voice tab or harness
- gateway-backed STT transcription for a chosen audio file or the bundled fixture from the Voice tab or harness
- node command buttons for `device.info`, `device.status`, and `system.notify`

## Verification

Recent local verification for this workspace and repo slice:

```bash
pnpm check
cd apps/desktop && node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
cd apps/desktop && pnpm build:web
cd apps/desktop/src-tauri && cargo check
```

## Notes

- The desktop app currently assumes a connect-to-existing-Gateway workflow.
- AppImage bundling is still a separate known issue; dev mode is the intended loop for now.
- The implementation plan lives in `plans/desktop-tauri-kde-wayland.md`.
