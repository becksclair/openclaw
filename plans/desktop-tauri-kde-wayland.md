# Build the cross-platform Tauri desktop app for KDE Plasma Wayland first

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `/home/bex/.agents/PLANS.md`. That file is not in this repository, so the requirements that matter here are repeated in this plan rather than assumed.

## Purpose / Big Picture

After this change, OpenClaw will have a new cross-platform desktop app built with Tauri, React, and shadcn/ui that behaves like a real desktop companion rather than a thin web wrapper. A user on KDE Plasma Wayland will be able to install or run the app, see a tray icon, open a main window with Chat and Voice modes, keep the app alive in the tray after closing the window, connect it to an already-running Gateway, use it as both an operator client and a node at the same time, capture photos, video clips, screenshots, and screen recordings through the node surface, and use Talk mode plus global push-to-talk and model-based voice activity detection while the app is running in the background.

The first implementation target is KDE Plasma on Wayland, with X11 supported on a best-effort basis where behavior naturally works. Windows is a later milestone with reduced scope. The app will not own local Gateway process management in the first release. Instead, it connects to an already-running Gateway and quietly retries from the tray if that Gateway is unavailable.

The easiest way to see the finished system working will be to run the desktop app locally, pair it to a running Gateway, watch the tray icon appear, open the Chat mode and send a message to the `main` session, then switch to Voice mode, enable Talk, hold the global push-to-talk shortcut, speak, release the shortcut, and see the message land in the `main` session while the status-only floating voice HUD appears only during the active voice interaction. The same app instance should also appear to the Gateway as a node and support media capture commands with the policy defined below.

## Progress

- [x] (2026-04-02 00:00Z) Collected repository context for the existing macOS app, current web UI, node behavior, Talk behavior, and voice wake contracts.
- [x] (2026-04-02 00:00Z) Resolved product scope decisions for the first desktop release: KDE Plasma Wayland first, X11 best-effort, tray-primary shell, Chat + Voice + minimal settings window, operator and node connections simultaneously, connect-to-existing-Gateway only, voice routed to `main`, Talk + global push-to-talk + model-based VAD/manual wake, status-only floating HUD, and Linux node media support for photo/video and screenshot/screen recording.
- [x] (2026-04-02 00:00Z) Decided configuration ownership and secret model: Gateway owns Talk and speech-to-text configuration, desktop owns runtime toggles and UI state, desktop may read Talk and speech-to-text secrets only through a dedicated voice-secret scope.
- [x] (2026-04-02 00:00Z) Started implementation by creating the `packages/desktop-core` shared package for reusable browser-safe Gateway/device/agent logic and rewiring the current `ui` package to consume it through compatibility wrappers.
- [x] (2026-04-02 00:00Z) Reserved the future desktop workspace at `apps/desktop` with a stub package and README so the Tauri app can land in a dedicated workspace once Tauri/React/shadcn dependencies are explicitly approved.
- [x] (2026-04-02 00:00Z) Created the first real desktop workspace at `apps/desktop` with Tauri, React, a shadcn-style component layer, single-instance handling, tray support, launch-at-login wiring, close-to-tray behavior, and persistent local settings.
- [x] (2026-04-02 00:00Z) Extended `packages/desktop-core` with a minimal shared chat controller and wired the desktop Chat tab to resolve the canonical `main` session, load history, send messages, abort runs, and react to live `chat` events.
- [x] (2026-04-02 00:00Z) Fixed the local `pnpm tsgo` launcher so missing execute bits on the native `tsgo` binary no longer explode with `EACCES`, then wired baseline desktop node pairing and periodic presence beacons into the settings surface.
- [x] (2026-04-02 00:00Z) Added desktop pairing approval UX on top of the gateway’s existing `node.pair.list`, `node.pair.requested`, and `node.pair.resolved` flow so the desktop shell can approve or reject pending node requests directly.
- [x] (2026-04-02 00:00Z) Added a small desktop node command surface for safe invoke actions (`device.info`, `device.status`, `system.notify`) with shared invoke/result state.
- [ ] Extract a shared TypeScript desktop domain package from the existing `ui` code so the new desktop app and the current Control UI can share Gateway connection, device identity, agents list, sessions list, and chat state logic.
- [ ] Implement the desktop operator connection path with quiet background retry from the tray and a main-session-first Chat mode.
- [x] (2026-04-03 00:00Z) Implemented the first true simultaneous node connection path using a real `role: "node"` desktop session alongside the operator session, with a tiny honest command surface (`device.info`, `device.status`, `system.notify`) and gateway-driven pairing approval/reconnect flow.
- [x] (2026-04-03 00:00Z) Added a dev-only desktop harness for local automation and remote agent verification, gated behind explicit opt-in, loopback-only binding, bearer-token auth, and a narrow semantic control surface (`app.status`, `window.show/hide`, `settings.get/set`, `ui.snapshot`, `ui.click`, `ui.type`).
- [x] (2026-04-03 00:00Z) Added an agent-first CLI wrapper for the desktop harness so local automation and AI-driven smoke/debug loops can use stable subcommands (`status`, `snapshot`, `wait-for`, `chat:send`, `node:*`) instead of hand-rolled `curl` glue.
- [x] (2026-04-03 00:00Z) Added session-scoped Gateway token support to the desktop shell so the operator session and node session can authenticate against a real locked Gateway and complete the pairing/approval loop instead of failing at connect.
- [x] (2026-04-03 00:00Z) Switched the desktop approval surface onto the real `device.pair.*` gateway seam so live repair/pair requests for the desktop app show up and can be approved instead of polling the wrong `node.pair.*` surface.
- [x] (2026-04-03 00:00Z) Fixed the remaining live operator reconnect failure by making the operator socket present the same resolved desktop device identity metadata as the paired node socket; after that change, live harness verification showed both operator and node sessions connected simultaneously with no pending pair requests.
- [x] (2026-04-03 00:00Z) Added a desktop readiness and guided setup surface that truthfully reports gateway reachability, token presence, node pairing, microphone/notifications/autostart readiness, Talk config availability, and native desktop environment hints before the native voice runtime lands.
- [x] (2026-04-03 00:00Z) Added the first real Talk bootstrap in the desktop shell: the Voice tab now loads gateway Talk config, exposes harness-visible Talk actions/state, synthesizes speech through `talk.speak`, and plays the returned audio locally.
- [x] (2026-04-03 00:00Z) Added the first desktop STT bootstrap: the gateway now exposes a small `talk.transcribe` RPC backed by the shared media-understanding runtime, and the desktop Voice tab can transcribe a chosen audio file or the bundled dev fixture through that path.
- [ ] Implement native Talk mode with direct speech-to-text requests to the local OpenAI-compatible Parakeet service, with fallback to OpenAI `gpt-4o-mini-transcribe`, while reading the active Talk and speech-to-text configuration from the Gateway via a dedicated voice-secret scope.
- [ ] Implement global push-to-talk on KDE Plasma Wayland first, with a best-effort X11 path, and add a status-only floating HUD that appears only during active Talk, push-to-talk, or VAD interactions.
- [ ] Implement model-based VAD/manual wake as a background-capable service with tray and main-window controls.
- [ ] Implement Linux node media capture with this policy: screenshots and screen recordings may run from tray/background when the desktop and portal environment permit it; camera photo and video capture require the app window to be foregrounded.
- [ ] Add guided permissions and setup flows for microphone, notifications, autostart, node pairing, and media capture readiness.
- [ ] Add Windows follow-up milestones with explicitly reduced initial scope once the Linux-first path is working and validated.
- [ ] Run full validation, document outcomes, and update this plan with any discoveries or scope changes that occur during implementation.

## Surprises & Discoveries

- Observation: The current repository already has a browser-side Gateway client with device identity, device token persistence, request/response types, and reconnect-oriented connection planning in `ui/src/ui/gateway.ts`. That means the new desktop app does not need a fresh Gateway protocol client from scratch.
  Evidence: `ui/src/ui/gateway.ts` already defines `GatewayEventFrame`, `GatewayResponseFrame`, `GatewayBrowserClientOptions`, and connection parameters with `minProtocol: 3`, `maxProtocol: 3`, `role`, `scopes`, and optional `device` authentication payloads.

- Observation: The current Talk and Voice Wake design already separates Gateway-owned configuration from local runtime behavior. Wake words are globally owned by the Gateway, while the macOS app keeps local enablement toggles and runtime controllers.
  Evidence: `docs/nodes/voicewake.md` defines `voicewake.get`, `voicewake.set`, and `voicewake.changed`, and `src/gateway/server-methods/voicewake.ts` implements those methods. The macOS app stores local toggles in `apps/macos/Sources/OpenClaw/AppState.swift`.

- Observation: The current node documentation already supports camera photos, camera video clips, and screen recordings with a 60-second ceiling, so the desktop app can preserve those semantics rather than inventing new defaults.
  Evidence: `docs/nodes/index.md` documents `openclaw nodes camera snap`, `openclaw nodes camera clip`, and `openclaw nodes screen record`, and states that clips and screen recordings are clamped to `<= 60s`.

- Observation: `talk.config` already supports secret-bearing responses gated by scope, which makes Gateway-owned speech-to-text credentials feasible for the desktop app without creating a second local secret system in the first release.
  Evidence: `src/gateway/server-methods/talk.ts` checks `includeSecrets` and requires either `operator.admin` or `operator.talk.secrets` before returning secret-bearing Talk config.

- Observation: The repository currently has no Tauri or React workspace dependencies checked in for the new desktop app, so the first truthful implementation slice has to start with shared-domain extraction and workspace reservation rather than pretending the native shell already exists.
  Evidence: The root workspace only included `.`, `ui`, `packages/*`, and `extensions/*` before this change, and package manifests in the repository do not currently declare React or Tauri dependencies for a desktop workspace.

- Observation: `pnpm tauri init` gave us a working icon set, capabilities layout, and baseline Rust crate quickly, and the app now builds through the Rust compile stage with single-instance and autostart plugins enabled.
  Evidence: `apps/desktop/src-tauri` now contains generated icons, capabilities, `Cargo.toml`, and a working `tauri.conf.json`, and `pnpm tauri build --debug` compiles the desktop binary successfully before later failing during AppImage bundling.

- Observation: Linux desktop packaging is not fully green yet because the AppImage bundling leg currently dies inside `linuxdeploy` after the desktop binary is already built.
  Evidence: `pnpm tauri build --debug` finishes the Rust `dev` build and emits the debug binary, `.deb`, and `.rpm`, then fails only at the AppImage bundling step with `failed to run linuxdeploy`.

- Observation: The new desktop Chat tab can already reuse the shared Gateway client and a slim shared chat controller without dragging over the full Control UI render stack.
  Evidence: `packages/desktop-core/src/controllers/chat.ts` now resolves `main`, loads `chat.history`, sends `chat.send`, aborts `chat.abort`, and applies live `chat` events, while `apps/desktop/src/hooks/useDesktopChat.ts` consumes that shared controller directly.

- Observation: Baseline node presence can piggyback on the existing gateway `system-event` + `presence` flow without waiting for the full media/node runtime.
  Evidence: `packages/desktop-core/src/controllers/nodes.ts` now requests `node.pair.request`, loads `node.list`, emits periodic `system-event` presence lines tagged to the desktop node id, and consumes `presence` plus `node.pair.resolved` events from the shared gateway client.

- Observation: The desktop shell can also host a lightweight approval surface without bespoke backend work because the gateway already exposes pending requests and resolution events.
  Evidence: the same shared desktop node controller now loads `node.pair.list`, tracks pending requests from `node.pair.requested`, and drives `node.pair.approve` / `node.pair.reject` from the desktop settings UI.

- Observation: A tiny node command surface is enough to validate the full invoke path without jumping straight to sensitive or media-heavy commands.
  Evidence: the desktop node controller now issues `node.invoke` for `device.info`, `device.status`, and `system.notify`, and the settings panel renders the selected node plus the last invoke payload.

- Observation: The desktop app now has a real second gateway socket running as `role: "node"`, not just operator-mediated node RPCs.
  Evidence: `packages/desktop-core/src/gateway.ts` now accepts a generic connect profile, and `apps/desktop/src/hooks/useDesktopNode.ts` creates a separate node-mode `GatewayBrowserClient` with `role: "node"`, `mode: "node"`, and declared commands handled through `node.invoke.request` / `node.invoke.result`.

- Observation: A dev-only localhost harness is enough to let shell automation and agents verify real desktop state without introducing a selector-driven remote-control layer.
  Evidence: `apps/desktop/src-tauri/src/harness.rs` now exposes a loopback-only, bearer-token-protected control plane, while `apps/desktop/src/hooks/useDevHarnessBridge.ts` answers semantic UI commands and snapshots from the live React state tree.

- Observation: The harness becomes materially more useful once the agent has a tiny CLI layer that speaks in semantic verbs instead of raw HTTP calls.
  Evidence: `scripts/dev/desktop-harness.ts` now wraps the harness with polling and action-oriented commands such as `wait-for`, `chat:send`, `node:pair`, and `node:invoke`, and the root `package.json` exposes it as `pnpm desktop:harness`.

- Observation: The desktop shell originally had no way to send a Gateway auth token, which made pairing and approvals fail on a real authenticated Gateway even though the UI itself looked finished.
  Evidence: `apps/desktop/src/desktop/settings.ts`, `apps/desktop/src/hooks/useGatewayStatus.ts`, and `apps/desktop/src/hooks/useDesktopNode.ts` now carry a session-scoped `gatewayToken`; a live harness smoke with a fake token changed the gateway error from `gateway token missing` to `gateway token mismatch`, proving the token now reaches the actual operator connect handshake.

- Observation: The desktop approval UI was pointed at the wrong pairing surface. Real desktop repair/pair requests land in `device.pair.*`, not `node.pair.*`.
  Evidence: the gateway exposes `device.pair.list`, `device.pair.approve`, `device.pair.reject`, `device.pair.requested`, and `device.pair.resolved` in `src/gateway/server-methods/devices.ts`; `packages/desktop-core/src/controllers/nodes.ts` now uses that seam, and live CLI inspection showed pending desktop repair requests in `openclaw devices list` while `openclaw nodes pending` stayed empty.

- Observation: The dashboard token resolution path was the trustworthy live auth source during testing; raw `openclaw config get gateway.auth.token` returned a token that mismatched the running gateway, while `openclaw dashboard --no-open` yielded a token that successfully authenticated `openclaw gateway call health`.
  Evidence: live CLI verification during this session showed `openclaw gateway call health --token <config-token>` failing with token mismatch, while the dashboard-resolved token succeeded.

- Observation: The final operator connect bug was metadata pinning, not missing shared-token auth. The paired node session connected because it presented the desktop device identity metadata, while the operator session initially reused browser-default metadata and got treated like a mismatched device.
  Evidence: live harness snapshots repeatedly showed `gateway.lastError = "pairing required"` while `node.nodeGatewayConnected = true`; after `apps/desktop/src/hooks/useGatewayStatus.ts` started using the same resolved desktop identity metadata as the node client, the harness showed both `gateway.connected = true` and `node.nodeGatewayConnected = true` with `pendingRequestCount = 0`, and `openclaw nodes status` reported the desktop node as connected.

- Observation: A lightweight readiness surface made the Voice tab immediately more truthful without dragging in the whole audio runtime. Live probing can already distinguish between environment readiness and missing permissions.
  Evidence: the desktop Voice tab and harness snapshot now report gateway reachability, token presence, node readiness, microphone and notification permission state, launch-at-login status, `talk.config` availability, and native environment hints such as KDE/Wayland plus likely portal support.

- Observation: A renderer-side Talk bootstrap was enough to make voice output real without dragging in native capture/runtime plumbing too early.
  Evidence: the desktop Voice tab now loads `talk.config`, triggers `talk.speak`, plays the synthesized audio locally, updates harness-visible Talk state, and successfully transitioned from `idle` to `speaking` during a live harness smoke against the real gateway/provider config.

- Observation: The same incremental pattern works for STT too: keeping transcription on the gateway side avoids leaking provider secrets into the desktop app while still giving the desktop shell a real audio-to-text path.
  Evidence: the gateway now exposes `talk.transcribe` backed by the shared media-understanding runtime, the desktop Voice tab can submit an audio file or the bundled fixture through that method, and targeted gateway tests cover base64 validation plus shared-runtime reuse.

- Observation: The current macOS app models the app as both an operator client and a node companion at once, which matches the product direction chosen here.
  Evidence: `apps/macos/Sources/OpenClaw/MenuBar.swift` owns the operator shell, while `apps/macos/Sources/OpenClaw/NodeMode/MacNodeModeCoordinator.swift` independently establishes a node session using `role: "node"` and `clientMode: "node"`.

## Decision Log

- Decision: The first supported Linux environment is KDE Plasma on Wayland, with X11 treated as best-effort rather than equal priority.
  Rationale: This keeps the first target honest, aligns with the Wayland-first requirement, and avoids pretending the initial release is a generic Linux app when global shortcuts, tray behavior, media capture, and windowing differ substantially across desktops.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: The desktop app will connect to an already-running Gateway only in the first release.
  Rationale: The macOS app currently contains local and remote Gateway orchestration logic, but reproducing that full lifecycle in the first Tauri cut would expand scope dramatically without improving the core desktop product loops. Connecting to an existing Gateway is enough to ship chat, voice, tray behavior, and node mode.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: The desktop app will maintain both an operator connection and a node connection simultaneously when possible.
  Rationale: This matches the intended product shape of a tray companion that is both a user-facing client and a machine-facing capability surface.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: Desktop automation for local testing will use a dev-only localhost harness with a fixed semantic command set rather than a general remote-control or arbitrary script execution surface.
  Rationale: This gives the agent and local tooling enough power to verify the real desktop UX while keeping the security posture honest and avoiding a tiny accidental malware platform.
  Date/Author: 2026-04-03 / Sky + Bex

- Decision: The main window will contain Chat, Voice, and minimal settings only.
  Rationale: This keeps the desktop app focused and avoids drifting into full Control UI parity during the first release. Minimal settings are still required because a tray-first background-capable app cannot hide connection, permission, and runtime toggles entirely in the tray.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: Chat mode is main-session-first, while other sessions remain available as a secondary or advanced flow. Voice always targets the `main` session.
  Rationale: This preserves the current Talk behavior described in the repository and reduces complexity for the first voice integration while still allowing session browsing in Chat mode.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: The desktop shell is tray-primary and window-secondary.
  Rationale: The current macOS app already behaves this way, and the new desktop app is expected to keep running background services, retries, and node presence even after the main window is closed.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: Launch at login is part of the first internal builds, and the app restores the previous voice background state automatically.
  Rationale: Without launch-at-login and state restoration, the tray-first background voice and node story becomes fake immediately.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: Voice implementation will use a native runtime for speech-to-text requests, VAD, global shortcut handling, and other always-on behaviors, while React and shadcn/ui render the user interface.
  Rationale: Browser-only APIs are too weak for reliable background voice behavior in a tray-first app, especially on Linux.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: The first voice scope is Talk mode, global push-to-talk, and model-based VAD/manual wake. True keyword wake-word detection is explicitly deferred.
  Rationale: This yields a credible voice experience without letting keyword spotting complexity dominate the entire desktop project.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: The floating voice HUD in the first release is status-only and appears only during active voice interactions.
  Rationale: A permanent or transcript-editing HUD would add much more window-management complexity without being necessary for the first release.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: The first desktop voice implementation will send speech-to-text requests directly to a locally running OpenAI-compatible Parakeet v3 service and fall back to OpenAI `gpt-4o-mini-transcribe`.
  Rationale: This matches the desired runtime behavior and keeps the desktop voice path fast. The credential source of truth remains the Gateway-owned Talk and speech-to-text configuration.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: The desktop app may read Talk and speech-to-text secrets from the Gateway only through a dedicated voice-secret scope rather than through normal operator read/write access.
  Rationale: This allows the direct desktop speech-to-text model while preserving a clear privilege boundary.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: After auth, pairing, and dual-session connectivity were proven live, the next desktop milestone should be a readiness/setup surface before native Talk or Linux media capture.
  Rationale: The Voice tab is still mostly a shell, while a readiness pass can turn it into a truthful desktop surface with much less scope than full audio or media runtime work. It also de-risks both later milestones by making missing permissions, missing config, and environment limitations visible first.
  Date/Author: 2026-04-03 / Sky + Bex

- Decision: The desktop node implementation must support camera photo and video capture plus screen snapshots and screen recordings in the first Linux release.
  Rationale: A node that lacks those media paths would not feel real enough for the intended use case.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: Media policy is mixed. Screen capture may run from tray/background when the operating system and portal environment allow it. Camera capture requires the app window to be foregrounded.
  Rationale: This balances capability against the practical safety and permission differences between screen and camera access.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: Node media defaults are JPG for still photos, MP4 for camera clips and screen recordings, audio off by default, and a hard ceiling of 60 seconds for recordings.
  Rationale: These defaults match existing repository semantics, keep payloads manageable, and avoid adding privacy friction by defaulting to audio capture.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: The desktop app will reuse the existing Gateway device pairing model directly.
  Rationale: This avoids inventing a desktop-only pairing scheme and keeps the node identity flow aligned with the rest of the system.
  Date/Author: 2026-04-02 / Sky + Bex

- Decision: Guided permissions and setup flow are required in the app rather than being left to docs only.
  Rationale: A tray-first background-capable Linux desktop app with media capture, notifications, autostart, and background voice would be too fragile and opaque without a guided setup surface.
  Date/Author: 2026-04-02 / Sky + Bex

## Outcomes & Retrospective

This section will be updated at the end of each major milestone and at full completion. The starting expectation is that the first working milestone will prove the app shell and shared domain extraction before any native voice or node media work lands. If later milestones require narrowing compositor support or adjusting Linux media behavior, the changes must be recorded here and mirrored in the `Decision Log` and `Progress` sections.

## Context and Orientation

This repository currently has a native macOS app in `apps/macos`, a web-based Control UI in `ui`, the core Gateway implementation in `src/gateway`, and node and voice documentation in `docs/nodes` and `docs/platforms/mac`. The new desktop app will live in a new workspace package at `apps/desktop` and will not replace the existing macOS app or the current `ui` package during the first implementation. The initial work is additive.

The word “Gateway” in this plan means the OpenClaw WebSocket control plane already implemented in `src/gateway`. It accepts client connections, provides chat methods such as `chat.send`, session listing methods such as `sessions.list`, and node behavior via a connection whose role is `node`. The Gateway already stores Talk configuration and voice wake trigger words.

The phrase “operator connection” means a client connection used for the user-facing chat and control features. The phrase “node connection” means a device connection used to expose capabilities like camera and screen capture to the Gateway. This desktop app will maintain both kinds of connection at the same time when possible.

The phrase “Talk mode” means the continuous voice loop already documented in `docs/nodes/talk.md`: listen for speech, send the transcript to the model, wait for the response, and play the response back with speech synthesis. In this repository, Talk currently uses `chat.send` and reports state through `talk.mode`.

The phrase “voice wake” means automatic voice-triggered activation. In the first desktop release, true keyword wake-word spotting is out of scope. Instead, the app will support model-based voice activity detection, which means the runtime decides whether the microphone input contains speech-like audio, plus global push-to-talk. The Gateway-owned voice wake trigger list is still relevant because it remains the shared long-term configuration surface for later keyword wake support and because the desktop app must not invent a conflicting settings model.

The phrase “portal” means the Linux desktop broker used by Wayland applications to request privileged operations such as screen capture through `xdg-desktop-portal`. A portal-first strategy is required for screen capture because it aligns with Wayland security expectations and is the most realistic route for KDE Plasma support.

The phrase “status-only floating HUD” means a small floating window or panel that appears only during active voice interaction and only displays state such as listening, thinking, speaking, push-to-talk active, or VAD active. It does not provide transcript editing in the first release.

## Desktop Harness for AI-Agent Automation

The desktop harness exists primarily so an AI coding agent can launch the Tauri app, inspect its live state, drive a narrow set of semantic UI actions, and verify desktop behavior without pretending build success equals product success. It is a development and debugging surface first, not an end-user feature.

### Goals

- let local automation and AI agents verify the real desktop shell instead of relying only on compile-time gates
- expose stable, machine-readable state snapshots for chat, gateway, node, and local desktop settings
- provide a small set of semantic actions that map to real app behavior instead of DOM selectors or arbitrary script execution
- support quick smoke loops for desktop regressions such as startup, pairing, node status, settings persistence, and chat interactions

### Activation and trust model

The harness is intentionally hard-gated:

- available only in debug/dev builds
- disabled by default
- enabled explicitly with `OPENCLAW_DESKTOP_HARNESS=1`
- binds only to `127.0.0.1`
- accepts an optional `OPENCLAW_DESKTOP_HARNESS_PORT`
- generates a bearer token at startup and prints the loopback URL plus token to stdout
- refuses unauthenticated requests
- does not expose arbitrary code execution, shell execution, or selector-based DOM automation

This is meant to be an interrogation rig for local agent work, not a reusable remote-control channel for production builds.

### Architecture

The harness is split into a tiny Rust control plane plus a React bridge:

- Rust entrypoint: `apps/desktop/src-tauri/src/harness.rs`
- Rust startup integration: `apps/desktop/src-tauri/src/lib.rs`
- React bridge: `apps/desktop/src/hooks/useDevHarnessBridge.ts`
- App wiring: `apps/desktop/src/App.tsx`
- Agent CLI wrapper: `scripts/dev/desktop-harness.ts`

Rust owns:

- loopback HTTP listener lifecycle
- bearer-token authentication
- app/window actions that belong naturally to Tauri (`app.status`, `window.show`, `window.hide`)
- request correlation, timeout handling, and forwarding to the frontend bridge

The frontend bridge owns:

- `settings.get` / `settings.set` against the real React desktop settings state, with the Gateway token kept session-scoped rather than persisted in long-lived local storage
- `ui.snapshot` built from the same live state the UI renders
- a fixed registry of allowed semantic actions for `ui.click` and `ui.type`
- the frontend-ready handshake used by `app.status`

This split keeps the harness small and honest: Rust does not become a second application brain, and React remains the source of truth for UI state.

### Current HTTP control surface

The current harness endpoints are:

- `GET /app/status`
- `POST /window/show`
- `POST /window/hide`
- `GET /settings`
- `POST /settings`
- `GET /ui/snapshot`
- `POST /ui/click`
- `POST /ui/type`

Current semantic UI actions exposed through the bridge include:

- tab selection: `tab.chat`, `tab.voice`, `tab.settings`
- chat actions: `chat.send`, `chat.refresh`, `chat.abort`
- desktop toggle actions: `settings.toggleBackgroundVoice`, `settings.togglePushToTalk`, `settings.toggleTalk`, `settings.toggleVad`
- node actions: `node.refresh`, `node.pair`, `node.approveFirstPending`, `node.rejectFirstPending`, `node.invoke.device.info`, `node.invoke.device.status`, `node.invoke.system.notify`
- text inputs: `chat.input`, `settings.gatewayUrl`

### Snapshot contract

`ui.snapshot` is designed for automation, not aesthetics. It currently reports:

- app readiness and current tab
- desktop-local settings, including whether a session-scoped Gateway token is present
- gateway connection state and last error/event label
- chat state including session key, input contents, loading/sending flags, message count, and live-run state
- node state including node-session connectivity, label, pair status, pending request count, and invoke loading
- lists of available semantic actions and inputs so the agent can inspect the current contract cheaply

The snapshot should continue to prefer semantically stable fields over visual or layout details.

### Agent CLI workflow

The harness is wrapped by `pnpm desktop:harness`, which is intentionally optimized for AI-agent and shell automation work. It emits stable JSON and prefers semantic subcommands over raw request composition.

Current helper commands include:

- state reads: `status`, `snapshot`, `settings:get`
- direct control: `show`, `hide`, `click`, `type`, `request`
- polling: `wait-for`
- chat flow helpers: `chat:send`
- node helpers: `node:pair`, `node:approve-first`, `node:reject-first`, `node:invoke`

Example workflow:

1. start the app with `OPENCLAW_DESKTOP_HARNESS=1 pnpm dev`
2. read the printed loopback URL and token
3. export `OPENCLAW_DESKTOP_HARNESS_URL` and `OPENCLAW_DESKTOP_HARNESS_TOKEN`
4. run agent-oriented commands such as:
   - `pnpm desktop:harness -- status`
   - `pnpm desktop:harness -- wait-for --source status --path frontendReady --truthy`
   - `pnpm desktop:harness -- settings:set --gateway-url ws://127.0.0.1:18789 --gateway-token "$OPENCLAW_GATEWAY_TOKEN"`
   - `pnpm desktop:harness -- snapshot`
   - `pnpm desktop:harness -- chat:send --message "hello from harness"`
   - `pnpm desktop:harness -- node:invoke --action device.status`

### Design rules for future expansion

If the harness grows, it should still follow these rules:

- prefer semantic app actions over selectors, coordinates, or script execution
- prefer machine-readable snapshots over pretty text output
- keep the frontend bridge as the source of truth for UI state
- add new verbs only when a real automation loop needs them
- expose stable fields and stable error behavior so agent scripts do not become brittle
- keep the harness dev-only and loopback-only unless a later design explicitly revisits the trust model

### Known limitations and next useful additions

The harness currently validates the live desktop shell well enough for startup, state inspection, chat send, and node-control smoke loops, but it is not yet a full end-to-end UI driver. Notable current limitations:

- no screenshot or visual diff endpoint yet
- no tray-menu introspection contract yet
- no explicit wait helpers for message-count deltas or node pairing completion beyond generic polling
- no built-in fixture or gateway-stub mode yet

The next most useful additions are likely higher-level wait/assert helpers around chat completion, node pairing resolution, and future voice runtime phases.

The current macOS app provides the closest orientation example for the desired product shape. `apps/macos/Sources/OpenClaw/MenuBar.swift` owns the tray-first shell, `apps/macos/Sources/OpenClaw/MenuContentView.swift` shows tray actions like Voice Wake, Open Chat, and Talk Mode, `apps/macos/Sources/OpenClaw/NodeMode/MacNodeModeCoordinator.swift` establishes a node session, and `apps/macos/Sources/OpenClaw/NodeMode/MacNodeRuntime.swift` dispatches node commands. These files are reference implementations, not code to copy directly into the Tauri app.

The current `ui` package already contains a reusable TypeScript client and controller layer. `ui/src/ui/gateway.ts` handles device-authenticated Gateway connections. `ui/src/ui/controllers/agents.ts` loads `agents.list`, and `ui/src/ui/views/chat.ts` defines the existing chat state shape with session and agent picker hooks. The new desktop app should share that logic through extraction into a new common package rather than duplicating it.

The current Gateway methods that matter most for the desktop app are these:

- `agents.list` to populate the agent picker.
- `sessions.list` and `sessions.resolve` to populate the main-session-first chat flow and secondary session browsing.
- `chat.send`, `chat.abort`, and chat event subscriptions for the main chat loop.
- `talk.config` to retrieve Talk and speech-to-text configuration, optionally with secrets when the desktop client has the dedicated voice-secret scope.
- `talk.mode` to report Talk runtime phase.
- `voicewake.get`, `voicewake.set`, and `voicewake.changed` for Gateway-owned voice wake settings.

The current node media documentation defines the behavior the desktop app should preserve in the first Linux release: still photos as JPG, video clips as MP4, screen recordings as MP4, audio optional and off by default, and recordings clamped to 60 seconds.

## Plan of Work

The work begins by creating a new desktop workspace package at `apps/desktop` and adding it to `pnpm-workspace.yaml`. The Tauri shell will live under `apps/desktop/src-tauri`, while the React application will live under `apps/desktop/src`. The app must be single-instance, tray-capable, and able to run with its main window closed. The first app shell must prove the tray icon, open/focus behavior, launch-at-login wiring, persistent settings storage, and a basic settings screen that can display connection status and setup guidance.

At the same time, the existing browser-side Gateway and chat logic must be extracted from `ui` into a new shared package named `packages/desktop-core`. This package will provide a framework-agnostic TypeScript layer for Gateway connection, device identity, request/response handling, agent listing, session listing, chat state, and selected session persistence. The current `ui` package should be updated to depend on `packages/desktop-core` so the extraction is real rather than a copy. This milestone is complete only when both `ui` and `apps/desktop` can consume the shared package successfully.

Once the shared package exists, implement the operator side of the desktop app. Chat mode will use the extracted desktop core package to connect to an already-running Gateway, quietly retry from the tray when the Gateway is unavailable, and open to the `main` session by default. The agent picker will be shown in the main window. The session picker will be present but treated as secondary or advanced; the `main` session remains the default landing view. This stage must support loading history, sending messages, aborting runs, and reconnecting after failures.

After the operator chat loop works, add the node connection path. The desktop app will reuse the current Gateway device pairing model rather than inventing new setup ceremonies. The node runtime should establish its own session using role `node`, maintain presence while the app is running, and expose a baseline set of metadata and readiness information before media capture is added. The operator connection and node connection must coexist in the same process. They are separate connections with separate responsibilities, even though the same app owns both.

The next workstream adds voice. The voice runtime belongs in `apps/desktop/src-tauri` because it must continue working while the main window is closed. This runtime is responsible for invoking speech-to-text, handling the global push-to-talk shortcut, running model-based VAD/manual wake, and sending phase updates to the React UI. The desktop app will call the local OpenAI-compatible Parakeet v3 service directly for speech-to-text and fall back to OpenAI `gpt-4o-mini-transcribe` if needed. The addresses, tokens, model names, and fallback behavior must come from Gateway-owned Talk and speech-to-text configuration obtained through `talk.config` with the dedicated voice-secret scope. The desktop app must not create a parallel long-term secret store for these values in the first release.

The Talk implementation should follow the repository’s existing semantics. Talk always sends to the `main` session. The runtime must listen, decide when a user utterance is complete, send the message through the existing chat path, wait for the model response, and play the response with the configured Talk output path. It must report phase via `talk.mode`, and the React UI must show the current phase in the Voice mode screen. If Talk is enabled and the window is later closed, the runtime keeps running in the tray if background voice services are still enabled.

Global push-to-talk comes next. The shortcut is required to work globally on the primary target environment, KDE Plasma Wayland. Because shortcut behavior on Linux depends on the desktop and compositor, the implementation must explicitly test the chosen path on KDE Plasma Wayland and document the exact behavior, fallbacks, and limitations in this plan as discoveries occur. X11 should be supported only when it naturally works with the same or a narrowly adapted path. A push-to-talk session must show the status-only floating HUD only while the interaction is active. The HUD should show state such as push-to-talk active, listening, or sending, but it should not offer transcript editing in the first release.

Model-based VAD/manual wake follows. This runtime should use a speech/non-speech classifier rather than a simple RMS threshold for the first implementation. The exact model can be chosen during implementation, but it must be local to the desktop runtime rather than delegated entirely to the browser UI. VAD/manual wake may keep running in the background if the user enabled it, and both the tray and the main window must expose controls that let the user see and change that state.

Linux media capture is then added to the node runtime. Screen capture must use a portal-first path because the app is Wayland-first. The node runtime must support screenshots and screen recordings from the tray/background where the portal and desktop environment allow it. Camera capture must support both still photos and short video clips, but it must require the app to be foregrounded. The runtime must enforce the mixed policy consistently and return explicit, stable errors when a request is disallowed because the app is backgrounded or because the environment is missing a needed permission or portal capability.

Once Linux-first behavior is working, document and implement the Windows follow-up with reduced scope. The Windows phase should preserve the overall shell and chat structure but may initially omit or narrow media and voice features that are not yet validated. This plan must be updated before any Windows implementation starts so the reduced scope is explicit and testable rather than accidental.

## Concrete Steps

These commands assume the repository root is the current working directory. Replace any placeholder command with the exact command that exists at the time the corresponding milestone is implemented, and then update this section to keep it truthful.

1.  Create the desktop workspace and install dependencies.

    From the repository root:

        pnpm install

    After `apps/desktop` and the shared package exist, reinstall to pick up the new workspace entries:

        pnpm install

    Expected outcome:

        Scope: all workspace projects
        ...
        Done in <time>

2.  Run the desktop app in development mode once the Tauri package exists.

    From the repository root or from `apps/desktop`, depending on the final script wiring:

        pnpm --filter ./apps/desktop dev

    Expected outcome in the terminal:

        <desktop dev server output>
        <tauri shell output>
        Desktop app started

    Expected visible outcome:

    The tray icon appears. Opening it shows the desktop app menu. Opening the main window shows Chat, Voice, and minimal settings areas even before all features are wired.

3.  Run the shared desktop-core tests once the extraction from `ui` exists.

    From the repository root:

        pnpm test -- packages/desktop-core

    Expected outcome:

        <N> passed

4.  Run the desktop app against an already-running Gateway.

    Before starting the app, ensure the Gateway is already running in some other shell or machine. This desktop app does not own Gateway lifecycle in the first release.

    Start the desktop app and observe the connection state in the tray or settings screen.

    Expected outcome:

    If the Gateway is reachable, Chat mode opens with the `main` session selected. If the Gateway is unavailable, the app stays in the tray and retries quietly.

5.  Validate node pairing after the node connection path exists.

    With the Gateway running and the desktop app connected, inspect device pairing from the Gateway side using the existing pairing workflow and approve the node request. Then return to the desktop app.

    Expected outcome:

    The desktop app reports that node pairing succeeded, and the Gateway lists the app as a node.

6.  Validate Talk mode after the native voice runtime exists.

    Start the app, ensure the Talk and speech-to-text configuration can be read via `talk.config` with the dedicated voice-secret scope, open the Voice screen, enable Talk, and speak.

    Expected outcome:

    The app shows Talk phase changes. The utterance lands in the `main` session. The response is played back. If the local Parakeet service is unavailable, the fallback path is visible in logs and the OpenAI fallback is used.

7.  Validate global push-to-talk.

    With the main window closed but the tray app still running, hold the chosen global push-to-talk shortcut on KDE Plasma Wayland, speak, and release.

    Expected outcome:

    The status HUD appears only while the interaction is active. Releasing the shortcut sends the utterance to the `main` session. The tray and main window both reflect the active voice state.

8.  Validate model-based VAD/manual wake.

    Enable background voice services, close the main window, and speak near the device.

    Expected outcome:

    The app reacts according to the configured VAD/manual wake policy, shows HUD state only during the active interaction, and routes the resulting utterance to the `main` session.

9.  Validate node media behavior.

    From the Gateway side, invoke the relevant node commands or use the existing CLI helpers after the node runtime supports them.

    For screenshots and screen recordings, test while the app remains in the tray with the main window closed.

    For camera photo and video capture, test once with the app foregrounded and once with the app backgrounded.

    Expected outcome:

    Screen capture works from tray/background when the environment allows it. Camera capture works only when the app is foregrounded. Background camera requests fail with the explicit policy error defined during implementation.

10. Run repository validation before landing any milestone that modifies code.

From the repository root:

       pnpm check
       pnpm test
       pnpm build

If a milestone is narrower and can be verified with more targeted commands during iteration, record those commands here as they are added. Before declaring the milestone complete, update this section with the exact commands that were actually used and the observed results.

## Validation and Acceptance

The desktop app is accepted only when a human can observe each of the following behaviors, not merely when code compiles.

First, starting the development build on KDE Plasma Wayland shows a tray icon and allows the user to reopen the main window after closing it. The app remains alive in the tray, rather than quitting immediately when the window closes.

Second, when the Gateway is available, the app connects to it as an operator client, opens Chat mode to the `main` session, loads history, sends a message through `chat.send`, receives the response, and can abort an in-flight run. When the Gateway is unavailable, the app remains in the tray and retries quietly rather than crashing or exiting.

Third, after device pairing is approved through the existing Gateway pairing flow, the same desktop app instance also appears as a node and maintains that presence in parallel with the operator connection.

Fourth, Voice mode uses the Gateway-owned Talk and speech-to-text configuration retrieved through the dedicated voice-secret scope, runs Talk against the `main` session, reports `talk.mode` phase transitions, and performs direct speech-to-text requests to the local OpenAI-compatible Parakeet service with an observable fallback to OpenAI `gpt-4o-mini-transcribe` if needed.

Fifth, the global push-to-talk shortcut works on KDE Plasma Wayland with the main window closed. The status-only floating HUD appears only during the active interaction and disappears afterward.

Sixth, model-based VAD/manual wake can keep running in the background when enabled, and both the tray and the main window provide real controls for background voice state.

Seventh, node media capture works with the defined mixed policy. Screenshots and screen recordings can run from tray/background when the desktop environment allows it. Camera photo and video capture succeed only when the app is foregrounded and fail with a stable, explicit error when attempted in the background.

Eighth, login item behavior works in internal builds. Launching at login brings the app into the tray and restores the previously enabled background voice state.

Acceptance for each implementation milestone must include both automated tests where appropriate and a manual end-to-end scenario proving the user-visible behavior. This plan must be updated with exact test names, command output, and observed quirks as implementation progresses.

## Idempotence and Recovery

This work is designed to be additive. Creating `apps/desktop` and `packages/desktop-core` should not destroy or replace existing packages. Re-running dependency installation is safe. Re-running development builds is safe.

If the app cannot connect to the Gateway, it must remain alive in the tray and keep retrying quietly. That behavior is part of the intended design, not an error state that requires cleanup.

If node pairing fails or is delayed, the operator chat path must remain usable. Operator and node connections are related but separate, so failure in one must not automatically kill the other without a documented reason.

If the local Parakeet speech-to-text service is unavailable, the desktop runtime should log the failure and fall back to OpenAI `gpt-4o-mini-transcribe` if the Gateway-provided configuration allows it. If neither path is available, Voice mode should fail clearly and leave Chat mode unaffected.

If a portal-based screen capture request fails because the environment lacks the required portal support, the runtime must return a stable, explicit error, and the implementation must record that environment limitation in `Surprises & Discoveries`.

If the chosen KDE Plasma Wayland global shortcut path fails to work reliably, record the exact failure mode and either constrain support more tightly or document the fallback path in `Decision Log` before continuing. Do not silently broaden claims about Linux support.

## Artifacts and Notes

The most important repository references for this plan are listed here so a novice can orient quickly.

- Existing macOS tray shell: `apps/macos/Sources/OpenClaw/MenuBar.swift`
- Existing macOS tray actions: `apps/macos/Sources/OpenClaw/MenuContentView.swift`
- Existing macOS node coordinator: `apps/macos/Sources/OpenClaw/NodeMode/MacNodeModeCoordinator.swift`
- Existing macOS node runtime: `apps/macos/Sources/OpenClaw/NodeMode/MacNodeRuntime.swift`
- Existing browser-side Gateway client: `ui/src/ui/gateway.ts`
- Existing browser-side agents list controller: `ui/src/ui/controllers/agents.ts`
- Existing browser-side chat view state: `ui/src/ui/views/chat.ts`
- Current session protocol schema: `src/gateway/protocol/schema/sessions.ts`
- Current Talk config and mode server methods: `src/gateway/server-methods/talk.ts`
- Current voice wake server methods: `src/gateway/server-methods/voicewake.ts`
- Current node media docs: `docs/nodes/index.md`
- Current Talk docs: `docs/nodes/talk.md`
- Current voice wake docs: `docs/nodes/voicewake.md`

Short evidence snippets captured during planning:

    `ui/src/ui/gateway.ts` already includes device-authenticated Gateway connect parameters with `role`, `scopes`, and optional device signatures.

    `src/gateway/server-methods/talk.ts` already allows secret-bearing `talk.config` responses behind `operator.admin` or `operator.talk.secrets`.

    `docs/nodes/index.md` already documents JPG photo capture, MP4 clips, MP4 screen recordings, and a 60-second ceiling.

    `apps/macos/Sources/OpenClaw/NodeMode/MacNodeModeCoordinator.swift` already establishes a node session in parallel with the rest of the app using `role: "node"` and `clientMode: "node"`.

## Interfaces and Dependencies

The desktop app will introduce a new workspace package at `apps/desktop` and a new shared TypeScript package at `packages/desktop-core`.

Inside `packages/desktop-core`, define a framework-agnostic Gateway domain layer that contains at least these modules and stable responsibilities:

- A desktop Gateway client module that connects to the existing Gateway protocol, manages device identity and device token persistence, and exposes typed request and event subscription APIs.
- An agents store that loads `agents.list` and resolves the default selected agent.
- A sessions store that loads `sessions.list` and resolves the default selected session, landing on `main` by default.
- A chat controller that sends messages, aborts runs, loads history, and persists the last selected session.
- A desktop settings model for local-only runtime state such as launch-at-login, background voice enabled, Talk enabled, push-to-talk enabled, and VAD/manual wake enabled.

Inside `apps/desktop/src-tauri`, define at least these native modules and responsibilities:

- A tray manager that owns the tray icon, tray menu contents, click behavior, and main-window reopen behavior.
- A single-instance and autostart manager that ensures the app relaunches into the tray when configured to do so.
- A node runtime coordinator that maintains the node WebSocket connection, reports readiness, and exposes node commands to the Gateway.
- A media runtime that implements Linux screenshot, screen recording, camera photo capture, and camera video capture with the mixed background and foreground policy described above.
- A voice runtime coordinator that owns Talk background behavior, direct speech-to-text requests, push-to-talk, model-based VAD/manual wake, and HUD state emission.
- A permission and environment probe module that detects microphone readiness, notifications readiness, autostart readiness, portal availability, and any compositor-specific shortcut limitations.

Inside `apps/desktop/src`, define the React application and keep it intentionally small:

- `Chat` mode renders the main-session-first operator chat surface with an agent picker and a secondary or advanced session browser.
- `Voice` mode renders Talk and voice runtime state plus explicit controls for Talk, push-to-talk, and VAD/manual wake.
- `Settings` renders only the minimal setup and runtime surfaces needed in the first release: Gateway connection status, login item state, node pairing status, microphone and notifications readiness, media capability readiness, and voice background service toggles.

The desktop app must depend on the existing Gateway protocol rather than inventing new transport shapes for the first release. The required methods are `agents.list`, `sessions.list`, `sessions.resolve`, `chat.send`, `chat.abort`, `talk.config`, `talk.mode`, `voicewake.get`, `voicewake.set`, and the existing node pairing and node media command surfaces already used elsewhere in the repository.

The dedicated voice-secret scope required by this plan may reuse or extend the current `operator.talk.secrets` scope, but the final implementation must make the privilege boundary explicit and document the exact scope string in this section once it is finalized.

At the end of Milestone 1, this file was created from the design and planning work already completed. Any future revision to this plan must update every affected section, and must add a note below describing what changed and why.

- 2026-04-03: Updated the plan after live desktop auth/pairing verification. The plan now records that the desktop app connects both operator and node sessions successfully against a real locked Gateway, that the approval surface had to move from `node.pair.*` to `device.pair.*`, that the last operator-side reconnect failure was caused by metadata pinning rather than missing token plumbing, and that the next milestone is now the readiness/setup surface before native Talk.
- 2026-04-03: Updated the plan again after implementing the readiness/setup slice. The desktop app now exposes real voice-readiness checks and harness-visible setup state before native Talk, which means the next concrete milestone is the actual Talk bootstrap rather than more connection plumbing.
- 2026-04-03: Updated the plan after landing the first Talk bootstrap. The desktop app now has real gateway-backed speech synthesis and local playback, so the next voice milestone is speech-to-text/capture rather than more output scaffolding.
- 2026-04-03: Updated the plan again after landing the first STT bootstrap. The desktop app can now transcribe an audio file or fixture through the gateway media runtime, so the remaining gap is microphone capture/live interaction rather than transcription plumbing.
