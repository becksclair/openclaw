# OpenClaw Fork Replay Ledger

This file is Bex's fork carry contract for the `openclaw-fork-replay` skill. It is intentionally shaped for `openclaw-fork-replay/scripts/impact_map.py`.

The replay unit is behavior, not old commits. Reimplement each seam against current upstream and re-prove the behavior through the runtime, config, plugin, or service surface that actually uses it.

Current replay target: `v2026.5.6`.

## Replay impact

- `d5f0ca2e6b` - active seam: keep private/non-git-tracked plugin directories out of runtime sidecar baseline collection.
- `e000c3410d` - active seam: keep ACP backend alias routing so `sessions_spawn({ runtime: "acp", agentId })` resolves the selected config agent's `runtime.acp.backend` instead of falling through to global `acp.backend`.
- `9349edd41c` - active seam: keep ACP backend-managed runtime options hidden from core runtime control writes.
- `5d62565271` - active seam: keep the operator verifier for target-backed remote ACP bindings, with machine/channel ids supplied by flags or environment only.
- `extensions/acpx-remote` - active seam: keep the local target-backed remote ACP bridge as a separate nested/excluded plugin lifecycle; do not fold it into the outer repo replay.
- `c5991de10f` - active seam: keep Control UI read-aloud routed through the Gateway Talk/TTS surface, with Markdown/noisy markup stripped before speech.
- `realtime-talk-agent-instructions` - active seam: keep Control UI realtime Talk scoped to the active agent and keep provider realtime instructions embedding that agent's `SOUL.md`, `IDENTITY.md`, `USER.md`, and selected TTS persona guidance.
- `realtime-android-discord-audio` - active seam: keep Android Talk Mode on the Gateway realtime relay when available, and keep Discord voice channels on the same full-duplex provider-backed realtime path by default.
- `heartbeat-event-wake-interval` - active seam: keep event/action heartbeat wakes from postponing the next phase-aligned interval heartbeat.
- `02915314ae` - active seam: keep Telegram transcribed-audio TTS intent through the reply path.
- `6c4503c385` - active seam: keep agent-scoped TTS conversion config resolution.
- `da4c5c7c34` - active seam: keep exec safe-bin realpath trust for approved safe binaries reached through symlinks or wrapper paths.
- `docker-replay-validation` - active seam: keep the root `AGENTS.md` Docker-first Bex fork replay directives and run fork replay, build proof, and broad tests in a clean Docker validation container before deploying to Bex's live Gateway; use host-local tests only for targeted checks that intentionally depend on Bex's local environment.

## Seam inventory

### Private plugin sidecar baseline filtering

Carry behavior: generated runtime sidecar baselines and drift checks must only consider git-tracked bundled plugin directories, so locally linked/private plugin repositories do not poison generated path baselines.

Primary seam files:

- `scripts/generate-runtime-sidecar-paths-baseline.ts`
- `scripts/lib/tracked-bundled-plugin-dirs.d.mts`
- `scripts/lib/tracked-bundled-plugin-dirs.mjs`
- `src/plugins/runtime-sidecar-paths-baseline.ts`
- `src/plugins/bundled-plugin-metadata.test.ts`
- `test/scripts/tracked-bundled-plugin-dirs.test.ts`

Primary seam tests:

- `src/plugins/bundled-plugin-metadata.test.ts`
- `test/scripts/tracked-bundled-plugin-dirs.test.ts`
- `pnpm runtime-sidecars:check`

Rebase notes:

- Do not replay generated sidecar baseline files blindly. Regenerate baselines from the current tree and verify that excluded/private plugin directories remain outside the collected bundled-plugin set.
- Treat `extensions/acpx-remote/` and `extensions/memory-maintenance/` as local/private lifecycles when they are present through local excludes, nested repos, or symlinks.

### ACP backend alias routing

Carry behavior: `sessions_spawn({ runtime: "acp", agentId })` resolves the named config agent, uses `runtime.acp.agent` as the ACP harness id, and uses `runtime.acp.backend` as the ACP backend id with global `acp.backend` only as fallback.

Primary seam files:

- `src/agents/acp-spawn.ts`
- `src/agents/acp-spawn.test.ts`

Primary seam tests:

- `src/agents/acp-spawn.test.ts`

Rebase notes:

- Upstream has changed Codex app-server, ACP runtime planning, dynamic tool progress, and channel-visible command replies across releases. Reimplement the alias mapping on the current ACP control-plane shape; do not cherry-pick old call paths.

### ACP backend-managed runtime options

Carry behavior: ACP backends can declare runtime option keys that they own, and core runtime controls skip those keys instead of writing stale or duplicate config into the session plan.

Primary seam files:

- `src/acp/runtime/types.ts`
- `src/acp/control-plane/manager.runtime-controls.ts`
- `src/acp/control-plane/manager.test.ts`

Primary seam tests:

- `src/acp/control-plane/manager.test.ts`

Rebase notes:

- Keep this as a generic ACP runtime capability. Do not hard-code `codex-devbox`, `acpx-remote`, provider names, or extension ids into core.
- Direct `setSessionConfigOption` behavior is a separate lifecycle policy; this seam only controls generated runtime controls/session planning.

### ACP remote target-backed bridge

Carry behavior: OpenClaw can keep the top-level ACP agent generic, such as `codex`, while binding-level ACP config selects the remote execution target and working directory. `acpx-remote` materializes the private target-specific delegate session at runtime and deploys/uses the Codex ACP bridge from native Codex ChatGPT subscription auth when the public ACP agent is `codex`, including Discord/Telegram-bound session routing proof.

Primary seam files:

- `scripts/verify-codex-devbox-acp.js`
- `extensions/acpx-remote`
- `src/acp/control-plane/manager.core.ts`
- `src/acp/control-plane/runtime-options.ts`
- `src/acp/persistent-bindings.lifecycle.ts`
- `src/acp/persistent-bindings.types.ts`
- `src/channels/plugins/acp-configured-binding-consumer.ts`
- `src/config/zod-schema.agents.ts`
- `src/config/zod-schema.agent-runtime.ts`
- `docs/tools/acp-agents.md`
- `CONTINUITY.md`
- `NOTES.md`

Primary seam tests:

- `scripts/verify-codex-devbox-acp.js`
- `src/acp/control-plane/manager.test.ts`
- `src/acp/persistent-bindings.test.ts`
- `src/acp/persistent-bindings.lifecycle.test.ts`
- `src/channels/plugins/acp-bindings.test.ts`

Rebase notes:

- `extensions/acpx-remote/` is locally excluded and must be verified as its own lifecycle. Do not treat it as an ordinary in-tree plugin.
- Do not restore top-level `codex-*` OpenClaw agents for each host. The clean configured shape is one top-level OpenClaw ACP agent, usually `codex`, with `bindings[].acp.backend: "acpx-remote"`, `bindings[].acp.target`, and `bindings[].acp.cwd` selecting the remote host/workspace per conversation.
- Keep the generated target-specific `codex-<target>-<hash>` id private to `acpx-remote`'s ACPX delegate. It is an implementation detail, not an OpenClaw config agent.
- Core ACP runtime support must stay generic: `target` is a bounded runtime option and a binding/runtime default, not an `acpx-remote` or Codex-specific core path.
- The Codex bridge deployment decision belongs to `acpx-remote` and keys off the public requested ACP agent (`codex`) before dynamic materialization, not off configured `codex-*` agents.
- The verifier must keep live machine, account, channel, and token values out of repo files. Supply them through flags, environment, or local secret stores only.
- Fully live Discord proof requires a non-bot user or separate bot account because the OpenClaw bot drops its own messages for loop prevention.

### Control UI read aloud through Talk

Carry behavior: Control UI read-aloud uses the Gateway Talk/TTS surface and strips Markdown/noisy markup before speech so browser chat can speak assistant output without creating a parallel provider path.

Primary seam files:

- `docs/web/control-ui.md`
- `ui/src/ui/app-render.ts`
- `ui/src/ui/app-view-state.ts`
- `ui/src/ui/app.ts`
- `ui/src/ui/views/chat.ts`
- `ui/src/ui/chat/grouped-render.ts`
- `ui/src/ui/chat/grouped-render.test.ts`
- `ui/src/ui/chat/strip-markdown-for-speech.ts`
- `ui/src/ui/chat/strip-markdown-for-speech.test.ts`
- `ui/src/ui/chat/talk-tts.ts`
- `ui/src/ui/chat/talk-tts.test.ts`

Primary seam tests:

- `ui/src/ui/chat/grouped-render.test.ts`
- `ui/src/ui/chat/strip-markdown-for-speech.test.ts`
- `ui/src/ui/chat/talk-tts.test.ts`
- `pnpm tsgo:test:ui`
- `pnpm docs:check-mdx docs/web/control-ui.md`

Rebase notes:

- Upstream introduced a unified `src/talk/*` runtime, Talk gateway sessions, Talk events, and browser realtime client changes. Port this seam as a thin current-Talk integration, not as a parallel legacy TTS flow.
- Current `TalkSpeakParamsSchema` is strict and does not accept `agentId`; do not send stale UI-side agent scope unless the Gateway protocol grows that field.

### Realtime Talk agent instructions

Carry behavior: Control UI realtime Talk must start with an agent-scoped session key for the active assistant, and Gateway realtime provider instructions must embed the selected agent's `SOUL.md`, `IDENTITY.md`, `USER.md`, and selected TTS persona delivery guidance before provider-specific realtime sessions are created.

Primary seam files:

- `src/realtime-voice/realtime-instructions.ts`
- `src/realtime-voice/realtime-instructions.test.ts`
- `src/tts/realtime-persona-instructions.ts`
- `src/tts/realtime-persona-instructions.test.ts`
- `src/gateway/server-methods/talk.ts`
- `src/gateway/server-methods/talk.test.ts`
- `src/agents/workspace.ts`
- `src/agents/workspace.test.ts`
- `ui/src/ui/app.ts`
- `ui/src/ui/app.talk.test.ts`
- `ui/src/ui/session-key.ts`

Primary seam tests:

- `pnpm test src/agents/workspace.test.ts src/realtime-voice/realtime-instructions.test.ts src/realtime-voice/agent-consult-tool.test.ts src/tts/realtime-persona-instructions.test.ts src/gateway/server-methods/talk.test.ts ui/src/ui/app.talk.test.ts ui/src/ui/realtime-talk.test.ts`
- `pnpm tsgo:core`
- `pnpm tsgo:core:test`
- `pnpm tsgo:test:ui`
- `pnpm ui:build`

Rebase notes:

- Re-prove the complete instruction string shape, including `<SOUL.md>`, `<IDENTITY.md>`, and `<USER.md>` blocks separated by `---` before realtime and persona guidance.
- Preserve fully scoped agent session keys such as `agent:sky:discord:direct:708530820616552498` when starting realtime Talk; do not collapse them back to `main`.
- Keep realtime providers generic. Provider implementations should receive only the opaque `instructions` string, not agent ids, workspace paths, or provider-specific persona prose.
- Keep mutable TTS persona selection flowing through the existing TTS resolver and `messages.tts.personas`; do not duplicate canonical persona prose into `talk.providers.*`.

### Android and Discord realtime audio

Carry behavior: Android Talk Mode discovers realtime availability from `talk.config`, starts `talk.realtime.session` with `transport: "gateway-relay"`, streams microphone PCM through relay audio calls, and falls back to legacy batch Talk only when realtime is unavailable. Discord voice channels use the same provider-backed full-duplex realtime bridge by default; `channels.discord.voice.realtime.enabled=false` is the explicit legacy batch STT/TTS escape hatch.

Primary seam files:

- `apps/android/app/src/debug/AndroidManifest.xml`
- `apps/android/app/src/debug/java/ai/openclaw/app/DebugAudioTraceReceiver.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/NodeRuntime.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/voice/*Realtime*`
- `apps/android/app/src/main/java/ai/openclaw/app/voice/RealtimeAudioTrace.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/voice/TalkModeGatewayConfig.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/voice/TalkModeManager.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/voice/RealtimeAudioPlayerTest.kt`
- `src/gateway/server-methods/talk.ts`
- `src/gateway/server-methods-list.ts`
- `src/gateway/method-scopes.ts`
- `src/gateway/protocol/index.ts`
- `src/gateway/protocol/schema/channels.ts`
- `src/gateway/protocol/schema/protocol-schemas.ts`
- `src/gateway/protocol/schema/types.ts`
- `src/gateway/server-broadcast.ts`
- `src/gateway/server/ws-connection.ts`
- `src/gateway/talk-realtime-relay.ts`
- `src/realtime-voice/session-runtime.ts`
- `src/config/types.discord.ts`
- `src/config/zod-schema.providers-core.ts`
- `src/config/bundled-channel-config-metadata.generated.ts`
- `extensions/discord/src/config-ui-hints.ts`
- `extensions/discord/src/voice/audio.ts`
- `extensions/discord/src/voice/realtime.ts`
- `extensions/discord/src/voice/manager.ts`
- `extensions/google/realtime-voice-provider.ts`
- `docs/channels/discord.md`
- `docs/gateway/config-channels.md`
- `docs/gateway/protocol.md`

Primary seam tests:

- `apps/android/app/src/test/java/ai/openclaw/app/voice/RealtimeAudioPlayerTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/voice/RealtimeTalkRelayEventParserTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/voice/RealtimeTalkManagerAudioInjectionTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/voice/TalkModeConfigParsingTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/voice/TalkModeManagerTest.kt`
- `src/gateway/gateway-misc.test.ts`
- `src/gateway/protocol/index.test.ts`
- `src/gateway/server-methods/talk.test.ts`
- `src/gateway/talk-realtime-relay.test.ts`
- `extensions/discord/src/voice/manager.e2e.test.ts`
- `extensions/discord/src/voice/realtime.test.ts`
- `extensions/google/realtime-voice-provider.test.ts`

Rebase notes:

- Keep Discord realtime voice default-on. Do not preserve old disabled-by-default docs or behavior when replaying this seam.
- Keep the Gateway relay path provider-generic and protocol-visible through `talk.realtime.*`; do not introduce Discord-specific gateway RPCs.
- Keep `talk.realtime.relayUserMessage` as a relay-owned text-turn path for debug/manual Android injection and providers that support text user messages; unsupported providers should fail explicitly instead of silently dropping the turn.
- Keep relay audio broadcasts targeted and non-lossy. Do not use `dropIfSlow` for provider audio chunks; a truly slow targeted client should be closed by the Gateway broadcaster rather than receiving a silently corrupted audio stream.
- Keep Android provider playback ordered, generation-scoped, and mark-aware: queued audio, clear events, drain waits, and relay marks must not cross stopped or cleared realtime sessions.
- Keep Android realtime playback jitter buffering and PCM boundary smoothing local to the Android playback seam; do not push provider-specific timing hacks into Gateway relay or provider code.
- Keep Android debug trace and audio/text injection under the debug source set. The production app may expose internal methods used by debug builds, but the exported broadcast receiver and trace controls must stay debug-only.
- Keep Google Live interrupted output from leaking stale audio after `serverContent.interrupted`; fresh audio may resume only after the provider reports turn completion.
- Keep Discord provider output behind a bounded queue that respects stream backpressure, restarts idle/destroyed raw streams, and drops queued output on provider clear.
- Keep batch Android Talk and batch Discord voice available only as fallback or explicit opt-out behavior, not as the normal Discord voice path.
- Keep relay cleanup tied to Gateway websocket lifecycle so relay sessions close when the client connection closes.
- Keep Discord receive audio decoded into the shared PCM16 24 kHz realtime contract before sending it to the provider bridge.
- When Bex asks to build the Android app without naming a flavor, build the sideloadable third-party release APK with `cd apps/android && ./gradlew :app:assembleThirdPartyRelease`; do not default to the Play flavor because the third-party flavor keeps SMS and Call Log permissions.

### Heartbeat event wake interval preservation

Carry behavior: targeted event/action heartbeat wakes count as real heartbeat runs, but they must not postpone an already scheduled phase-aligned interval heartbeat. Frequent cron or event wakes that arrive just before the interval slot must not starve the normal `HEARTBEAT.md` check.

Primary seam files:

- `src/infra/heartbeat-runner.ts`
- `src/infra/heartbeat-runner.scheduler.test.ts`

Primary seam tests:

- `src/infra/heartbeat-runner.scheduler.test.ts`

Rebase notes:

- Preserve the existing future `agent.nextDueMs` when an event/action wake completes before the interval slot. Only recompute the next phase-aligned interval when the stored slot is already due or past.
- Do not reintroduce `now + agent.intervalMs` for non-interval wakes; that was the starvation bug for frequent next-heartbeat cron/event wakes.
- Keep interval wakes phase-aligned through `computeNextHeartbeatPhaseDueMs` and `seekActiveSlotForAgent`.

### Telegram transcribed-audio TTS intent

Carry behavior: Telegram voice/audio transcripts preserve the user's TTS/read-aloud intent through the reply path, including cases where inbound media was already transcribed before reply dispatch.

Primary seam files:

- `src/auto-reply/reply/dispatch-from-config.ts`
- `src/auto-reply/reply/dispatch-from-config.test.ts`

Primary seam tests:

- `src/auto-reply/reply/dispatch-from-config.test.ts`

Rebase notes:

- Upstream changed Telegram streaming previews, final reply edits, transcript gap-fill, and visible embedded final replies. Re-prove this through the current transcript-to-TTS path after replay.
- Prefer current media/transcription indexes over Telegram-specific sentinels when deciding whether a reply came from inbound audio.

### Agent-scoped TTS conversion config

Carry behavior: TTS conversion resolves the selected agent's scoped config instead of using only global/default config.

Primary seam files:

- `src/gateway/server-methods/tts.ts`
- `src/gateway/server-methods/tts.test.ts`

Primary seam tests:

- `src/gateway/server-methods/tts.test.ts`

Rebase notes:

- Upstream provider/TTS/Talk registration has changed materially across releases. Re-prove agent-scoped conversion against the current server method shape.
- Preserve channel/account scope when forwarding conversion requests into config resolution and provider synthesis.

### Exec safe-bin realpath trust

Carry behavior: safe-bin trust accepts the resolved realpath of an approved safe binary when symlinks or wrapper paths point at the trusted target, while still requiring the invoked path directory to be trusted.

Primary seam files:

- `src/infra/exec-safe-bin-trust.ts`
- `src/infra/exec-safe-bin-trust.test.ts`
- `src/infra/exec-approvals-allowlist.ts`
- `src/infra/exec-approvals-safe-bins.test.ts`

Primary seam tests:

- `src/infra/exec-safe-bin-trust.test.ts`
- `src/infra/exec-approvals-safe-bins.test.ts`

Rebase notes:

- Upstream added fs-safe primitives, exec argument allowlist hardening, dotenv/system-path trust blocking, and Windows fallback guards. Keep the realpath invariant while fitting the current safety model.
- The safe condition is conjunctive when a realpath exists: both the invoked path directory and resolved target directory must satisfy safe-bin trust.

### Docker replay validation directives

Carry behavior: root `AGENTS.md` must keep the Docker-first directives for Bex fork replay. Fork replay execution, build proof, broad unit tests, changed gates, and Docker/local E2E lanes should run inside a clean Docker validation container before changes are deployed to Bex's live Gateway. The container must not mount Bex's real `~/.openclaw`, private plugin install records, credentials, Gateway state, or host session data unless a proof explicitly requires those local resources. Host-local commands are reserved for narrow debugging loops and live checks that intentionally target Bex's environment, such as private plugin runtime wiring, Gateway status, Discord-bound ACP verifier work, or credential-backed live smoke tests.

Primary seam files:

- `AGENTS.md`
- `CLAUDE.md`
- `bex-fork.md`

Primary seam tests:

- `pnpm test:docker:local:all`
- `pnpm test:docker:all`
- clean-container build proof for `pnpm build`, `pnpm check:changed`, and broad `pnpm test` before deploy
- host-local targeted proof only when the check intentionally depends on Bex's local environment

Rebase notes:

- Treat removal or softening of the root `AGENTS.md` Docker validation directives as a dropped seam. They are mandatory replay policy, not incidental local instructions.
- Keep `CLAUDE.md` as the repo-local mirror/symlink of `AGENTS.md` so Claude-family agents receive the same Docker-first replay constraints.
- Do not use Bex's host `~/.openclaw` as the default broad-test environment. If broad replay validation fails only because the host carries private plugin state, move the proof into the clean Docker validation container instead of patching unrelated tests to accommodate local state.
- Keep the external `openclaw-fork-replay` skill instructions aligned with this Docker-first proof model.
- Prefer Docker validation over Testbox for Bex fork replay. Testbox is an upstream/OpenClaw maintainer lane, not the default Bex fork replay lane.
- After Docker build/test proof passes, deploy or restart the live Gateway only when explicitly requested and only after noting any live-session risk.
- Keep Bex-owned custom extensions separate: push and install those repos when the replay depends on them, but do not push, fork, or republish third-party plugins unless Bex explicitly asks for that plugin.

## Narrow validation set

- `pnpm test src/plugins/bundled-plugin-metadata.test.ts test/scripts/tracked-bundled-plugin-dirs.test.ts`
- `pnpm runtime-sidecars:check`
- `pnpm test src/agents/acp-spawn.test.ts`
- `pnpm test src/acp/control-plane/manager.test.ts`
- `./scripts/verify-codex-devbox-acp.js --help`
- `pnpm test ui/src/ui/chat/grouped-render.test.ts ui/src/ui/chat/talk-tts.test.ts ui/src/ui/chat/strip-markdown-for-speech.test.ts`
- `pnpm test src/agents/workspace.test.ts src/realtime-voice/realtime-instructions.test.ts src/realtime-voice/agent-consult-tool.test.ts src/tts/realtime-persona-instructions.test.ts src/gateway/server-methods/talk.test.ts ui/src/ui/app.talk.test.ts ui/src/ui/realtime-talk.test.ts`
- `pnpm test src/gateway/server-methods/talk.test.ts src/gateway/talk-realtime-relay.test.ts src/gateway/protocol/index.test.ts`
- `pnpm test src/gateway/gateway-misc.test.ts src/gateway/server-methods/talk.test.ts src/gateway/talk-realtime-relay.test.ts src/gateway/protocol/index.test.ts extensions/discord/src/voice/realtime.test.ts extensions/discord/src/voice/manager.e2e.test.ts`
- `pnpm test src/gateway/talk-realtime-relay.test.ts src/gateway/server-methods/talk.test.ts src/infra/heartbeat-runner.scheduler.test.ts extensions/google/realtime-voice-provider.test.ts extensions/discord/src/voice/realtime.test.ts extensions/discord/src/voice/manager.e2e.test.ts`
- `pnpm android:test`
- `pnpm config:channels:check`
- `pnpm tsgo:test:ui`
- `pnpm ui:build`
- `pnpm docs:check-mdx docs/web/control-ui.md`
- `pnpm test src/auto-reply/reply/dispatch-from-config.test.ts`
- `pnpm test src/gateway/server-methods/tts.test.ts`
- `pnpm test src/infra/exec-safe-bin-trust.test.ts src/infra/exec-approvals-safe-bins.test.ts`
- `pnpm test:docker:local:all`
- `pnpm test:docker:all`
- `pnpm tsgo:core`
- `pnpm tsgo:core:test`
- `git diff --check`
- `pnpm check:changed`

## Deferred live proof

- `./scripts/verify-codex-devbox-acp.js` needs the private `extensions/acpx-remote/` lifecycle, live Gateway state, and local Discord binding credentials.
- Host-local Gateway, private-plugin, and credential-backed live checks run after clean Docker proof only when explicitly needed.
