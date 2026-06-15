# OpenClaw Fork Replay Ledger

This file is Bex's fork carry contract for the `openclaw-fork-replay` skill. It is intentionally shaped for `openclaw-fork-replay/scripts/impact_map.py`.

The replay unit is behavior, not old commits. Reimplement each seam against current upstream and re-prove the behavior through the runtime, config, plugin, or service surface that actually uses it.

Current replay target: `v2026.6.5`.

Replay classification:

- Runtime carries: behavior that still needs fork code on top of the target.
- Partial-overlap carries: behavior upstream partly covers, but not enough to drop the fork seam.
- Support/proof carries: replay policy, tooling, tests, or ledger structure. These are not product behavior and should not be treated as runtime seams during conflict triage.

## v2026.6.5 seam necessity review

| Seam                                      | Decision              | Importance | v2026.6.5 evidence                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wear OS voice companion                   | Runtime carry         | Critical   | Target still has no `apps/android/wear` module or shared `apps/android/audio` module. Replay carries the watch app, phone Wearable Data Layer relay, audio assembly/playback, and Wear tests.                                                                                                                                                           |
| ACP remote target-backed bridge           | Runtime carry         | Critical   | Target has adjacent ACP `cwd` and backend support, but still lacks `runtime.acp.target`, persistent binding `target` metadata, and the codex-devbox ACP verifier. The private `extensions/acpx-remote` implementation remains outside this repo.                                                                                                        |
| Gateway runtime metadata hotpath          | Partial-overlap carry | Critical   | Target has substantial plugin metadata work, but replay still carries current-snapshot reuse for registry/manifest hot paths, lifecycle-cleared package-state probes, provider auth alias cache fixes, and runtime config invalidation details.                                                                                                         |
| ACP backend alias routing                 | Runtime carry         | High       | Target resolves selected ACP agents but still does not pass the selected config agent's `runtime.acp.backend` into ACP session creation.                                                                                                                                                                                                                |
| ACP backend-managed runtime options       | Runtime carry         | High       | Target runtime capabilities expose config option keys, but not backend-managed keys. Replay keeps `managedRuntimeOptionKeys` so backend-owned controls are not redundantly written by core.                                                                                                                                                             |
| Native Codex message-tool TTS delivery    | Partial-overlap carry | High       | Target has adjacent media delivery support, but not generated TTS local-media trust or lightweight bundled channel TTS capability artifacts for transcode-aware voice-note delivery.                                                                                                                                                                    |
| Gateway message-tool history projection   | Runtime carry         | High       | Target still drops current-session `message` tool sends from client-visible history unless a silent completion or delivery mirror later flushes them. Replay carries successful-send mirroring at next user turn, normal assistant reply, and history tail while preserving raw `toolResult` rows for debug/projection callers.                         |
| Gateway main session display title        | Runtime carry         | Medium     | Target lets direct-channel `origin.label` become the primary `displayName` for canonical main sessions, so Telegram-routed main rows can appear as `telegram:<id>` in Android and other session lists instead of staying visibly main. Replay keeps origin metadata searchable but not the main row title.                                              |
| Control UI read aloud through Talk        | Partial-overlap carry | Medium     | Target has Gateway Talk/TTS, but not the browser read-aloud control path, Markdown stripping, or `talk.speak` client integration.                                                                                                                                                                                                                       |
| Discord 30032 command deploy recovery     | Runtime carry         | Medium     | Target still lacks the Discord application-command-limit recovery predicate and force-overwrite redeploy path.                                                                                                                                                                                                                                          |
| Discord auto-presence account auth store  | Runtime carry         | Medium     | Target auto-presence loads its auth store via bare `ensureAuthProfileStore()`, which resolves `resolveDefaultAgentDir({})` to the built-in `main` agent dir; with a non-`main` configured default agent the store is empty and bots pin an idle "runtime degraded" presence. Replay carries account-bound store resolution.                             |
| Google TTS volume gain                    | Runtime carry         | Medium     | Target still lacks provider-local Google `volumeGain` normalization and PCM gain before WAV, Opus, or telephony output.                                                                                                                                                                                                                                 |
| Private plugin sidecar baseline filtering | Support/proof carry   | Medium     | Target sidecar baseline generation still does not constrain collection to git-tracked bundled plugin directories.                                                                                                                                                                                                                                       |
| Exec safe-bin realpath trust              | Partial-overlap carry | Medium     | Target has adjacent exec trust hardening, but not the invariant that both the invoked symlink path and real target directory must be trusted.                                                                                                                                                                                                           |
| Docker replay validation directives       | Support/proof carry   | Medium     | Target root instructions still lack Bex's fork-replay Docker-clean broad-proof exception and private-state isolation warnings.                                                                                                                                                                                                                          |
| Codex app-server force full access        | Runtime carry         | Medium     | Target has no `OPENCLAW_CODEX_FORCE_FULL_ACCESS` toggle; native Codex app-server policy is subject to OpenClaw guardian/exec-mode/promotion/binding downgrades. Replay carries the clamp to `danger-full-access` + `never` + `user` at the resolver output, the tool-policy promotion bail, the bound thread/turn builders, and the side-question fork. |
| Generic agent base prompt                 | Runtime carry         | Medium     | Target still has no harness-neutral `agent-base.md` convention for embedded OpenClaw/full prompts or native Codex `baseInstructions`, no generated global template at startup, and no base prompt fingerprint in native Codex thread bindings.                                                                                                          |
| Android and Discord realtime audio        | Absorbed upstream     | High       | Target already carries Android Gateway Talk relay and Discord realtime voice. Replay keeps dependent Wear code and focused relay fixes only.                                                                                                                                                                                                            |
| Telegram transcribed-audio TTS intent     | Absorbed upstream     | Medium     | Target shared reply dispatch still preserves TTS intent for transcribed inbound audio. No source carry unless focused proof regresses.                                                                                                                                                                                                                  |
| Agent-scoped TTS conversion config        | Dropped               | Low        | No missing implementation was proved on v2026.6.5; no source carry.                                                                                                                                                                                                                                                                                     |
| CI replay repair guardrails               | Dropped               | Low        | The old v2026.5.18 CI repair context remains stale on v2026.6.5; no source carry.                                                                                                                                                                                                                                                                       |
| Gateway memory pressure reduction         | Runtime carry         | High       | Replay keeps session-store large-string interning and workspace skill snapshot interning, adapted to the moved `src/skills/loading/workspace.ts` path.                                                                                                                                                                                                  |

## v2026.6.5 performance patch review

- Older gateway startup/provider/model metadata patches remain absorbed or superseded by upstream. Replay carries only the still-observed hot-path and lifecycle-cache seams listed above.
- Session memory pressure remains an active carry: cached session-store clones and workspace skills snapshots intern repeated large skill prompt strings without changing serialized store shape.
- Stale CI repair guardrails and agent-scoped TTS conversion config are not carried without a current failing proof.

## v2026.5.22 seam necessity review

| Seam                                      | Decision                                     | Importance | v2026.5.22 evidence                                                                                                                                                                                            |
| ----------------------------------------- | -------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wear OS voice companion                   | Runtime carry                                | Critical   | No `:wear` or shared `:audio` module existed on the target; the port adds the watch app, phone Data Layer relay, `WearSttTtsSession`, chunked/streaming audio response handling, and packaging proof surfaces. |
| ACP remote target-backed bridge           | Runtime carry plus external plugin lifecycle | Critical   | Target ACP bindings lacked `target`, backend-specific targets, and the verifier; core carries generic `target`/`cwd` runtime options while `acpx-remote` remains a separate private plugin lifecycle.          |
| ACP backend alias routing                 | Runtime carry                                | High       | Target resolved `runtime.acp.agent` but fell back to global `acp.backend`; replay carries selected-agent `runtime.acp.backend`.                                                                                |
| ACP backend-managed runtime options       | Runtime carry                                | High       | Target runtime capabilities exposed only config option keys; replay carries `managedRuntimeOptionKeys` so backend-owned controls are not redundantly written by core.                                          |
| Gateway runtime metadata hotpath          | Runtime carry                                | Critical   | Live Gateway status polling spent about 5-7% host CPU repeatedly rediscovering plugin/config/channel metadata; replay carries prepared metadata snapshots and lifecycle-cleared hotpath caches.                |
| Native Codex message-tool TTS delivery    | Partial-overlap carry                        | High       | Target had adjacent `message_tool_only` and media delivery support, but lacked generated TTS local-media trust and lightweight channel TTS capability artifacts for transcode-aware voice-note delivery.       |
| Control UI read aloud through Talk        | Partial-overlap carry                        | Medium     | Target had Gateway Talk/TTS, but not UI read-aloud controls, markdown stripping, or browser-side `talk.speak` integration.                                                                                     |
| Discord 30032 command deploy recovery     | Runtime carry                                | Medium     | Target logged application command limit failures as ordinary deploy errors and did not force overwrite recovery.                                                                                               |
| Google TTS volume gain                    | Runtime carry                                | Medium     | Target lacked Google provider-local `volumeGain` normalization and PCM gain before WAV/Opus/telephony delivery.                                                                                                |
| Private plugin sidecar baseline filtering | Support/proof carry                          | Medium     | Target sidecar baseline generation still considered local untracked plugin directories, making replay proof environment-sensitive.                                                                             |
| Exec safe-bin realpath trust              | Partial-overlap carry                        | Medium     | Target had adjacent realpath trust, but replay keeps the stricter invariant that both invoked path and real target directories must be trusted.                                                                |
| Docker replay validation directives       | Support/proof carry                          | Medium     | Target root instructions lacked the Docker-first Bex fork replay exception to the normal Testbox/Crabbox default.                                                                                              |
| Android and Discord realtime audio        | Absorbed upstream                            | High       | v2026.5.22 already has Android `talk.session.*` Gateway relay and Discord realtime voice; replay keeps only dependent Wear proof and targeted relay fixes.                                                     |
| Telegram transcribed-audio TTS intent     | Absorbed upstream                            | Medium     | Target dispatch already preserves TTS intent for inbound/transcribed audio through the shared reply path.                                                                                                      |
| Agent-scoped TTS conversion config        | Pending/drop candidate                       | Low        | No missing implementation was visible on v2026.5.22; keep pending for live triage instead of carrying code without proof.                                                                                      |
| CI replay repair guardrails               | Pending/drop candidate                       | Low        | The v2026.5.18 CI repair context is stale on v2026.5.22; only carry future fixes if broad proof fails for the same class.                                                                                      |

## Replay impact

- `d5f0ca2e6b` - support/proof carry: keep private/non-git-tracked plugin directories out of runtime sidecar baseline collection.
- `e000c3410d` - active seam: keep ACP backend alias routing so `sessions_spawn({ runtime: "acp", agentId })` resolves the selected config agent's `runtime.acp.backend` instead of falling through to global `acp.backend`.
- `9349edd41c` - active seam: keep ACP backend-managed runtime options hidden from core runtime control writes.
- `gateway-runtime-metadata-hotpath` - active seam: keep Gateway request/status hot paths on prepared plugin metadata snapshots, lifecycle-cleared runtime config caches, cached bundled channel/package-state facts, and model-cost indexes scoped to the active manifest snapshot.
- `gateway-message-tool-history-projection` - active seam: keep successful current-session `message` tool sends visible in `chat.history` and recent-history projections even when there is no later `NO_REPLY` row or delivery mirror. Flush successful pending message-tool mirrors before the next user turn, before the next normal assistant reply, and at the history tail; preserve the successful `toolResult` rows so debug/projection clients do not lose execution evidence.
- `gateway-main-session-display-title` - active seam: keep canonical agent main sessions visibly main in `sessions.list` when their latest route/origin metadata comes from Telegram or another direct channel. Direct non-main sessions still use `entry.label`/`origin.label`, and search still finds the main row by origin label.
- `5d62565271` - support/proof carry: keep the operator verifier for target-backed remote ACP bindings, with machine/channel ids supplied by flags or environment only.
- `extensions/acpx-remote` - active seam: keep the local target-backed remote ACP bridge as a separate nested/excluded plugin lifecycle; do not fold it into the outer repo replay.
- `c5991de10f` - active seam: keep Control UI read-aloud routed through the Gateway Talk/TTS surface, with Markdown/noisy markup stripped before speech.
- `discord-deploy-30032-recovery` - active seam: keep the 30032 (application command limit) reconcile-to-overwrite recovery path that bypasses the deploy hash cache with `force: true` and logs the initial failure as recoverable instead of error.
- `discord-auto-presence-account-auth-store` - active seam: keep Discord auto-presence runtime availability evaluated against the auth profile store of the agent bound to the account (account-level route binding -> agent dir) instead of the bare default store path, which ignores the configured default agent and reads an empty `main`-agent store.
- `realtime-android-discord-audio` - absorbed upstream: v2026.5.22 already has Android Gateway relay Talk and Discord realtime voice by default; do not replay wholesale unless focused proof finds a regression.
- `wear-os-talk-relay` - active seam: keep the Wear OS push-to-talk companion app and phone-side Wearable Data Layer relay on the durable STT -> `chat.send` -> final TTS audio path, including the configured Wear target session, `deliver: true` chat routing, trusted final-audio reuse, turn ids, phone-node pinning, chunked audio response assembly, app bundle packaging, and narrow review-work proof gates.
- `02915314ae` - absorbed upstream: v2026.5.22 already preserves TTS intent for transcribed inbound audio through the shared dispatch path; no source carry unless proof fails.
- `native-codex-message-tool-tts` - partial-overlap carry: keep native Codex `message_tool_only` visible replies TTS-capable, preserve trusted local voice tool media through source-reply suppression, and keep Telegram/Discord voice-note delivery on the proper transcode-aware path instead of leaking raw WAV attachments.
- `6c4503c385` - pending/drop candidate: agent-scoped TTS conversion config was not visibly missing on v2026.5.22; keep pending for live triage instead of replaying without a failing proof.
- `google-tts-volume-gain` - active seam: keep Google Gemini TTS applying provider-local PCM `volumeGain` before WAV wrapping, voice-note Opus transcode, and telephony PCM delivery.
- `da4c5c7c34` - partial-overlap carry: keep exec safe-bin realpath trust for approved safe binaries reached through symlinks or wrapper paths.
- `ci-replay-repair-2026-05-20` - pending/drop candidate: v2026.5.22 has moved past the v2026.5.18 CI repair context; do not replay stale CI repairs unless broad proof fails for the same dependency-contract class.
- `docker-replay-validation` - support/proof carry: keep the root `AGENTS.md` Docker-first Bex fork replay directives and run fork replay, build proof, and broad tests in a clean Docker validation container before deploying to Bex's live Gateway; use host-local tests only for targeted checks that intentionally depend on Bex's local environment.
- `codex-app-server-force-full-access` - active seam: when `OPENCLAW_CODEX_FORCE_FULL_ACCESS` is set, the native Codex app-server runtime clamps to `sandbox: danger-full-access` + `approvalPolicy: never` + `approvalsReviewer: user` (unrestricted network is implied by danger-full-access at the Codex protocol level) at the resolver output, the OpenClaw tool-policy promotion bail, the bound thread/turn request builders, and the side-question fork. This defeats OpenClaw-side exec-mode/guardian/promotion/binding downgrades. Opt-in, default off; `/etc/codex/requirements.toml` is intentionally not consulted (this fork does not use it).

- `generic-agent-base-prompt` - active seam: keep the generated global `agent-base.md` template and the agent-scoped runtime override convention for embedded OpenClaw/full prompts and native Codex app-server `baseInstructions`. Gateway startup regenerates `<stateDir>/agent-base.md`; only `<agentDir>/agent-base.md` affects runtime. Codex app-server also accepts `<agentDir>/app-server-base.md` as a legacy alias when the canonical file is absent.

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
- Keep the checked-in baseline regression test on the same tracked-directory filter as the generator; otherwise local/private `extensions/*` directories can make replay proof environment-sensitive.

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
- Managed runtime option declarations are runtime option ids first, not only wire config keys. Alias-map ids such as `thinking`, `permissionProfile`, and `timeoutSeconds` before suppressing generated `session/set_config_option` writes.

### Gateway runtime metadata hotpath

Carry behavior: the Gateway must not rediscover plugin manifests, bundled channel metadata, configured channel state, package-state checkers, provider auth alias facts, or model-cost indexes on each status/config hot-path request. Startup and reload prepare the canonical plugin metadata snapshot, request-time code reuses that prepared snapshot, and any process memo that depends on plugin metadata is cleared through the plugin metadata lifecycle before reload, close prelude, or snapshot replacement.

Primary seam files:

- `src/gateway/runtime-plugin-config.ts`
- `src/gateway/server.impl.ts`
- `src/plugins/plugin-metadata-lifecycle.ts`
- `src/plugins/plugin-metadata-snapshot.ts`
- `src/plugins/plugin-registry-snapshot.ts`
- `src/plugins/plugin-registry-contributions.ts`
- `src/plugins/sdk-alias.ts`
- `src/agents/provider-auth-aliases.ts`
- `src/channels/plugins/bundled-ids.ts`
- `src/channels/plugins/configured-state.ts`
- `src/channels/plugins/package-state-probes.ts`
- `src/config/plugin-auto-enable.shared.ts`
- `src/config/plugin-auto-enable.prefer-over.ts`
- `src/config/sessions.cache.test.ts`
- `src/secrets/provider-env-vars.dynamic.test.ts`
- `extensions/whatsapp/src/shared.ts`

Primary seam tests:

- `src/gateway/runtime-plugin-config.test.ts`
- `src/config/plugin-auto-enable.prefer-over.test.ts`
- `src/channels/plugins/bundled-root-caches.test.ts`
- `src/channels/plugins/package-state-probes.test.ts`
- `src/channels/plugins/configured-state.test.ts`
- `src/plugins/plugin-metadata-snapshot.memo.test.ts`
- `src/plugins/plugin-registry-snapshot.test.ts`
- `src/plugins/plugin-registry-contributions.current-snapshot.test.ts`
- `src/agents/provider-auth-aliases.test.ts`
- `src/plugins/sdk-alias.test.ts`
- `src/secrets/provider-env-vars.dynamic.test.ts`

Rebase notes:

- Keep the hot-path invariant as prepared-facts-first, not scattered request-time caches. Runtime paths should carry provider id, model ref, channel id, plugin id, capability family, root/overlay scope, and active manifest snapshot identity forward from the loader when possible.
- Runtime config caching must include the raw config object identity, active metadata snapshot identity, relevant env fingerprint, and external official catalog fingerprint. External catalog probing is throttled with a monotonic clock, not wall-clock `Date.now()`.
- Clear all plugin-metadata-dependent process memos through `clearPluginMetadataLifecycleCaches()` before a Gateway reload loads the next lookup table. If reload fails, restore the previous current metadata snapshot state.
- Do not cache failed package-state checker resolution as a permanent absence. Missing or broken checker modules can appear after install/update and must be retried after lifecycle clear.
- Preserve deterministic prompt-cache ordering while adding indexes. Maps, plugin ids, model ids, channel ids, and cost aliases should sort before they feed model or tool payloads.
- Live proof for this seam is host-local by design because it targets Bex's managed Gateway install and host CPU profile. Build first, restart the managed Gateway, then sample CPU and file-system probes from the actual Gateway PID.

### Gateway message-tool history projection

Carry behavior: when an agent sends a current-session reply through the `message` tool, Gateway chat projections must expose a synthetic assistant text row to clients that render `chat.history`, even if the transcript ends after the successful `toolResult`, the next row is another user turn, or the next row is a normal assistant reply instead of `NO_REPLY`. The projection must still preserve successful `toolResult` rows because debug clients and direct projection callers rely on the execution record.

Primary seam files:

- `src/gateway/chat-display-projection.ts`
- `src/gateway/server.chat.gateway-server-chat.test.ts`
- `src/gateway/server-methods/server-methods.test.ts`

Primary seam tests:

- `src/gateway/server.chat.gateway-server-chat.test.ts`
- `src/gateway/server-methods/server-methods.test.ts`

Rebase notes:

- Do not rely on Telegram delivery mirrors or silent `NO_REPLY` completions as the only mirror-flush triggers. Android and other Gateway clients can ask for the current session directly, and the transcript may contain only `assistant toolCall -> toolResult` before the history window ends.
- Keep the projection transport-neutral: the behavior is keyed to successful current-session `message` tool sends, not Telegram-specific session keys, phone names, or device ids.
- Preserve `toolResult` rows when adding synthetic visible assistant mirrors. The mirror makes the agent reply readable to clients; the raw result keeps execution/debug evidence available to projection callers.
- Live proof for this seam is host-local: build, restart `openclaw-gateway.service`, then call `chat.history` for the affected session and confirm mirrored assistant text rows appear alongside the successful `toolResult` rows.

### Gateway main session display title

Carry behavior: canonical agent main sessions must keep a stable primary session-list title even when their current route, delivery context, and origin metadata point at Telegram or another direct channel. `sessions.list` should expose `displayName: "Main session"` for canonical main rows and continue to expose `origin.label` for route context and search. Synthetic heartbeat rows are maintenance sessions, so normal session lists hide them unless a caller explicitly searches for them. Direct non-main sessions still fall through to `entry.label` or `origin.label`, so channel DMs remain readable without turning the main row into a peer-id row.

Primary seam files:

- `src/gateway/session-utils.ts`
- `src/gateway/session-utils.test.ts`
- `bex-fork.md`

Primary seam tests:

- `node scripts/run-vitest.mjs src/gateway/session-utils.test.ts`

Rebase notes:

- Preserve the row distinction: canonical main keys such as `agent:<agentId>:<mainKey>` use the stable `Main session` display name after explicit `entry.displayName`/`entry.label` checks. Group/channel sessions still use `buildGroupDisplayName`, and non-main direct rows can still fall back to `origin.label`.
- Keep `origin` and delivery fields on the row. Android, Control UI, and Gateway search still need to know the last direct-channel route; the seam changes only the primary title shown for the main session.
- Do not move this into the Android app as a client-only workaround. Other clients consume `sessions.list`, and the Gateway is the owner of the row display contract.
- Live proof for this seam is host-local: build/restart the managed Gateway, call `sessions.list`, and confirm the `agent:sky:main` row has `displayName: "Main session"` while its `origin.label` remains present and `agent:sky:main:heartbeat` is absent from the default list.

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

### Discord command deploy 30032 recovery

Carry behavior: when Discord slash-command reconcile fails with 30032 (application command limit), the recovery overwrite must bypass the `DiscordCommandDeployer` hash cache with `force: true` so drifted live commands are actually replaced. The initial 30032 REST failure must be logged as recoverable (`:recoverable`) rather than error (`:error`) since the caller falls back to overwrite.

Primary seam files:

- `extensions/discord/src/monitor/provider.deploy.ts`
- `extensions/discord/src/monitor/provider.deploy-errors.ts`
- `extensions/discord/src/internal/command-deploy.ts`
- `extensions/discord/src/monitor/provider.test.ts`

Primary seam tests:

- `extensions/discord/src/monitor/provider.test.ts`
- `node scripts/run-vitest.mjs extensions/discord/src/monitor/provider.test.ts`

Rebase notes:

- The hash cache lives in `DiscordCommandDeployer.putCommandSetIfChanged()`. Normal deploys use it to avoid redundant Discord writes, but recovery overwrites must pass `force: true` or the cache can silently no-op.
- The REST wrapper in `provider.deploy.ts` must classify 30032 before emitting the `:error` log, or operators see a startup error for a self-healed path.
- Do not let upstream introduce a broader `force` option that affects non-recovery deploys unless the default behavior preserves the cache optimization.

### Discord auto-presence account auth store

Carry behavior: Discord auto-presence must evaluate runtime availability from the auth profile store of the agent bound to the Discord account, resolved via `getRuntimeConfig()` -> `resolveAgentRoute({ cfg, channel: "discord", accountId })` -> `ensureAuthProfileStore(resolveAgentDir(cfg, route.agentId))`. The previous bare `ensureAuthProfileStore()` default resolved `resolveDefaultAgentDir({})` with an empty config, landed on the built-in `main` agent dir, and read an empty store, so every account with `autoPresence.enabled` reported a permanent idle "runtime degraded" presence regardless of actual profile health.

Primary seam files:

- `extensions/discord/src/monitor/auto-presence.ts`
- `extensions/discord/src/monitor/auto-presence.test.ts`

Primary seam tests:

- `extensions/discord/src/monitor/auto-presence.test.ts`
- `node scripts/run-vitest.mjs extensions/discord/src/monitor/auto-presence.test.ts`

Rebase notes:

- The seam is `loadDiscordAccountAuthProfileStore()` in `auto-presence.ts`, used as the default `loadAuthStore` in `createDiscordAutoPresenceController`. Call sites that inject `loadAuthStore` explicitly are unaffected.
- The root cause is upstream in `src/agents/auth-profiles/path-resolve.ts`: `resolveAuthStorePath()` calls `resolveDefaultAgentDir({})` with a hardcoded empty config, so any bare `ensureAuthProfileStore()` caller ignores the configured default agent. If upstream fixes that path to honor the loaded config, this seam may relax to partial-overlap, but per-account binding resolution remains more correct than default-agent resolution for multi-account Discord setups.
- Keep the tests asserting both behaviors: an empty-profile store maps to a degraded idle presence, and the default loader resolves the account's bound agent dir.

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

### Android and Discord realtime audio

Carry behavior: Android Talk Mode discovers realtime availability from `talk.config`, starts `talk.realtime.session` with `transport: "gateway-relay"`, streams microphone PCM through relay audio calls, and falls back to legacy batch Talk only when realtime is unavailable. Discord voice channels use the same provider-backed full-duplex realtime bridge by default; `channels.discord.voice.realtime.enabled=false` is the explicit legacy batch STT/TTS escape hatch.

Primary seam files:

- `apps/android/app/src/main/java/ai/openclaw/app/voice/*Realtime*`
- `apps/android/app/src/main/java/ai/openclaw/app/voice/TalkModeGatewayConfig.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/voice/TalkModeManager.kt`
- `src/gateway/server-methods/talk.ts`
- `src/gateway/server-methods-list.ts`
- `src/gateway/protocol/schema/channels.ts`
- `src/gateway/server-broadcast.ts`
- `src/gateway/server/ws-connection.ts`
- `src/gateway/talk-realtime-relay.ts`
- `src/config/types.discord.ts`
- `src/config/zod-schema.providers-core.ts`
- `src/config/bundled-channel-config-metadata.generated.ts`
- `extensions/discord/src/config-ui-hints.ts`
- `extensions/discord/src/voice/audio.ts`
- `extensions/discord/src/voice/realtime.ts`
- `extensions/discord/src/voice/manager.ts`
- `docs/channels/discord.md`
- `docs/gateway/config-channels.md`

Primary seam tests:

- `apps/android/app/src/test/java/ai/openclaw/app/voice/RealtimeTalkRelayEventParserTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/voice/RealtimeTalkManagerAudioInjectionTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/voice/TalkModeConfigParsingTest.kt`
- `src/gateway/gateway-misc.test.ts`
- `src/gateway/protocol/index.test.ts`
- `src/gateway/server-methods/talk.test.ts`
- `src/gateway/talk-realtime-relay.test.ts`
- `extensions/discord/src/voice/manager.e2e.test.ts`
- `extensions/discord/src/voice/realtime.test.ts`

Rebase notes:

- Keep Discord realtime voice default-on. Do not preserve old disabled-by-default docs or behavior when replaying this seam.
- Keep the Gateway relay path provider-generic and protocol-visible through `talk.realtime.*`; do not introduce Discord-specific gateway RPCs.
- Keep batch Android Talk and batch Discord voice available only as fallback or explicit opt-out behavior, not as the normal Discord voice path.
- Keep relay cleanup tied to Gateway websocket lifecycle so relay sessions close when the client connection closes.
- Keep Discord receive audio decoded into the shared PCM16 24 kHz realtime contract before sending it to the provider bridge.
- When Bex asks to build the Android app without naming a flavor, build the sideloadable third-party release APK with `cd apps/android && ./gradlew :app:assembleThirdPartyRelease`; do not default to the Play flavor because the third-party flavor keeps SMS and Call Log permissions.

### Wear OS voice companion

Carry behavior: the Android app ships a Wear OS companion module for push-to-talk voice turns. The watch discovers phones advertising `openclaw_relay_phone`, pins each turn to one reachable phone node, streams 24 kHz PCM chunks over the Wearable Data Layer, and accepts only terminal audio/status/error messages for the active turn and active phone node. The phone-side relay uses buffered Gateway transcription for STT, sends the transcript through normal `chat.send` with `deliver: true` to the configured Wear target session, asks Gateway for the trusted local final TTS media generated for that same run, and only falls back to `talk.speak` when no reusable final audio is available. Gateway keeps a short-lived run-scoped final-audio registry so the watch can reuse the shared autoTTS artifact without depending on Telegram adapter output.

Session target carry behavior: this fork keeps Android node identity device-scoped for presence, pairing, and capability commands, but makes the conversation target explicit. The default `SessionTargetMode.FollowSelected` starts from the Gateway canonical main session and lets chat, phone voice, Canvas restore/actions, and Wear voice follow the currently selected phone chat session. `SessionTargetMode.Main` pins those surfaces to the Gateway canonical main session, and `SessionTargetMode.Device` preserves upstream-style per-device node session isolation. First launch with this seam clears legacy Wear-only target overrides so old `wear.targetSessionKey` values do not keep the watch pinned to a stale session; after migration, a nonblank `wear.targetSessionKey` remains an explicit override for watch turns only.

Primary seam files:

- `apps/android/app/src/main/AndroidManifest.xml`
- `apps/android/app/src/main/java/ai/openclaw/app/NodeRuntime.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/SessionKey.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/SessionTargetMode.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/SecurePrefs.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/ui/SettingsScreens.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/wear/WearAudioRelay.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/wear/WearSttTtsSession.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/wear/WearRelayService.kt`
- `apps/android/app/src/main/res/values/wear.xml`
- `apps/android/audio/build.gradle.kts`
- `apps/android/audio/src/main/java/ai/openclaw/audio/PcmAudio.kt`
- `apps/android/audio/src/main/java/ai/openclaw/audio/AndroidCompressedAudioDecoder.kt`
- `apps/android/README.md`
- `apps/android/gradle.properties`
- `apps/android/gradle/libs.versions.toml`
- `apps/android/scripts/build-release-aab.ts`
- `apps/android/settings.gradle.kts`
- `apps/android/wear/build.gradle.kts`
- `apps/android/wear/lint.xml`
- `apps/android/wear/proguard-rules.pro`
- `apps/android/wear/src/main/AndroidManifest.xml`
- `apps/android/wear/src/main/java/ai/openclaw/wear/WatchApp.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/WatchMainActivity.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/WatchViewModel.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/AudioCapture.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/AudioPlayer.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/AudioTrackFactory.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/PcmBoundarySmoother.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/AcousticAudioDebugCapture.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/PlaybackAudioDebugCapture.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/WireAudioDebugCapture.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/PhoneRelayClient.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/AudioStreamAssembler.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/BufferedAudioResponseReceiver.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/StreamingAudioResponseReceiver.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/ui/WatchFace.kt`
- `apps/android/wear/src/main/res/xml/data_extraction_rules.xml`
- `apps/android/wear/src/test/java/ai/openclaw/wear/audio/AudioPlayerTest.kt`
- `apps/android/wear/src/test/java/ai/openclaw/wear/audio/PcmBoundarySmootherTest.kt`
- `apps/android/wear/src/test/java/ai/openclaw/wear/client/AudioStreamAssemblerTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/SecurePrefsTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/SessionKeyTest.kt`
- `package.json`
- `src/gateway/chat-final-audio.ts`
- `src/gateway/talk-transcription-relay.ts`
- `src/gateway/talk-transcription-audio.ts`
- `src/gateway/server-methods/chat.ts`
- `src/gateway/gateway-misc.test.ts`
- `src/gateway/chat-final-audio.test.ts`

Primary seam tests:

- `cd apps/android && ./gradlew :app:compilePlayDebugKotlin :wear:compileDebugKotlin :app:testPlayDebugUnitTest :wear:testDebugUnitTest :app:ktlintCheck :wear:ktlintCheck`
- `node scripts/run-vitest.mjs src/gateway/chat-final-audio.test.ts src/gateway/gateway-misc.test.ts src/gateway/talk-transcription-relay.test.ts`
- `pnpm exec oxfmt --check --threads=1 apps/android/scripts/build-release-aab.ts src/gateway/gateway-misc.test.ts package.json`
- `git diff --check`

Rebase notes:

- Keep phone discovery capability-based. The watch must use `CapabilityClient.getCapability("openclaw_relay_phone", FILTER_REACHABLE)`, and the phone app must advertise the capability from `apps/android/app/src/main/res/values/wear.xml`.
- Keep each watch turn pinned to one phone node and one turn id. Do not broadcast active-turn audio to every connected phone; late status/error/audio from another node or stale turn must be ignored.
- Preserve compatibility for legacy/no-turn terminal responses only while a turn is active. Both `PhoneRelayClient` and `WatchViewModel` must treat a null response turn id as the active turn, then clear active state on terminal audio/error/incomplete chunk timeout.
- Keep chunked audio responses serialized with a done payload carrying `chunkCount`; do not emit partial audio until every expected chunk is assembled, and keep the timeout path user-visible as `Audio response incomplete`.
- Keep `Close` before transcription `Ready` user-visible on the watch instead of leaving the watch stuck in `Processing`.
- Keep `WearRelayService` as the background Wearable Data Layer entrypoint, but let the foreground `NodeRuntime` relay own messages when it is already initialized so duplicate service delivery does not double-handle a turn.
- Keep the phone-side Wear relay on the normal durable turn path. STT still uses Gateway `talk.session.*` transcription events, but assistant replies should route through `chat.send`, reusable final TTS audio, and `talk.speak` only as fallback.
- Keep mobile target-session routing generic. By default, `SessionTargetMode.FollowSelected` plus an unset `wear.targetSessionKey` makes phone voice, Canvas actions, and Wear voice follow the phone's currently selected chat session. `SessionTargetMode.Main` pins those surfaces to the Gateway canonical main session, `SessionTargetMode.Device` keeps the upstream per-device node session, and an explicit Session Target panel Wear override value overrides only watch turns. Wear code must not depend on Telegram-specific adapter internals or personal device names.
- Keep active voice turns session-stable. Phone PTT turns capture the target session at `chat.send` time, realtime Talk Mode sessions capture it at `talk.session.create` time, and Wear turns capture it at recording start. Visible chat selection may change while these are in flight, but completion events, history fallback, tool calls, and steer calls must continue using the captured session.
- Keep `chat.finalAudio.get` additive and hidden. It should expose only trusted, run-scoped local audio already produced by the chat reply pipeline, return not-found/unreadable states as fallback signals, and avoid persistent state.
- A Wear service cold start must not restore persisted phone manual mic capture. Restore that preference only from foreground/UI runtime activation.
- Wear consults and phone Talk Mode turns can overlap; pending chat completion tracking must be per `runId`, not a single shared waiter.
- Keep outbound Wear Data Layer sends bounded and node-pinned. Audio chunks may be dropped under backpressure, but control messages must still be delivered in order.
- Keep packaging proof tied to the Android release helper. The third-party phone bundle should include the Wear OS module through `bundleThirdPartyRelease`, and the script must copy the generated `.aab` without silently dropping the watch companion artifact.
- Keep the shared `:audio` module for PCM/resampling/codec helpers that both `:app` and `:wear` consume. Do not duplicate codec logic back into either module.
- Keep the `AudioStreamAssembler` + `BufferedAudioResponseReceiver`/`StreamingAudioResponseReceiver` split so the watch can switch between whole-buffer and streaming audio delivery without rewriting the relay client.
- Keep `WearSttTtsSession` as the canonical phone-side session class; do not resurrect the old `WearAudioSession` split.
- Keep the gateway-side μ-law → WAV conversion inline on the main thread (no worker spawn); the loop is tight O(n) integer math and worker overhead dominates runtime.

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

### Native Codex message-tool TTS delivery

Carry behavior: native Codex sessions that expose visible replies through `sourceVisibleReplies: "message_tool"` / `message_tool_only` must still deliver TTS correctly. Visible `message(action=send)` sends must apply final-reply TTS before gateway/plugin dispatch, trusted local voice tool media must survive source-reply suppression without leaking private final text, and synthetic auto-TTS final/audio-only replies must preserve the local-media trust signal when block streaming consumes the visible final text. Telegram/Discord voice-note delivery must stay transcode-aware so provider WAV output becomes native voice delivery instead of a plain file attachment. Channel TTS voice capabilities must be available through lightweight bundled public artifacts so the hot speech path does not materialize full channel plugins while selecting synthesis target, pre-transcode behavior, or `audioAsVoice`.

Primary seam files:

- `src/infra/outbound/message-action-runner.ts`
- `src/infra/outbound/message-action-runner.plugin-dispatch.test.ts`
- `extensions/codex/src/app-server/dynamic-tools.ts`
- `extensions/codex/src/app-server/event-projector.ts`
- `src/agents/pi-embedded-runner/run.ts`
- `src/agents/pi-embedded-runner/run/attempt.ts`
- `src/agents/pi-embedded-runner/run/tool-media-payloads.ts`
- `src/agents/pi-embedded-subscribe.ts`
- `src/auto-reply/reply/dispatch-acp.ts`
- `src/auto-reply/reply/dispatch-acp-delivery.ts`
- `src/auto-reply/reply/dispatch-from-config.ts`
- `src/auto-reply/reply/dispatch-from-config.test.ts`
- `src/auto-reply/reply/tts-trusted-media.ts`
- `src/auto-reply/reply/tts-trusted-media.test.ts`
- `extensions/telegram/src/action-runtime.ts`
- `extensions/telegram/src/send.ts`
- `extensions/telegram/src/bot/delivery.replies.ts`
- `extensions/telegram/src/voice.ts`
- `extensions/telegram/src/shared.ts`
- `extensions/telegram/src/tts-capabilities.ts`
- `extensions/telegram/tts-capabilities-api.ts`
- `extensions/discord/src/shared.ts`
- `extensions/discord/src/tts-capabilities.ts`
- `extensions/discord/tts-capabilities-api.ts`
- `extensions/feishu/src/tts-capabilities.ts`
- `extensions/feishu/tts-capabilities-api.ts`
- `extensions/matrix/src/tts-capabilities.ts`
- `extensions/matrix/tts-capabilities-api.ts`
- `extensions/whatsapp/src/tts-capabilities.ts`
- `extensions/whatsapp/tts-capabilities-api.ts`
- `extensions/speech-core/src/tts.ts`
- `extensions/speech-core/src/tts.test.ts`
- `src/channels/plugins/tts-capabilities.ts`
- `src/channels/plugins/tts-capabilities.test.ts`
- `src/plugins/bundled-plugin-metadata.test.ts`
- `src/cli/program/message/helpers.ts`

Primary seam tests:

- `src/infra/outbound/message-action-runner.plugin-dispatch.test.ts`
- `extensions/codex/src/app-server/dynamic-tools.test.ts`
- `extensions/codex/src/app-server/event-projector.test.ts`
- `src/agents/pi-embedded-runner/run/tool-media-payloads.test.ts`
- `src/auto-reply/reply/dispatch-acp.test.ts`
- `src/auto-reply/reply/dispatch-acp-delivery.test.ts`
- `src/auto-reply/reply/dispatch-from-config.test.ts`
- `src/auto-reply/reply/tts-trusted-media.test.ts`
- `extensions/telegram/src/action-runtime.test.ts`
- `extensions/telegram/src/send.test.ts`
- `extensions/telegram/src/bot/delivery.test.ts`
- `extensions/speech-core/src/tts.test.ts`
- `src/channels/plugins/tts-capabilities.test.ts`
- `src/plugins/bundled-plugin-metadata.test.ts`
- `src/cli/program/message/helpers.test.ts`
- focused native proof via `node dist/index.js message send --channel telegram ... [[tts:text]]...[[/tts:text]]`

Rebase notes:

- `v2026.5.16-beta.7` already includes adjacent native Codex message-tool/private-final and transcript-mirror protections. Keep this seam only for the still-missing pieces: trusted local voice media through `message_tool_only`, generated TTS local-media trust, voice-note transcode truth, and lightweight channel TTS capability lookup.
- Do not replay the stale upstream message-tool TTS patches blindly. Rebuild the seam against the current outbound runner, current Codex app-server telemetry shape, and current channel voice capabilities.
- The invariant is earlier than `executeSendAction`: gateway-owned/plugin-routed `send` actions must apply TTS before the gateway branch returns, not only on the core send path.
- In `message_tool_only`, keep the private final assistant text suppressed. Only trusted local voice media may bypass source-reply suppression, and only as a media-only payload.
- Preserve the trusted-media signal end to end through Codex tool telemetry, embedded attempt results, and final payload merging. Losing `trustedLocalMedia` is a functional regression, not a harmless metadata drop.
- Synthetic auto-TTS generated after block streaming is part of the same seam. When `messages.tts.mode = "final"` and block/ACP streaming leaves no normal final payload, the rebuilt media-only final reply must mark generated local/file TTS media as `trustedLocalMedia` before Telegram/Discord delivery. Do not mark remote or mixed local/remote media as trusted.
- Keep voice-note channel capabilities honest. Telegram and Discord both need transcode-aware TTS handling; if the channel can make provider output voice-compatible, advertise `transcodesAudio: true` so speech-core does not fall back to plain audio-file semantics.
- Keep channel TTS voice capability lookup on narrow public artifacts such as `tts-capabilities-api.js`, not `getChannelPlugin`. The speech-core request path may resolve the delivery fact once and reuse it, but must not cross the full bundled channel plugin loader to answer target/pre-transcode/`audioAsVoice` decisions.
- Keep Telegram voice sends able to repair non-voice-compatible audio locally before `sendVoice`, and re-prove both the direct send path and the bot reply-delivery path.
- Keep CLI `message send` preloading the scoped channel plugin for gateway-owned sends when plugin routing needs it, but do not depend on that preload for speech-core TTS capability truth. Missing lightweight artifacts can make speech-core miss channel TTS capabilities and synthesize WAV `audio-file` output that never reaches the voice/transcode branch.
- Re-prove the seam after replay with both focused tests and a live Telegram smoke after build/restart. The important failure signature is a delivered `voice-*.wav` attachment instead of a native voice message.

### Agent-scoped TTS conversion config

Carry behavior: TTS conversion resolves the selected agent's scoped config instead of using only global/default config.

Primary seam files:

- `src/gateway/server-methods/tts.ts`
- `src/gateway/server-methods/tts.test.ts`

Primary seam tests:

- `src/gateway/server-methods/tts.test.ts`

Rebase notes:

- Upstream provider/TTS/Talk registration has changed materially across releases. Re-prove agent-scoped conversion against the current server method shape.

### Google TTS volume gain

Carry behavior: Google Gemini TTS applies a provider-local PCM `volumeGain` after synthesis and before audio leaves the provider. The fork default is `1.2`, and the same boosted PCM must feed WAV attachments, voice-note Opus transcoding, and Talk/telephony PCM.

Primary seam files:

- `extensions/google/speech-provider.ts`
- `extensions/google/speech-provider.test.ts`
- `docs/tools/tts.md`

Primary seam tests:

- `extensions/google/speech-provider.test.ts`

Rebase notes:

- Keep this local to the Google provider unless a generic speech-core gain seam lands upstream. Do not rely on Gemini prompt wording as the only volume control.
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

- `v2026.5.16-beta.7` already resolves safe-bin trust through a realpath-first helper shape. Treat this as a partial-overlap seam: preserve the trust invariant and tests, but prefer upstream's current helper contract over the older fork call shape.
- Upstream added fs-safe primitives, exec argument allowlist hardening, dotenv/system-path trust blocking, and Windows fallback guards. Keep the realpath invariant while fitting the current safety model.
- The safe condition lives in the current upstream trust helper: both the invoked path directory and resolved target directory must satisfy safe-bin trust when a realpath exists.

### CI replay repair guardrails

Carry behavior: the fork replay branch must keep CI proof aligned with the current v2026.5.18 fork dependency contracts. Node-based CI jobs need fs-safe's Python helper in `auto` mode so pinned-write tests exercise the intended hardened path instead of failing with `helper-unavailable`. Replay also keeps stale version guardrails current for the checked-in dependency graph, and keeps WebChat mixed media normalization preserving surviving display media without adding a failure warning unless all media was dropped.

Primary seam files:

- `.github/actions/setup-node-env/action.yml`
- `scripts/control-ui-i18n.ts`
- `src/commands/status.summary.redaction.test.ts`
- `src/gateway/server-methods/chat-reply-media.ts`
- `test/scripts/root-package-overrides.test.ts`

Primary seam tests:

- `node scripts/run-vitest.mjs src/commands/status.summary.redaction.test.ts`
- `OPENCLAW_FS_SAFE_PYTHON_MODE=auto node scripts/run-vitest.mjs src/gateway/server-methods/chat-reply-media.test.ts`
- `OPENCLAW_FS_SAFE_PYTHON_MODE=auto node scripts/run-vitest.mjs src/media/audio-transcode.test.ts src/media/store.test.ts src/media/fetch.test.ts src/tui/tui-last-session.test.ts`
- `OPENCLAW_FS_SAFE_PYTHON_MODE=auto node scripts/run-vitest.mjs src/commitments/commitments-full-chain.integration.test.ts src/commitments/extraction.test.ts src/commitments/runtime.test.ts src/commitments/store.test.ts`
- `node scripts/run-vitest.mjs src/scripts/control-ui-i18n.test.ts test/scripts/root-package-overrides.test.ts`
- `node scripts/run-tsgo.mjs -p test/tsconfig/tsconfig.core.test.json --incremental --tsBuildInfoFile .artifacts/tsgo-cache/core-test.tsbuildinfo`
- `git diff --check`

Rebase notes:

- Do not merge `upstream/main` just to pick up CI repairs for this fork lane. Apply only the repair behavior that belongs on top of `v2026.5.18` plus Bex fork seams.
- Keep `OPENCLAW_FS_SAFE_PYTHON_MODE=auto` in the shared Node setup action so broad CI shards that use fs-safe pinned writes behave like the focused proof commands.
- Keep `DEFAULT_PI_PACKAGE_VERSION` aligned with the root `@earendil-works/pi-coding-agent` dependency, and keep the Bedrock runtime override guard aligned with `pnpm-workspace.yaml`.
- If `extensions/openrouter/provider-routing.ts` is absent in the v2026.5.18 fork lane, do not recreate it just to carry an upstream lint cleanup. That cleanup belongs only when the OpenRouter provider-routing file exists on the replay target.

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

- This is support/proof policy, not product runtime behavior. Keep it as a replay guardrail, but do not let it inflate runtime conflict triage.
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
- `node scripts/run-vitest.mjs src/gateway/runtime-plugin-config.test.ts src/config/sessions.cache.test.ts src/agents/provider-auth-aliases.test.ts src/channels/plugins/package-state-probes.test.ts src/plugins/plugin-metadata-snapshot.memo.test.ts src/plugins/plugin-registry-snapshot.test.ts src/plugins/plugin-registry-contributions.current-snapshot.test.ts src/plugins/sdk-alias.test.ts`
- `pnpm build && pnpm ui:build`
- `openclaw gateway restart && openclaw gateway status --deep`
- `./scripts/verify-codex-devbox-acp.js --help`
- `pnpm test ui/src/ui/chat/grouped-render.test.ts ui/src/ui/chat/talk-tts.test.ts ui/src/ui/chat/strip-markdown-for-speech.test.ts`
- `pnpm test src/gateway/server-methods/talk.test.ts src/gateway/talk-realtime-relay.test.ts src/gateway/protocol/index.test.ts`
- `pnpm test src/gateway/gateway-misc.test.ts src/gateway/server-methods/talk.test.ts src/gateway/talk-realtime-relay.test.ts src/gateway/protocol/index.test.ts extensions/discord/src/voice/realtime.test.ts extensions/discord/src/voice/manager.e2e.test.ts`
- `node scripts/run-vitest.mjs extensions/discord/src/monitor/auto-presence.test.ts`
- `node scripts/run-vitest.mjs extensions/codex/src/app-server/config.test.ts extensions/codex/src/app-server/app-server-policy.test.ts extensions/codex/src/conversation-binding.test.ts extensions/codex/src/app-server/side-question.test.ts`
- `pnpm android:test`
- `cd apps/android && ./gradlew :app:compilePlayDebugKotlin :wear:compileDebugKotlin :app:testPlayDebugUnitTest :wear:testDebugUnitTest`
- `pnpm config:channels:check`
- `pnpm tsgo:test:ui`
- `pnpm docs:check-mdx docs/web/control-ui.md`
- `pnpm test src/auto-reply/reply/dispatch-from-config.test.ts`
- `pnpm test src/gateway/server-methods/tts.test.ts`
- `pnpm test src/infra/exec-safe-bin-trust.test.ts src/infra/exec-approvals-safe-bins.test.ts`
- `node scripts/run-vitest.mjs src/commands/status.summary.redaction.test.ts`
- `OPENCLAW_FS_SAFE_PYTHON_MODE=auto node scripts/run-vitest.mjs src/gateway/server-methods/chat-reply-media.test.ts`
- `OPENCLAW_FS_SAFE_PYTHON_MODE=auto node scripts/run-vitest.mjs src/media/audio-transcode.test.ts src/media/store.test.ts src/media/fetch.test.ts src/tui/tui-last-session.test.ts`
- `OPENCLAW_FS_SAFE_PYTHON_MODE=auto node scripts/run-vitest.mjs src/commitments/commitments-full-chain.integration.test.ts src/commitments/extraction.test.ts src/commitments/runtime.test.ts src/commitments/store.test.ts`
- `node scripts/run-vitest.mjs src/scripts/control-ui-i18n.test.ts test/scripts/root-package-overrides.test.ts`
- `node scripts/run-tsgo.mjs -p test/tsconfig/tsconfig.core.test.json --incremental --tsBuildInfoFile .artifacts/tsgo-cache/core-test.tsbuildinfo`
- `pnpm test:docker:local:all`
- `pnpm test:docker:all`
- `pnpm tsgo:core`
- `pnpm tsgo:core:test`
- `git diff --check`
- `pnpm check:changed`

## Deferred live proof

- `./scripts/verify-codex-devbox-acp.js` needs the private `extensions/acpx-remote/` lifecycle, live Gateway state, and local Discord binding credentials.
- Host-local Gateway, private-plugin, and credential-backed live checks run after clean Docker proof only when explicitly needed.

### Gateway memory pressure reduction

Carry behavior: repeated session-store clones and workspace skill snapshots should share identical large skill prompt strings so long-running Gateway sessions do not multiply the same prompt text across many active sessions.

Primary seam files:

- `src/config/sessions/store-cache.ts`
- `src/config/sessions.cache.test.ts`
- `src/skills/loading/workspace.ts`

Primary seam tests:

- `src/config/sessions.cache.test.ts`

Rebase notes:

- The workspace skill loader moved to `src/skills/loading/workspace.ts` on v2026.6.5; carry interning at the snapshot boundary there, not in the old agents skills path.
- Keep serialization behavior unchanged. Interning should reduce duplicate string instances, not alter the session-store JSON contract.

### Native Codex force full access

Carry behavior: setting `OPENCLAW_CODEX_FORCE_FULL_ACCESS=1` makes the native Codex app-server run fully unsandboxed — `sandbox: danger-full-access`, `approvalPolicy: never`, `approvalsReviewer: user`, with unrestricted network (implied by danger-full-access at the Codex protocol level, with no separate network flag). The clamp defeats every OpenClaw-side downgrade vector: guardian/requirements-aware resolution, `tools.exec.mode` forcing, the `never -> untrusted` tool-policy promotion, and persisted per-conversation binding overrides. Opt-in, default off. `/etc/codex/requirements.toml` is intentionally not consulted (this fork does not use it; Codex would enforce a requirements lockdown server-side if one were present).

Primary seam files:

- `extensions/codex/src/app-server/config.ts` (`isCodexAppServerForcedFullAccess`, `clampCodexAppServerRuntimeToFullAccess`, resolver-output clamp)
- `extensions/codex/src/app-server/app-server-policy.ts` (promotion bail)
- `extensions/codex/src/conversation-binding.ts` (`buildThreadRequestRuntimeOptions` + `runBoundTurn` per-turn guards)
- `extensions/codex/src/app-server/side-question.ts` (side-fork policy guard)

Primary seam tests:

- `extensions/codex/src/app-server/config.test.ts`
- `extensions/codex/src/app-server/app-server-policy.test.ts`
- `extensions/codex/src/conversation-binding.test.ts`
- `extensions/codex/src/app-server/side-question.test.ts`
- `node scripts/run-vitest.mjs extensions/codex/src/app-server/config.test.ts extensions/codex/src/app-server/app-server-policy.test.ts extensions/codex/src/conversation-binding.test.ts extensions/codex/src/app-server/side-question.test.ts`

Rebase notes:

- `resolveCodexAppServerRuntimeOptions` is the single chokepoint; the clamp must stay the last writer on its output. The promotion bail, the two bound-flow request builders, and the side-question fork are independent downgrade vectors that each re-derive policy after the clamp (post-resolver mutation or persisted binding), so each keeps its own guard keyed off `isCodexAppServerForcedFullAccess`.
- Reuse the existing `readBooleanEnv` truthiness contract; do not add a second env parser.
- Codex hard-gate: re-verify the wire values against sibling `../codex` on each upstream bump — `sandbox: "danger-full-access"` (SandboxMode), `sandboxPolicy: { type: "dangerFullAccess" }` (v2 SandboxPolicy), `approvalPolicy: "never"` (AskForApproval); danger-full-access implies full network with no separate flag.
- Do not add `requirements.toml` handling unless the fork starts using it.

### Generic agent base prompt

Carry behavior: Gateway startup regenerates the latest-code generic base prompt template at `<stateDir>/agent-base.md`, normally `~/.openclaw/agent-base.md`. That file is documentation/template only. Runtime activates the custom base prompt only when the resolved agent directory contains `agent-base.md`, normally `<stateDir>/agents/<agentId>/agent/agent-base.md`. Agent files are user-owned and must never be created or overwritten by startup. Embedded OpenClaw full/main runs use the exact file text as the cache-stable prefix and append live Workspace, Messaging, Assistant Output Directives, Silent Replies, Voice/TTS, Runtime, heartbeat, memory, skills, and workspace context below the cache boundary. Native Codex app-server sends the exact file text as `thread/start.baseInstructions`, keeps `developerInstructions` limited to operational app-server mechanics, fingerprints the file contents in the binding sidecar, and starts a new Codex thread when the fingerprint changes. Resume must preserve the stored fingerprint and must not patch base instructions onto an existing thread.

Codex compatibility: `<agentDir>/app-server-base.md` remains a Codex-only legacy alias when `<agentDir>/agent-base.md` is absent. Gateway may keep regenerating `<stateDir>/app-server-base.md` as a legacy template alias pointing users to `agent-base.md`, but global templates remain inert until copied into an agent directory.

Agent-owned prompt hygiene: Bex's live Sky override at `~/.openclaw/agents/sky/agent/agent-base.md` is intentionally user-owned and not committed in this repo. Keep it aligned with the generated template's stable sections only. Do not keep generated/runtime sections such as Model Aliases, Current Date & Time, Assistant Output Directives, Silent Replies, Messaging, Workspace, Runtime, Voice/TTS, memory, skills, heartbeat, or workspace context in that file. Those are injected by the harness below the cache boundary. Sky's local file was updated after this seam landed to remove stale model aliases (`gpt-5.4`, `gpt-5.4-mini`, `gemini-3.1-pro-preview`), remove current-time/output/silent-reply sections, and use the runtime-neutral Tooling wording plus anti-polling guidance.

Primary seam files:

- `src/agents/agent-base-prompt.ts`
- `src/agents/agent-base-prompt-file.ts`
- `src/agents/codex-app-server-base-prompt.ts`
- `src/agents/system-prompt.ts`
- `src/agents/embedded-agent-runner/run/attempt.ts`
- `src/agents/embedded-agent-runner/system-prompt.ts`
- `src/gateway/server.impl.ts`
- `extensions/codex/src/app-server/protocol.ts`
- `extensions/codex/src/app-server/session-binding.ts`
- `extensions/codex/src/app-server/thread-lifecycle.ts`
- `extensions/codex/src/app-server/attempt-startup.ts`
- `extensions/codex/src/app-server/run-attempt.ts`
- `extensions/codex/src/conversation-binding.ts`

Primary seam tests:

- `src/agents/codex-app-server-base-prompt.test.ts`
- `src/agents/system-prompt.test.ts`
- `src/agents/embedded-agent-runner/run/attempt-system-prompt.test.ts`
- `src/gateway/gateway.test.ts`
- `extensions/codex/src/app-server/thread-lifecycle.test.ts`
- `extensions/codex/src/app-server/run-attempt.test.ts`
- `extensions/codex/src/app-server/run-attempt.context-engine.test.ts`
- `extensions/codex/src/conversation-binding.test.ts`
- `node scripts/run-vitest.mjs src/agents/codex-app-server-base-prompt.test.ts src/agents/system-prompt.test.ts src/agents/embedded-agent-runner/run/attempt-system-prompt.test.ts`
- `node scripts/run-vitest.mjs extensions/codex/src/app-server/thread-lifecycle.test.ts extensions/codex/src/app-server/run-attempt.test.ts extensions/codex/src/app-server/run-attempt.context-engine.test.ts extensions/codex/src/conversation-binding.test.ts`
- `node scripts/run-vitest.mjs src/gateway/gateway.test.ts`

Rebase notes:

- The generated template should use the canonical OpenClaw prompt renderer plus the GPT-5/OpenAI/Codex overlay, but suppress workspace/project context files, `TOOLS.md` guidance, memory contents, skills, heartbeat, Messaging, Workspace, Runtime, Voice/TTS, Assistant Output Directives, Silent Replies, current time, and user-owned context file contents.
- Do not dynamically append overlay text to an agent-scoped `agent-base.md`; the file is the complete stable base prefix. Runtime/context mechanics stay outside the file and are appended by the harness.
- Keep global templates inert. They only become runtime behavior after a user copies one into an agent directory.
- `pi` is only a legacy alias normalized to `openclaw`; do not add a separate Pi runtime path for this seam.
- Conversation-bound Codex threads created before an agent base file exists are still OpenClaw-managed. Persist a managed no-base marker so adding `agent-base.md` later clears the old binding and starts a fresh thread with `baseInstructions`. Preserve explicit external `/codex resume` bindings by marking them `baseInstructionsSource: "external-thread"` and never rotating them for agent base changes.
- Context-engine thread-bootstrap projection must be decided against the effective native thread state. If a base prompt fingerprint change will rotate the native Codex thread, project bootstrap context as if there is no existing thread; otherwise a fresh thread can be persisted with bootstrap metadata while missing the actual bootstrap prompt.
- Cache-hygiene smoke: render `~/.openclaw/agent-base.md` and `~/.openclaw/app-server-base.md` after startup and assert no hits for `OPENCLAW_CACHE_BOUNDARY`, Messaging, Workspace, Runtime, Voice/TTS, Assistant Output Directives, Silent Replies, Current Date & Time, skills, memory, heartbeat, `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, or `MEMORY.md`.
- Codex hard-gate: re-verify `thread/start.baseInstructions` and resume override behavior against sibling `../codex` on each upstream bump.

Closeout proof from the implementation pass:

- Focused validation: `node scripts/run-vitest.mjs src/agents/codex-app-server-base-prompt.test.ts src/agents/system-prompt.test.ts src/agents/embedded-agent-runner/run/attempt-system-prompt.test.ts extensions/codex/src/app-server/thread-lifecycle.test.ts extensions/codex/src/app-server/run-attempt.test.ts extensions/codex/src/app-server/run-attempt.context-engine.test.ts extensions/codex/src/conversation-binding.test.ts src/gateway/gateway.test.ts`
- Docs/format/build: `pnpm docs:check-mdx`, `git diff --check`, `pnpm build`.
- Review loop: `.agents/skills/autoreview/scripts/autoreview --mode local --engine codex` clean after fixing two accepted findings; `$ultra-review` found no additional blocking/actionable issues.
- Deployment: `openclaw-gateway.service` stopped, `pnpm build` passed, requested `pnpm ui:rebuild` was unavailable in this checkout, supported `pnpm ui:build` passed, gateway restarted.
- Runtime proof: `/healthz` returned `200 OK`; `/readyz` remained `503` only because configured dependency `whatsapp` was failing, unrelated to this seam.
