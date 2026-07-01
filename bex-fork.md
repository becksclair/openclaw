# OpenClaw Fork Replay Ledger

This file is Bex's fork carry contract for the `openclaw-fork-replay` skill. It is intentionally shaped for `openclaw-fork-replay/scripts/impact_map.py`.

The replay unit is behavior, not old commits. Reimplement each seam against current upstream and re-prove the behavior through the runtime, config, plugin, or service surface that actually uses it.

Current replay target: `v2026.6.11-beta.1`.

Replay classification:

- Runtime carries: behavior that still needs fork code on top of the target.
- Partial-overlap carries: behavior upstream partly covers, but not enough to drop the fork seam.
- Support/proof carries: replay policy, tooling, tests, or ledger structure. These are not product behavior and should not be treated as runtime seams during conflict triage.

## v2026.6.11-beta.1 seam necessity review

Replayed from fork head `0fc81306a2` (base `v2026.6.10`) onto upstream `v2026.6.11-beta.1` (`c862a644bf`). 79 commits replayed; none went empty (all carried). Eight commits needed conflict resolution: the squashed seam bundle (`apps/android/app/build.gradle.kts` compileSdk 36 + ndkVersion, `extensions/google/speech-provider.ts` volume gain over upstream `synthesizeConfiguredGoogleTts`, `extensions/telegram/.../delivery.replies.ts` voice/react imports), and seven `:app`/extension follow-ups reconciling the fork's session-key threading and chat reconciliation against upstream's new `ChatSendAck` send-path refactor. Net fork footprint matches the prior head exactly (423 files). All 29 replayed runtime seams verified present in the rebased tree (file:line evidence); no replayed seam was lost. Two post-review bug-fix seams are also recorded below for the next fork carry: forced heartbeat tool construction and Lobster workspace cwd sandboxing.

| Seam                                      | Decision              | Importance | v2026.6.11-beta.1 evidence / replay note                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | --------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wear OS voice companion                   | Runtime carry         | Critical   | `apps/android/wear` + `apps/android/audio` modules still absent upstream; full module + phone relay carried. `:app` build pins `compileSdk = 37` (fork bump over upstream's 36, required by the `CINNAMON_BUN`/API-37 context-aware DnsResolver in `GatewayDiscovery.kt`; `:wear` already 37, `targetSdk` stays 36) plus the additive `ndkVersion = "29.0.14206865"`. 1.5x default TTS gain, rotary control, and state-gated keep-screen-awake preserved.                                |
| ACP remote target-backed bridge           | Runtime carry         | Critical   | Target still lacks per-agent `runtime.acp.target` extraction + codex-devbox verifier; `resolveTargetAcpAgentId` returns `target`/`backendId` and threads through spawn→manager. `extensions/acpx-remote` stays a private external lifecycle.                                                                                                                                                                                                                                             |
| Gateway runtime metadata hotpath          | Runtime carry         | Critical   | Env fingerprint + monotonic external-catalog throttle still absent upstream; carried on the current snapshot.                                                                                                                                                                                                                                                                                                                                                                            |
| ACP backend alias routing                 | Runtime carry         | High       | Per-agent backend extracted and forwarded into manager init (`acp-spawn.ts`); carried.                                                                                                                                                                                                                                                                                                                                                                                                   |
| ACP backend-managed runtime options       | Runtime carry         | High       | `managedRuntimeOptionKeys` type field + manager `unmanagedConfigOptions` filter still absent upstream; carried.                                                                                                                                                                                                                                                                                                                                                                          |
| Native Codex message-tool TTS delivery    | Partial-overlap carry | High       | `prepareTelegramVoiceMedia` + `audioAsVoice` threading carried; reconciled over upstream's `richMessages`-opt-in text-send and `message-action-runner` refactor.                                                                                                                                                                                                                                                                                                                         |
| Gateway message-tool history projection   | Runtime carry         | High       | Mirror-flush (`mirrorMessageToolVisibleReplies`) carried over upstream `readMessagingText`.                                                                                                                                                                                                                                                                                                                                                                                              |
| Gateway main session display title        | Runtime carry         | Medium     | Canonical-main display override (`session-utils.ts`) still absent upstream; carried.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Gateway main session direct delivery      | Runtime carry         | Medium     | Direct-main delivery-route guard (`server-methods/chat.ts`) still absent upstream; carried.                                                                                                                                                                                                                                                                                                                                                                                              |
| Notification heartbeat wakes              | Runtime carry         | Medium     | `notifications-event` wake bypass still absent upstream; carried with main-session routing, quiet HEARTBEAT policy, consecutive posted-summary wake dedupe, and SystemUI charging-noise filtering.                                                                                                                                                                                                                                                                                       |
| Forced heartbeat tool construction        | Runtime carry         | Medium     | Explicit `toolsAllow` runs can filter out `heartbeat_respond` even when the run forces heartbeat delivery. Carry `forceHeartbeatTool` through embedded attempt allowlist merging and construction planning so heartbeat replies remain available for empty or plugin-only allowlists.                                                                                                                                                                                                    |
| Lobster workspace cwd sandbox             | Runtime carry         | Medium     | Lobster tool calls used the Gateway process cwd as their sandbox root and rejected all absolute cwd values, so workspace-scoped calls could run in the wrong directory or fail when callers supplied the active workspace path. Carry workspace-rooted cwd resolution from the tool context while still rejecting paths outside the active workspace.                                                                                                                                    |
| Reply session init burst serialization    | Runtime carry         | High       | Telegram/direct bursts can start several same-session reply initializers before any one commits session metadata. Carry per-store/per-session initialization queueing before snapshot reads so concurrent turns reuse the winning session id instead of tripping the guarded metadata commit with `reply session initialization conflicted`.                                                                                                                                             |
| Persistent Codex memory recall            | Runtime carry         | High       | Active Memory hidden recall needs low-latency Codex/OpenAI execution without leaking hidden turns into visible session hooks, Honcho, TTS, skills, MCP servers, Codex plugins, or stale native thread context. Carry the fresh-per-recall native session, warm Codex app-server client, memory-recall prompt profile, trusted fast-mode inheritance, bounded trace instrumentation, and custom memory-tool preservation across Codex/Copilot sibling harnesses.                          |
| Lossless transcript-wedge rebootstrap     | Runtime carry         | High       | `lossless-claw` must recover terminal transcript wedges by persisting a per-conversation projection reset generation and folding it into the existing `thread_bootstrap` epoch hash. The public epoch shape stays `summary-prefix-v1:<conversationId>:<hash>` while a proven wedge forces OpenClaw's Codex app-server binding compatibility path to rotate the backend thread and inject Lossless's rich compacted context once.                                                         |
| Lossless Active Memory recall expansion   | Runtime carry         | High       | `lossless-claw` delegated expansion for Active Memory recall reuses stable child sessions for continuity, but scopes the stable key by caller, conversation, sorted summary ids, token cap, message-expansion mode, and depth. Each run still refreshes grant/context/idempotency bindings, clears grant/context state afterward, and non-Active-Memory expansion sessions remain disposable and deleted.                                                                                |
| Control UI read aloud through Talk        | Partial-overlap carry | Medium     | Browser `talk-tts.ts` read-aloud surface still absent upstream; thin current-Talk integration carried.                                                                                                                                                                                                                                                                                                                                                                                   |
| Discord 30032 command deploy recovery     | Runtime carry         | Medium     | `isDiscordDeployCommandLimit` recovery still absent; carried.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Discord auto-presence account auth store  | Runtime carry         | Medium     | Account-bound auth-store resolution still absent; carried.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Google TTS volume gain                    | Runtime carry         | Medium     | `applyPcm16VolumeGain` re-applied over upstream's refactored `synthesizeConfiguredGoogleTts` at both `synthesize` and `synthesizeTelephony` call sites.                                                                                                                                                                                                                                                                                                                                  |
| Private plugin sidecar baseline filtering | Support/proof carry   | Medium     | git-tracked bundled-plugin baseline filtering still absent; carried.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Plugin SDK package-boundary artifacts     | Support/proof carry   | Medium     | `.boundary-dts.stamp` stale-DTS detection carried alongside upstream's entry-shim outputs.                                                                                                                                                                                                                                                                                                                                                                                               |
| Exec safe-bin realpath trust              | Partial-overlap carry | Medium     | Dual-path (symlink + realpath) trust invariant carried on the current trust helper.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Docker replay validation directives       | Support/proof carry   | Medium     | Root `AGENTS.md` Docker-clean broad-proof + private-state isolation directives carried.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Codex app-server force full access        | Runtime carry         | Medium     | `OPENCLAW_CODEX_FORCE_FULL_ACCESS` clamp carried; merged onto upstream's network-proxy + fast-mode runtime shape.                                                                                                                                                                                                                                                                                                                                                                        |
| Generic agent base prompt                 | Runtime carry         | Medium     | `agent-base.md` convention + Codex `baseInstructions` carried.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Context-rich realtime Talk tools          | Partial-overlap carry | Medium     | `voice` tool profile, `talk.realtime.tools`, realtime direct tools/context carried; new `src/talk/realtime-*.ts` applied.                                                                                                                                                                                                                                                                                                                                                                |
| Android and Discord realtime audio        | Partial-overlap carry | High       | Fork keeps Wear-dependent relay + setup-code/operator-scope fixes over upstream Android base. Operator-session connect-with-bootstrap-auth behavior reconciled onto upstream's renamed `resolveOperatorSessionConnectAuth`.                                                                                                                                                                                                                                                              |
| Android phone chat bubble width           | Runtime carry         | Low        | `CHAT_SCREEN_BUBBLE_WIDTH_FRACTION = 0.85f` + `ChatScreenLayoutTest` carried; upstream still used narrow role-specific caps.                                                                                                                                                                                                                                                                                                                                                             |
| Wear OS native assistant entrypoint       | Runtime carry         | Medium     | No Wear native assistant shape upstream; mirrored `:app`/`:wear` assistant layer carried.                                                                                                                                                                                                                                                                                                                                                                                                |
| Gateway doctor source-checkout warning    | Runtime carry         | Low        | Source-checkout warning in `src/commands/doctor-gateway-services.ts` is disabled unconditionally; fork runs the gateway from a source checkout intentionally.                                                                                                                                                                                                                                                                                                                            |
| Telegram transcribed-audio TTS intent     | Absorbed upstream     | Medium     | No source carry; intent preserved by upstream's `message-action-runner` dispatch.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Agent-scoped TTS conversion config        | Drop candidate        | Low        | No missing implementation on `v2026.6.11-beta.1`; no source carry.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CI replay repair guardrails               | Pending triage        | Low        | Reclassified from drop candidate: the 7 `fix(ci)` commits did NOT go empty this replay. They carry Wear CI/CodeQL matrix wiring (needed by the carried Wear module), a device-pairing runtime refactor (`src/infra/device-pairing*.ts`), and an `undici` override + lockfile pin (`pnpm-workspace.yaml` undici@7=7.28.0 / undici@8=8.5.0). Established fork state (already on `0fc81306a2`); preserved. The undici override is an existing fork dependency contract, not a new addition. |
| Gateway memory pressure reduction         | Runtime carry         | High       | Session-store + workspace skill-snapshot interning (`src/skills/loading/workspace.ts`) carried.                                                                                                                                                                                                                                                                                                                                                                                          |

## v2026.6.10-beta.2 seam necessity review

Replayed from fork head `f2b94c3a56` (base `v2026.6.8`) onto upstream `v2026.6.10-beta.2` (`87b40c7160`). 62 commits replayed; one base-specific CI-repair commit went empty and was dropped.

| Seam                                      | Decision              | Importance | v2026.6.10-beta.2 evidence / replay note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------- | --------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wear OS voice companion                   | Runtime carry         | Critical   | Target still has no `apps/android/wear` or `apps/android/audio` module; full module + phone relay carried. Merged upstream Android settings-by-intent + mic foreground-service changes into the `:app` files. Wear playback applies local assistant-response TTS gain, defaults to the existing 1.5x loudness, and exposes watch-local rotary control for media volume or persisted TTS gain without changing provider artifacts. The watch app keeps the screen fully awake while waiting/listening/error-visible, but allows normal dimming during response processing and playback. |
| ACP remote target-backed bridge           | Runtime carry         | Critical   | Target still lacks `runtime.acp.target`, persistent-binding `target`, and the codex-devbox verifier. `extensions/acpx-remote` stays a private external lifecycle.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Gateway runtime metadata hotpath          | Runtime carry         | Critical   | Target absorbed snapshot-fingerprint dead code but still lacks the env fingerprint + monotonic external-catalog throttle; carried on top of current snapshot.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ACP backend alias routing                 | Runtime carry         | High       | `resolveTargetAcpAgentId` still returns no `backendId`; carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ACP backend-managed runtime options       | Runtime carry         | High       | `AcpRuntimeCapabilities` still lacks `managedRuntimeOptionKeys`; carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Native Codex message-tool TTS delivery    | Partial-overlap carry | High       | TTS scoping + voice-note transcode seam carried. Telegram text-send conflicts resolved toward upstream's `richMessages`-opt-in rewrite, which supersedes the fork's older rich→HTML migration.                                                                                                                                                                                                                                                                                                                                                                                         |
| Gateway message-tool history projection   | Runtime carry         | High       | Target still drops current-session `message` sends from history without a later mirror; fork mirror-flush + alias-aware `resolveMessagingToolSendText` carried over upstream's `readMessagingText`.                                                                                                                                                                                                                                                                                                                                                                                    |
| Gateway main session display title        | Runtime carry         | Medium     | `session-utils.ts` still has no canonical-main display override; carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Gateway main session direct delivery      | Runtime carry         | Medium     | `chat.ts` still lacks the direct-main delivery-route guard; carried (newest fork seam).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Notification heartbeat wakes              | Runtime carry         | Medium     | `notifications-event` wake bypass still absent upstream; carried with main-session routing, explicit global-scope agent preservation, notification-owned prompt/queue filtering, and quiet HEARTBEAT policy judgment.                                                                                                                                                                                                                                                                                                                                                                  |
| Control UI read aloud through Talk        | Partial-overlap carry | Medium     | Browser `talk-tts.ts` read-aloud surface still absent upstream; carried as a thin current-Talk integration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Discord 30032 command deploy recovery     | Runtime carry         | Medium     | `isDiscordDeployCommandLimit` recovery still absent; carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Discord auto-presence account auth store  | Runtime carry         | Medium     | Account-bound auth-store resolution still absent; carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Google TTS volume gain                    | Runtime carry         | Medium     | Google provider `volumeGain` still absent; standalone carry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Private plugin sidecar baseline filtering | Support/proof carry   | Medium     | git-tracked bundled-plugin filtering still absent; carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Plugin SDK package-boundary artifacts     | Support/proof carry   | Medium     | `channel-contract-testing` stale-DTS detection carried alongside upstream's entry-shim outputs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Exec safe-bin realpath trust              | Partial-overlap carry | Medium     | Dual-path (symlink + realpath) trust invariant carried on the current trust helper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Docker replay validation directives       | Support/proof carry   | Medium     | Root `AGENTS.md` Docker-clean broad-proof + private-state isolation directives carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Codex app-server force full access        | Runtime carry         | Medium     | `OPENCLAW_CODEX_FORCE_FULL_ACCESS` clamp carried; wire values re-verified against sibling `../codex@aaf737fa59` (`DangerFullAccess` / `Never` / `baseInstructions` present). Merged onto upstream's network-proxy + fast-mode runtime shape.                                                                                                                                                                                                                                                                                                                                           |
| Generic agent base prompt                 | Runtime carry         | Medium     | `agent-base.md` convention + Codex `baseInstructions` carried; merged onto upstream's `requestNewConversationBindingThread` + `recreateBoundThreadForTurn` helpers (added `baseInstructions` param + `agentId`).                                                                                                                                                                                                                                                                                                                                                                       |
| Context-rich realtime Talk tools          | Partial-overlap carry | Medium     | `voice` tool profile, `talk.realtime.tools`, realtime direct tools/context carried; target has the Talk relay base but not these. New `src/talk/realtime-*.ts` applied cleanly.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Android and Discord realtime audio        | Partial-overlap carry | High       | Target carries the Android/Discord realtime base; fork keeps Wear-dependent relay + setup-code/operator-scope fixes only. Reconciled with upstream Android settings/mic-foreground changes.                                                                                                                                                                                                                                                                                                                                                                                            |
| Android phone chat bubble width           | Runtime carry         | Low        | Full-screen Android `ChatScreen` must keep persisted and streaming chat bubbles at 85% of the row width. Target still used narrow role-specific caps (`0.64f` user / `0.56f` assistant), which made phone chat bubbles look cramped. Carry `CHAT_SCREEN_BUBBLE_WIDTH_FRACTION = 0.85f` plus `ChatScreenLayoutTest`; deploy proof used the third-party release APK on SM_S948B.                                                                                                                                                                                                         |
| Wear OS native assistant entrypoint       | Runtime carry         | Medium     | No Wear native assistant shape upstream; mirrored `:app`/`:wear` assistant layer carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Telegram transcribed-audio TTS intent     | Absorbed upstream     | Medium     | No source carry; target shared reply dispatch still preserves transcribed-audio TTS intent. Telegram delivery text conflicts resolved toward upstream's `message-action-runner` refactor.                                                                                                                                                                                                                                                                                                                                                                                              |
| Agent-scoped TTS conversion config        | Drop candidate        | Low        | No missing implementation on `v2026.6.10-beta.2`; no source carry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CI replay repair guardrails               | Drop candidate        | Low        | Base-specific CI repairs resolved toward upstream; the recent fork CI cluster is obsolete on a base that already carries upstream's CI work. One commit went empty.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Gateway memory pressure reduction         | Runtime carry         | High       | Session-store + workspace skill-snapshot interning carried at `src/skills/loading/workspace.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### v2026.6.10-beta.2 packaging decision (resolved)

Upstream deleted `apps/android/scripts/build-release-aab.ts` and migrated Android release to Fastlane lanes. The Wear OS companion AAB is now folded into upstream's Fastlane archive build (`android:release:archive` -> `play_store_archive` -> `apps/android/scripts/build-release-artifacts.ts`), which builds the Play AAB, third-party APK, and `:wear:bundleRelease` AAB (`openclaw-<version>-wear-release.aab`) in one pass. `build-release-aab.ts` and the redundant `android:bundle:release` script are deleted. The `:wear` module now reads the canonical version from `Config/Version.properties` (same as `:app`) instead of a hardcoded `versionCode`/`versionName`, so Fastlane version sync covers the watch artifact. Release tooling only; does not affect Gateway runtime. The Fastlane upload lanes still upload only the Play AAB (third-party APK and Wear AAB stay build-only, matching prior behavior); routing the Wear AAB into the Play upload via `supply` `aab_paths` is a separate, untested distribution decision left open.

### Android release build and signing (evergreen ops)

Build all three signed release artifacts (Play AAB, third-party APK, Wear AAB) with the canonical archive helper:

```bash
JAVA_HOME=<jdk21> ANDROID_HOME=<android-sdk> bun apps/android/scripts/build-release-artifacts.ts
# this host: JAVA_HOME=/usr/lib/jvm/java-21-openjdk ANDROID_HOME=/home/bex/Android/Sdk
```

Output (signature-verified + SHA-256 checksummed) lands in the gitignored `apps/android/build/release-artifacts/`: `openclaw-<version>-play-release.aab`, `openclaw-<version>-third-party-release.apk`, `openclaw-<version>-wear-release.aab`. Version is resolved from `apps/android/version.json` via `Config/Version.properties`.

Both env vars are mandatory on this host:

- **JDK 21.** Gradle 9.5.1 rejects the default Java 26. Point `JAVA_HOME` at JDK 21 for this script, the `pnpm android:*` gradle wrappers, and Fastlane lanes.
- **`ANDROID_HOME`.** `build-release-artifacts.ts` resolves `apksigner` only from `ANDROID_HOME`/`ANDROID_SDK_ROOT`/`PATH`; it does NOT read `apps/android/local.properties` `sdk.dir` the way gradle does. With the SDK set only via `local.properties` (this host's setup), the script builds + verifies the Play AAB, then aborts with `Missing apksigner` at the third-party APK verify step (AAB verify uses JDK `jarsigner` and survives, which is why a partial run leaves only the Play AAB). Export `ANDROID_HOME` to avoid it. Clean fix if this keeps biting: make `resolveApkSignerFromSdk` fall back to `local.properties` `sdk.dir`.

Signing key: the keystore referenced by `OPENCLAW_ANDROID_STORE_FILE` (props in `~/.gradle/gradle.properties`, never committed) is the single release/upload key for both the phone and Wear apps (shared `applicationId ai.openclaw.app`). Its signing-certificate SHA-256 is:

```
ed9599f9f49d3e2264c659b0c34cc985ddd1d5dd248d171fd2d032d46f33b4d8
```

The apps installed on the phone/watch and all three release bundles must carry this cert. Verify same-key without the keystore password (strip colons, lowercase, compare to the fingerprint above):

```bash
apksigner verify --print-certs <app.apk>     # APK: read the "SHA-256 digest" line
keytool -printcert -jarfile <app.aab>         # AAB: read the "SHA256:" line
```

### v2026.6.10-beta.2 known follow-ups

- `apps/shared/OpenClawKit/.../GatewayModels.swift`: the CI-repair `spawnedby` Swift field was resolved toward upstream's generated init. The iOS/Mac companion is outside this replay's validation tier (host build + Android gradle + Gateway health); regenerate the Swift protocol model from the merged gateway protocol if the iOS companion is rebuilt.

## v2026.6.8 seam necessity review

| Seam                                      | Decision              | Importance | v2026.6.8 evidence                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | --------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wear OS voice companion                   | Runtime carry         | Critical   | Target still has no `apps/android/wear` module or shared `apps/android/audio` module. Replay carries the watch app, phone Wearable Data Layer relay, audio assembly/playback, dictation partial-transcript recovery, and Wear tests.                                                                                                                                                                                    |
| ACP remote target-backed bridge           | Runtime carry         | Critical   | Target has adjacent ACP `cwd` and backend support, but still lacks `runtime.acp.target`, persistent binding `target` metadata, and the codex-devbox ACP verifier. The private `extensions/acpx-remote` implementation remains outside this repo.                                                                                                                                                                        |
| Gateway runtime metadata hotpath          | Partial-overlap carry | Critical   | Target has substantial plugin metadata work, but replay still carries current-snapshot reuse for registry/manifest hot paths, lifecycle-cleared package-state probes, provider auth alias cache fixes, and runtime config invalidation details.                                                                                                                                                                         |
| ACP backend alias routing                 | Runtime carry         | High       | Target resolves selected ACP agents but still does not pass the selected config agent's `runtime.acp.backend` into ACP session creation.                                                                                                                                                                                                                                                                                |
| ACP backend-managed runtime options       | Runtime carry         | High       | Target runtime capabilities expose config option keys, but not backend-managed keys. Replay keeps `managedRuntimeOptionKeys` so backend-owned controls are not redundantly written by core.                                                                                                                                                                                                                             |
| Native Codex message-tool TTS delivery    | Partial-overlap carry | High       | Target has adjacent media delivery support, but not generated TTS local-media trust, duplicate-safe internal-ui source-reply TTS projection, or lightweight bundled channel TTS capability artifacts for transcode-aware voice-note delivery.                                                                                                                                                                           |
| Gateway message-tool history projection   | Runtime carry         | High       | Target still drops current-session `message` tool sends from client-visible history unless a silent completion or delivery mirror later flushes them. Replay carries successful-send mirroring at next user turn, normal assistant reply, and history tail while preserving raw `toolResult` rows for debug/projection callers.                                                                                         |
| Gateway main session display title        | Runtime carry         | Medium     | Target lets direct-channel `origin.label` become the primary `displayName` for canonical main sessions, so Telegram-routed main rows can appear as `telegram:<id>` in Android and other session lists instead of staying visibly main. Replay keeps origin metadata searchable but not the main row title.                                                                                                              |
| Notification heartbeat wakes              | Runtime carry         | Medium     | Target queues Android notification events but heartbeat preflight can skip the run when `HEARTBEAT.md` has tasks and none are due. Replay treats `notifications-event` as an inspectable wake payload, routes implicit notifications to the configured main session, preserves explicit global-scope agent targets, and consumes only notification-owned queued events so exec/cron/plugin events keep their own wakes. |
| Control UI read aloud through Talk        | Partial-overlap carry | Medium     | Target has Gateway Talk/TTS, but not the browser read-aloud control path, Markdown stripping, or `talk.speak` client integration.                                                                                                                                                                                                                                                                                       |
| Discord 30032 command deploy recovery     | Runtime carry         | Medium     | Target still lacks the Discord application-command-limit recovery predicate and force-overwrite redeploy path.                                                                                                                                                                                                                                                                                                          |
| Discord auto-presence account auth store  | Runtime carry         | Medium     | Target auto-presence loads its auth store via bare `ensureAuthProfileStore()`, which resolves `resolveDefaultAgentDir({})` to the built-in `main` agent dir; with a non-`main` configured default agent the store is empty and bots pin an idle "runtime degraded" presence. Replay carries account-bound store resolution.                                                                                             |
| Google TTS volume gain                    | Runtime carry         | Medium     | Target still lacks provider-local Google `volumeGain` normalization and PCM gain before WAV, Opus, or telephony output.                                                                                                                                                                                                                                                                                                 |
| Private plugin sidecar baseline filtering | Support/proof carry   | Medium     | Target sidecar baseline generation still does not constrain collection to git-tracked bundled plugin directories.                                                                                                                                                                                                                                                                                                       |
| Plugin SDK package-boundary artifacts     | Support/proof carry   | Medium     | Target package-boundary artifact prep can leave stale package-local declaration shims for `channel-contract-testing` after public entrypoint changes. Replay keeps the channel-contract testing DTS inputs/outputs and invalidates stale package-boundary outputs before proving package imports.                                                                                                                       |
| Exec safe-bin realpath trust              | Partial-overlap carry | Medium     | Target has adjacent exec trust hardening, but not the invariant that both the invoked symlink path and real target directory must be trusted.                                                                                                                                                                                                                                                                           |
| Docker replay validation directives       | Support/proof carry   | Medium     | Target root instructions still lack Bex's fork-replay Docker-clean broad-proof exception and private-state isolation warnings.                                                                                                                                                                                                                                                                                          |
| Codex app-server force full access        | Runtime carry         | Medium     | Target has no `OPENCLAW_CODEX_FORCE_FULL_ACCESS` toggle; native Codex app-server policy is subject to OpenClaw guardian/exec-mode/promotion/binding downgrades. Replay carries the clamp to `danger-full-access` + `never` + `user` at the resolver output, the tool-policy promotion bail, the bound thread/turn builders, and the side-question fork.                                                                 |
| Generic agent base prompt                 | Runtime carry         | Medium     | Target still has no harness-neutral `agent-base.md` convention for embedded OpenClaw/full prompts or native Codex `baseInstructions`, no generated global template at startup, and no base prompt fingerprint in native Codex thread bindings.                                                                                                                                                                          |
| Context-rich realtime Talk tools          | Runtime carry         | Medium     | Target has Gateway relay Talk, but not agent-owned `voice-agent-base.md`, projected current-session context with latest `message` tool mirror, degraded large-session context fallback, `talk.realtime.tools`, the `voice` tool profile, hard message-tool exclusion, or server-executed direct tools.                                                                                                                  |
| Android and Discord realtime audio        | Absorbed upstream     | High       | Target already carries Android Gateway Talk relay and Discord realtime voice. Replay keeps dependent Wear code, Android setup-code/operator-scope fixes, pending-chat history recovery, and focused relay fixes only.                                                                                                                                                                                                   |
| Wear OS native assistant entrypoint       | Runtime carry         | Medium     | Target has no Wear native assistant (`VoiceInteractionService`/`RecognitionService`) shape or phone assistant auto-start bridge. Replay adds a mirrored `:app` and `:wear` assistant layer. The two modules intentionally duplicate `OpenClaw*Service`, `AssistantTrustedStartBridge`, and role helpers to avoid touching upstream `:common`. Keep them in sync when editing either side.                               |
| Telegram transcribed-audio TTS intent     | Absorbed upstream     | Medium     | Target shared reply dispatch still preserves TTS intent for transcribed inbound audio. No source carry unless focused proof regresses.                                                                                                                                                                                                                                                                                  |
| Agent-scoped TTS conversion config        | Dropped               | Low        | No missing implementation was proved on v2026.6.5; no source carry.                                                                                                                                                                                                                                                                                                                                                     |
| CI replay repair guardrails               | Dropped               | Low        | The old v2026.5.18 CI repair context remains stale on v2026.6.5; no source carry.                                                                                                                                                                                                                                                                                                                                       |
| Gateway memory pressure reduction         | Runtime carry         | High       | Replay keeps session-store large-string interning and workspace skill snapshot interning, adapted to the moved `src/skills/loading/workspace.ts` path.                                                                                                                                                                                                                                                                  |

## v2026.6.8 performance patch review

- Older gateway startup/provider/model metadata patches remain absorbed or superseded by upstream. Replay carries only the still-observed hot-path and lifecycle-cache seams listed above.
- Session memory pressure remains an active carry: cached session-store clones and workspace skills snapshots intern repeated large skill prompt strings without changing serialized store shape.
- Stale CI repair guardrails and agent-scoped TTS conversion config are not carried without a current failing proof.

## v2026.6.8 replay proof

- Replay head: `7423299fce` on `bex/replay-2026.6.8`.
- Focused TypeScript proof passed: replay protocol/ACP/Codex command, then the full focused seam matrix.
- Android/Wear proof passed: `:app:compilePlayDebugKotlin`, `:wear:compileDebugKotlin`, `:app:testPlayDebugUnitTest`, and `:wear:testDebugUnitTest`.
- Formatting proof passed for touched TS files plus `:app:ktlintCheck` and `:wear:ktlintCheck`.
- Package audit passed with zero stale strings, missing impact paths, private lifecycle paths, or missing command paths.

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
- `plugin-sdk-package-boundary-artifacts` - support/proof carry: keep package-boundary DTS prep aware of `channel-contract-testing` source inputs, required package outputs, and stale package-local declaration shims that must trigger incremental-state invalidation.
- `extensions/acpx-remote` - active seam: keep the local target-backed remote ACP bridge as a separate nested/excluded plugin lifecycle; do not fold it into the outer repo replay.
- `c5991de10f` - active seam: keep Control UI read-aloud routed through the Gateway Talk/TTS surface, with Markdown/noisy markup stripped before speech.
- `discord-deploy-30032-recovery` - active seam: keep the 30032 (application command limit) reconcile-to-overwrite recovery path that bypasses the deploy hash cache with `force: true` and logs the initial failure as recoverable instead of error.
- `discord-auto-presence-account-auth-store` - active seam: keep Discord auto-presence runtime availability evaluated against the auth profile store of the agent bound to the account (account-level route binding -> agent dir) instead of the bare default store path, which ignores the configured default agent and reads an empty `main`-agent store.
- `realtime-android-discord-audio` - absorbed upstream: v2026.5.22 already has Android Gateway relay Talk and Discord realtime voice by default; do not replay wholesale unless focused proof finds a regression. Keep the fork-specific Android setup-code/operator-scope and pending-chat recovery fixes with the Android/Wear replay.
- `wear-os-talk-relay` - active seam: keep the Wear OS push-to-talk companion app and phone-side Wearable Data Layer relay on the durable STT -> `chat.send` -> `talk.speak` final TTS audio path, including the configured Wear target session, watch-owned thinking/fast-mode overrides, turn ids, phone-node pinning, chunked audio response assembly, final TTS playback gain on the watch, app bundle packaging, and narrow review-work proof gates.
- `02915314ae` - absorbed upstream: v2026.5.22 already preserves TTS intent for transcribed inbound audio through the shared dispatch path; no source carry unless proof fails.
- `native-codex-message-tool-tts` - partial-overlap carry: keep native Codex `message_tool_only` visible replies TTS-capable, preserve trusted local voice tool media through source-reply suppression, avoid re-synthesizing already-spoken internal-ui source-reply mirrors, suppress duplicate normal final text, and keep Telegram/Discord voice-note delivery on the proper transcode-aware path instead of leaking raw WAV attachments.
- `6c4503c385` - pending/drop candidate: agent-scoped TTS conversion config was not visibly missing on v2026.5.22; keep pending for live triage instead of replaying without a failing proof.
- `google-tts-volume-gain` - active seam: keep Google Gemini TTS applying provider-local PCM `volumeGain` before WAV wrapping, voice-note Opus transcode, and telephony PCM delivery.
- `da4c5c7c34` - partial-overlap carry: keep exec safe-bin realpath trust for approved safe binaries reached through symlinks or wrapper paths.
- `ci-replay-repair-2026-05-20` - pending/drop candidate: v2026.5.22 has moved past the v2026.5.18 CI repair context; do not replay stale CI repairs unless broad proof fails for the same dependency-contract class.
- `docker-replay-validation` - support/proof carry: keep the root `AGENTS.md` Docker-first Bex fork replay directives and run fork replay, build proof, and broad tests in a clean Docker validation container before deploying to Bex's live Gateway; use host-local tests only for targeted checks that intentionally depend on Bex's local environment.
- `codex-app-server-force-full-access` - active seam: when `OPENCLAW_CODEX_FORCE_FULL_ACCESS` is set, the native Codex app-server runtime clamps to `sandbox: danger-full-access` + `approvalPolicy: never` + `approvalsReviewer: user` (unrestricted network is implied by danger-full-access at the Codex protocol level) at the resolver output, the OpenClaw tool-policy promotion bail, the bound thread/turn request builders, and the side-question fork. This defeats OpenClaw-side exec-mode/guardian/promotion/binding downgrades. Opt-in, default off; `/etc/codex/requirements.toml` is intentionally not consulted (this fork does not use it).

- `generic-agent-base-prompt` - active seam: keep the generated global `agent-base.md` template and the agent-scoped runtime override convention for embedded OpenClaw/full prompts and native Codex app-server `baseInstructions`. Gateway startup regenerates `<stateDir>/agent-base.md`; only `<agentDir>/agent-base.md` affects runtime. Codex app-server also accepts `<agentDir>/app-server-base.md` as a legacy alias when the canonical file is absent.
- `context-rich-realtime-talk-tools` - active seam: keep Gateway-owned realtime Talk as a context-rich voice agent surface with exact `voice-agent-base.md` prompt loading, transient current-session context, latest projected `message` tool mirror context, degraded large-session fallback, opt-in `talk.realtime.tools`, the `voice` tool profile, hard exclusion of message-sending tools, and server-executed direct tools. Browser/client-owned realtime remains consult/control-only.
- `android-phone-chat-bubble-width` - active seam: keep full-screen Android phone chat bubbles in `apps/android/app/src/main/java/ai/openclaw/app/ui/chat/ChatScreen.kt` at `CHAT_SCREEN_BUBBLE_WIDTH_FRACTION = 0.85f` for user, assistant, streaming, and persisted rows. Guard with `apps/android/app/src/test/java/ai/openclaw/app/ui/chat/ChatScreenLayoutTest.kt` and verify with `./gradlew :app:testThirdPartyDebugUnitTest --tests ai.openclaw.app.ui.chat.ChatScreenLayoutTest --console=plain`; deploy Bex's phone with the third-party release APK, never Play release.
- `notification-heartbeat-wakes` - active seam: keep Android notification wakes on the configured main session by default, keep explicit payload session keys canonicalized, preserve selected agent ids when global scope collapses explicit `agent:<id>:main` keys to `global`, make notification-event heartbeats prompt/consume only `notification:*` queued events while leaving exec, cron, and text-lookalike plugin events queued, suppress repeated wake requests for consecutive identical posted notification summaries, and filter Android SystemUI charging notifications out of notification heartbeat prompts.
- `forced-heartbeat-tool-construction` - active seam: keep embedded attempt runs that force heartbeat delivery from losing `heartbeat_respond` when callers also provide a restrictive `toolsAllow`. Forced runtime tools are merged into explicit allowlists before construction planning, while undefined and wildcard allowlists keep their existing broad behavior.
- `lobster-workspace-cwd-sandbox` - active seam: keep Lobster command cwd resolution rooted in the active plugin tool workspace, not the Gateway process cwd. Relative cwd values resolve inside `ctx.workspaceDir`; absolute cwd values are allowed only when they stay inside that workspace; omitted cwd defaults to the workspace root for tool-created Lobster instances.
- `reply-session-init-burst-serialization` - active seam: keep reply session initialization serialized per store path and canonical session key before the session-store snapshot is read. Same-session Telegram/direct bursts must queue and reuse the committed session metadata instead of preparing multiple fresh session ids and surfacing `reply session initialization conflicted` as a channel dispatch failure.
- `persistent-codex-memory-recall` - active seam: keep Active Memory recall on a stripped hidden Codex/OpenAI path with a warm app-server client but fresh native Codex session per recall, private temp transcript cleanup when user transcript persistence is off, no Honcho/plugin/TTS/skills/MCP/Codex-plugin participation, custom memory-tool allowlists preserved after broad-tool normalization, bounded trace instrumentation, and trusted parent fast-mode inheritance for plugin subagents only.
- `lossless-transcript-wedge-rebootstrap` - active seam in external `lossless-claw`: when stored compaction exhausts but host-observed live transcript tokens remain over target, bump a persisted `conversations.context_projection_reset_generation` value and include it in the existing `thread_bootstrap` epoch hash. Preserve the external OpenClaw session key/conversation identity and reproject summaries/focus/tail context into a fresh Codex backend thread without changing the v1 epoch wire shape.
- `lossless-active-memory-recall-expansion` - active seam in external `lossless-claw`: reuse Active Memory recall delegated expansion child sessions only within the same authorization/input scope, refresh per-run grants/recursion context/idempotency keys, keep non-reusable sessions deleted, and forward fast-mode/idempotency params through the plugin gateway adapter.

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

### Plugin SDK package-boundary artifacts

Carry behavior: package-boundary artifact prep must regenerate the real plugin-sdk package declarations needed by public package imports, including the channel contract testing surface. Stale package-local declaration shims that re-export the root `dist/plugin-sdk` output are not valid package-boundary proof and must force a rebuild.

Primary seam files:

- `scripts/prepare-extension-package-boundary-artifacts.mjs`
- `test/scripts/prepare-extension-package-boundary-artifacts.test.ts`

Primary seam tests:

- `node scripts/run-vitest.mjs test/scripts/prepare-extension-package-boundary-artifacts.test.ts`
- `pnpm build` when package-boundary outputs, entrypoints, or published surfaces change

Rebase notes:

- Keep `channel-contract-testing` in both package DTS inputs and required package DTS outputs. The required outputs include the contract testkit declarations, `src/channels/turn/dispatch-result.d.ts`, and `src/plugin-sdk/channel-contract-testing.d.ts` under `packages/plugin-sdk/dist`.
- If `packages/plugin-sdk/dist/src/plugin-sdk/channel-contract-testing.d.ts` exists only as the stale root-shim re-export, remove package DTS incremental state and regenerate it before treating package-boundary artifacts as fresh.
- Do not satisfy package-boundary proof with root `dist/plugin-sdk` outputs alone. The packaged plugin-sdk import surface must work from `packages/plugin-sdk/dist` as shipped.

### Forced heartbeat tool construction

Carry behavior: embedded attempt runs that set `forceHeartbeatTool` must keep the `heartbeat_respond` tool constructible even when the caller also supplies a restrictive runtime tool allowlist. This fixes heartbeat delivery paths where the run explicitly needs heartbeat replies, but `toolsAllow: []` or a plugin-only allowlist would otherwise construct no OpenClaw heartbeat tool.

Primary seam files:

- `src/agents/embedded-agent-runner/run/attempt-tool-construction-plan.ts`
- `src/agents/embedded-agent-runner/run/attempt-tool-construction-plan.test.ts`
- `src/agents/embedded-agent-runner/run/attempt.ts`

Primary seam tests:

- `src/agents/embedded-agent-runner/run/attempt-tool-construction-plan.test.ts`
- `pnpm test src/agents/embedded-agent-runner/run/attempt-tool-construction-plan.test.ts`

Rebase notes:

- Keep `forceHeartbeatTool` parity with `forceMessageTool` in `mergeForcedEmbeddedAttemptToolsAllow()`: forced runtime tools are appended to explicit allowlists, materialized for empty allowlists, left alone for wildcard allowlists, and not materialized when `toolsAllow` is undefined.
- Keep construction planning and the runtime attempt path in sync. `runEmbeddedAttempt()` should merge forced runtime tools before `resolveEmbeddedAttemptToolConstructionPlan()` and pass `forceHeartbeatTool` into the plan so OpenClaw tool families are constructed when the only OpenClaw tool is the forced heartbeat response.
- Do not broaden this into a generic hidden fallback. The seam exists because heartbeat delivery is an explicit runtime contract; other tools still need normal allowlist admission.

### Lobster workspace cwd sandbox

Carry behavior: Lobster tool calls resolve their working directory against the active workspace for the plugin tool invocation. Relative `cwd` values resolve inside that workspace, absolute `cwd` values are accepted only when they stay inside the workspace, and omitted `cwd` defaults to the workspace root for normal tool-created Lobster instances. This fixes workspace-scoped Lobster runs that previously resolved against the Gateway process cwd or rejected the already-resolved workspace path.

Primary seam files:

- `extensions/lobster/index.ts`
- `extensions/lobster/src/lobster-tool.ts`
- `extensions/lobster/src/lobster-tool.test.ts`
- `extensions/lobster/src/lobster-runner.ts`
- `extensions/lobster/src/lobster-runner.test.ts`

Primary seam tests:

- `extensions/lobster/src/lobster-runner.test.ts`
- `extensions/lobster/src/lobster-tool.test.ts`
- `pnpm test extensions/lobster/src/lobster-runner.test.ts extensions/lobster/src/lobster-tool.test.ts`

Rebase notes:

- The plugin entrypoint must pass `ctx.workspaceDir` into `createLobsterTool()` as the cwd sandbox base. Test-only or manually constructed tools may keep the process cwd fallback.
- Preserve the sandbox check after path resolution. Normalize both base and resolved paths with platform-aware casing before comparing, and reject any `cwd` whose relative path escapes the base or becomes absolute.
- Keep the tool schema description aligned with the runtime contract: cwd may be relative or absolute, but it is workspace-confined either way.

### Reply session init burst serialization

Carry behavior: reply session initialization must serialize by store path and canonical session key before reading the session-store snapshot. Bursty same-session inbound delivery, especially Telegram replay/spooled/direct-message bursts, can otherwise let multiple turns prepare against the same metadata revision; after one turn commits, later turns can exhaust the stale-snapshot retry and surface `reply session initialization conflicted for agent:<id>:<key>` as a channel dispatch failure. The fix keeps the existing guarded metadata commit as the cross-process/backing-store protection, but adds same-process per-session queueing around the read-decide-commit initialization path so later turns see and reuse the winning session id.

Primary seam files:

- `src/auto-reply/reply/session.ts`
- `src/auto-reply/reply/session.test.ts`

Primary seam tests:

- `node scripts/run-vitest.mjs src/auto-reply/reply/session.test.ts`
- `pnpm tsgo:core`
- `pnpm tsgo:test:src`

Rebase notes:

- Keep target resolution and initialization logic unified. The queue key must be derived from the same canonical target that the initializer will write: command-target routing, conversation bindings, configured main key, session scope, configured agent id, and system-event no-reset behavior all need to match the existing `initSessionState` semantics.
- Queue before `loadReplySessionInitializationSnapshot()`, not only around `commitReplySessionInitialization()`. The store writer already serializes writes; the bug class is stale read/decision work that happens before the guarded write.
- Keep `commitReplySessionInitialization()` CAS and one-retry recovery. The per-session queue is a same-process contention reducer, not a replacement for stale-snapshot protection across process boundaries or future SQLite transactions.
- Keep concurrency regression coverage as a burst of several same-session initializers and assert they all converge on one persisted session id. A two-turn test is insufficient because the old one-retry path could already hide a simple two-way race.

### Persistent Codex memory recall

Carry behavior: Active Memory hidden recall runs should be fast, private, and isolated. OpenAI recall models run through the Codex harness with `reasoningLevel: "off"` and a compact memory-recall profile, while keeping the Codex app-server client warm across recalls. Each recall still uses a fresh hidden session key, native Codex thread, session id, run id, and temp transcript file so stale hidden memory cannot bleed into later queries. When `persistTranscripts: false`, private runtime transcript files live under `os.tmpdir()` and are removed in `finally` after result or partial-timeout evidence recovery. Hidden runs must not call Honcho, auto-TTS, generic plugin hooks, native Codex hooks, native Copilot hooks, skills, MCP servers, Codex plugins, message tools, or the context engine.

Primary seam files:

- `extensions/active-memory/index.ts`
- `src/agents/embedded-agent-runner/run.ts`
- `src/agents/embedded-agent-runner/run/attempt.ts`
- `src/agents/embedded-agent-runner/run/params.ts`
- `src/agents/harness/hook-context.ts`
- `src/plugins/hook-types.ts`
- `src/plugins/runtime/types.ts`
- `src/gateway/server-methods/agent.ts`
- `src/gateway/server-plugins.ts`
- `packages/gateway-protocol/src/schema/agent.ts`
- `extensions/codex/src/app-server/run-attempt.ts`
- `extensions/codex/src/app-server/dynamic-tool-build.ts`
- `extensions/codex/src/app-server/dynamic-tools.ts`
- `extensions/codex/src/app-server/attempt-context.ts`
- `extensions/copilot/src/attempt.ts`

Primary seam tests:

- `node scripts/run-vitest.mjs extensions/active-memory/index.test.ts`
- `node scripts/run-vitest.mjs extensions/copilot/src/attempt.test.ts`
- `node scripts/run-vitest.mjs extensions/active-memory/index.test.ts extensions/copilot/src/attempt.test.ts src/agents/agent-tools.create-openclaw-coding-tools.test.ts extensions/codex/src/app-server/dynamic-tool-build.test.ts extensions/codex/src/app-server/dynamic-tools.test.ts extensions/codex/src/app-server/run-attempt.test.ts extensions/codex/src/app-server/run-attempt.native-hook-relay.test.ts src/agents/embedded-agent-runner/run/attempt.test.ts src/agents/embedded-agent-runner/run.before-agent-reply-cron.test.ts src/gateway/server-methods/agent.test.ts src/gateway/server-plugins.test.ts packages/gateway-protocol/src/schema/agent.test.ts`

Rebase notes:

- Do not replay this as a stable native Codex thread. The app-server client/bundle may stay warm, but the native recall thread, session key, session id, session file, and run id must be fresh per recall to avoid stale hidden context.
- Keep `persistTranscripts: false` private: use temporary 0700 runtime transcript directories and delete them after result or partial-timeout recovery. User transcript persistence is separate from private runtime scratch needed during a hidden recall.
- Preserve the hidden-run suppression contract across sibling harnesses. Codex and Copilot must both skip generic plugin hooks, before/after tool hooks, LLM input/output hooks, compaction hooks, agent-end hooks, and their native hook bridges when `suppressPluginHooks` is set.
- Keep hidden recall tool filtering in the Active Memory config normalizer, not a memory-prefix-only hidden filter. Reserved broad/core tools, Honcho, TTS, web, message, exec/read/write, group entries, and wildcard entries are excluded, but custom memory tools such as `search_notes` or `recall_context` remain valid.
- Fast-mode inheritance is trusted only from plugin subagent/runtime paths. Public gateway agent calls may set the visible fast-mode policy but must not spoof inherited `fastModeStartedAtMs` or `fastModeAutoOnSeconds`.
- Keep gateway trace maps bounded and lifecycle-cleaned; tracing is for latency diagnosis and must not become unbounded per-request state.

### Lossless transcript-wedge rebootstrap

Carry behavior: the external `lossless-claw` context engine must not leave users stuck after stored compaction has no eligible candidates while the live Codex backend transcript remains over target. A proven transcript wedge increments a persisted per-conversation reset generation in SQLite and the next `assemble` folds that generation into the existing `thread_bootstrap` epoch hash. OpenClaw keeps the same session key and conversation identity, but the changed epoch makes the Codex app-server binding compatibility path start a fresh backend thread and inject Lossless's rich compacted context once.

Primary seam files:

- `../lossless-claw/src/db/migration.ts`
- `../lossless-claw/src/store/conversation-store.ts`
- `../lossless-claw/src/engine.ts`
- `../lossless-claw/test/transcript-wedge.test.ts`

Primary seam tests:

- `npm test -- test/transcript-wedge.test.ts`
- `npm test -- test/migration.test.ts`
- `npm test -- test/engine-assemble.test.ts`
- `npm run typecheck`
- `npm run build`

Rebase notes:

- Do not change the public epoch format while keeping the `summary-prefix-v1` prefix. Keep emitted epochs shaped as `summary-prefix-v1:<conversationId>:<hash>` and place the reset generation only in the hash input unless all consumers/tests move to a new version.
- Bump the reset generation only in the terminal transcript-wedge branch: threshold sweep, no action taken, no auth failure, not budget-stopped, still over target, and host-observed tokens present. Ordinary compaction progress, budget stops, generic over-target failures, and repeated assemble calls must not churn backend threads.
- The rebootstrap payload must preserve rich Lossless context: summaries, focus brief, important fresh tail, and other assembled context still flow through `assemble` before the epoch is emitted. Regression proof should assert content survives before and after the epoch change, not only that the epoch string changes.
- OpenClaw host proof relies on `ContextEngineProjection.mode = "thread_bootstrap"` and Codex app-server binding compatibility comparing projection epoch/fingerprint. No host code should be needed when only the epoch changes.

### Lossless Active Memory recall expansion

Carry behavior: the external `lossless-claw` delegated expansion helpers need stable child sessions for Active Memory recall so recall expansion can retain useful local continuity, but the retained child transcript must not cross authorization or input scopes. Active Memory reusable keys are scoped by caller session key, conversation id, sorted summary ids, token cap, include-messages mode, and max depth. Each delegated run still gets fresh grant/context/idempotency state, and cleanup clears those in-memory bindings even when the child transcript is retained. Non-Active-Memory callers keep random child session keys and delete transcripts.

Primary seam files:

- `../lossless-claw/src/plugin/index.ts`
- `../lossless-claw/src/tools/lcm-expand-query-tool.ts`
- `../lossless-claw/src/tools/lcm-expand-tool.delegation.ts`
- `../lossless-claw/test/lcm-expand-query-tool.test.ts`
- `../lossless-claw/test/lcm-expand-tool.delegation.test.ts`
- `../lossless-claw/test/plugin-config-registration.test.ts`

Primary seam tests:

- `npm test -- test/lcm-expand-query-tool.test.ts test/lcm-expand-tool.delegation.test.ts test/plugin-config-registration.test.ts`
- `npm run typecheck`
- `npm run build`

Rebase notes:

- Stable reusable child keys must include the authorization/input scope. Reusing only `agent:<id>:...:active-memory:recall` is unsafe because a later narrower grant could see prior expansion tool results from a wider conversation/token scope.
- Keep summary id order canonical in the key hash. Reordered identical summary id sets should reuse a key; another conversation, smaller token cap, different include-message mode, or different max depth should not.
- Always refresh the delegated expansion grant, recursion context, and gateway `idempotencyKey` for each run. Always revoke the grant and clear the recursion context in `finally`; only skip `sessions.delete` for scoped reusable Active Memory keys.
- Forward `idempotencyKey`, `fastMode`, `fastModeAutoOnSeconds`, and `fastModeStartedAtMs` through the Lossless plugin's gateway `agent` adapter so Active Memory's trusted fast-mode inheritance reaches delegated subagents without accepting malformed values.

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

- `src/agents/embedded-agent-subscribe.handlers.tools.ts`
- `src/agents/embedded-agent-subscribe.handlers.tools.test.ts`
- `src/gateway/chat-display-projection.ts`
- `src/gateway/server.chat.gateway-server-chat.test.ts`
- `src/gateway/server-methods/server-methods.test.ts`

Primary seam tests:

- `node scripts/run-vitest.mjs src/agents/embedded-agent-subscribe.handlers.tools.test.ts`
- `src/gateway/server.chat.gateway-server-chat.test.ts`
- `src/gateway/server-methods/server-methods.test.ts`

Rebase notes:

- Do not rely on Telegram delivery mirrors or silent `NO_REPLY` completions as the only mirror-flush triggers. Android and other Gateway clients can ask for the current session directly, and the transcript may contain only `assistant toolCall -> toolResult` before the history window ends.
- Keep the projection transport-neutral: the behavior is keyed to successful current-session `message` tool sends, not Telegram-specific session keys, phone names, or device ids.
- Track successful `message(action="send")` text through both the canonical `message` field and compatibility aliases such as `SendMessage`, `content`, and `text`. Prefer a nonblank canonical `message` when present, but fall through to aliases so alias-shaped sends still count as delivery evidence for final-reply dedupe and history mirrors.
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

### Auto-TTS excludes tool delivery kind

Carry behavior: the auto-TTS gate never synthesizes audio for `kind: "tool"` delivery payloads, regardless of the resolved TTS `mode`. `mode: "all"` voices assistant content blocks (`block` and `final`) as they stream, but intermediate tool-call/tool-result messages stay text-only. Without this guard, an agent or channel configured with `auto: "always"` + `mode: "all"` speaks tool chrome — a regression for any channel or mode that routes intermediate tool-call messages to a TTS sink. This is a general gate fix (not fork-specific behavior); track it until upstream carries the same `kind: "tool"` exclusion.

Primary seam files:

- `packages/speech-core/src/tts.ts`
- `packages/speech-core/src/tts.test.ts`
- `bex-fork.md`

Primary seam tests:

- `pnpm test packages/speech-core/src/tts.test.ts`

Rebase notes:

- Keep the guard at the shared `maybeApplyTtsToPayload` chokepoint, not per caller. Tool-progress messages reach the gate tagged `kind: "tool"` via the auto-reply dispatch path, so one guard at the chokepoint covers every caller that tags kind.
- The pre-existing `mode === "final" && kind !== "final"` skip only suppressed tool/block in final mode; `mode: "all"` bypassed it and spoke tool output. Keep the `kind === "tool"` skip independent of `mode` so the "intermediate tool output is never spoken" intent holds in every mode.
- Tool payloads that legitimately carry audio (the TTS tool) are promoted to `kind: "final"` before delivery in `chat.ts`, so excluding `kind: "tool"` here does not silence real generated audio.

Closeout proof from the 2026-06-22 auto-TTS tool-kind pass:

- Focused regression: `pnpm test packages/speech-core/src/tts.test.ts` passed 35 tests, including new `mode: "all"` coverage proving tool kind is withheld while block kind still synthesizes.
- Lint: `node scripts/run-oxlint.mjs packages/speech-core/src/tts.ts packages/speech-core/src/tts.test.ts` clean.

### Notification heartbeat wakes

Carry behavior: Android notification forwarding sends `notifications.changed`, Gateway queues it as a generic system event on the configured main session by default, and the notification-triggered heartbeat wake must still run even when `HEARTBEAT.md` has a `tasks:` block with no due periodic task. The wake is quiet by default: it gives the agent an immediate HEARTBEAT policy judgment pass over queued notification context, and HEARTBEAT policy decides whether any user-visible notification is warranted.

The routing and queue-ownership invariants are part of the seam. Implicit Android notification events must not inherit stale node-derived session keys. Explicit payload `sessionKey` values are still canonicalized, and when `session.scope: "global"` collapses an explicit `agent:<id>:main` key to `global`, the wake must keep the selected `agentId` so the right agent heartbeat lane runs. Notification-event heartbeats must build prompts from notification-owned queued entries only: match both notification-shaped text and a `notification:*` context key, consume only those entries, and leave exec, cron, and lookalike plugin events queued for their own wake paths.

Noise control is part of the seam. The Gateway should enqueue every notification event for history/debug visibility, but it should not repeatedly request heartbeat wakes for consecutive posted notifications with the same node/package/title/text summary on the same wake lane. The dedupe key intentionally ignores the Android notification key for posted notifications with visible content so remote/status reposts with a new key but identical user-visible content wake only once while consecutive; an intervening different summary or non-deduped notification change resets the dedupe, removal events still wake independently, and explicit `agent:<id>:main` notifications that canonicalize to `global` dedupe per selected agent id. Android SystemUI charging-state notifications are also ignorable heartbeat context: notification-heartbeat prompt selection filters them out, an ignored-only notification wake skips without calling the model, and only the ignored notification entries are consumed so unrelated exec/cron/plugin events keep their own wake paths.

Primary seam files:

- `src/gateway/server-node-events.ts`
- `src/gateway/server-node-events.test.ts`
- `src/infra/heartbeat-runner.ts`
- `src/infra/heartbeat-events-filter.ts`
- `src/infra/heartbeat-events-filter.test.ts`
- `src/infra/heartbeat-runner.returns-default-unset.test.ts`

Primary seam tests:

- `pnpm test src/gateway/server-node-events.test.ts src/infra/heartbeat-events-filter.test.ts src/infra/heartbeat-runner.returns-default-unset.test.ts src/infra/event-session-routing.test.ts`
- `pnpm exec oxfmt --check --threads=1 src/gateway/server-node-events.ts src/gateway/server-node-events.test.ts src/infra/heartbeat-events-filter.ts src/infra/heartbeat-events-filter.test.ts src/infra/heartbeat-runner.ts src/infra/heartbeat-runner.returns-default-unset.test.ts`
- `node scripts/run-oxlint.mjs src/gateway/server-node-events.ts src/gateway/server-node-events.test.ts src/infra/heartbeat-events-filter.ts src/infra/heartbeat-events-filter.test.ts src/infra/heartbeat-runner.ts src/infra/heartbeat-runner.returns-default-unset.test.ts`

Rebase notes:

- Keep `notifications-event` classified as an inspectable wake payload. It must bypass the "no due heartbeat task" null-prompt outcome without turning queued notification events into unconditional outbound messages.
- Keep notification event enqueueing generic and session-scoped. The heartbeat wake should create the policy prompt; HEARTBEAT.md remains the owner of notify/suppress decisions.
- Keep implicit notification routing on `resolveMainSessionKey(cfg)`, not `node-${nodeId}`. Explicit payload session keys still go through `loadSessionEntry()`, but do not erase an explicit agent id when global scope canonicalizes the queue key to `global`.
- Keep notification prompt and drain selection context-owned. Text alone is not enough: unrelated plugins can enqueue strings that begin with `Notification posted`, and exec events can coexist in the same queue. A `notifications-event` wake should leave those entries queued.
- Keep the repeated-summary wake dedupe separate from event enqueueing and limited to consecutive posted notifications with visible summary text. Dropping enqueue would hide notification history; deduping removals can hide distinct removal events, but removals still reset the consecutive posted-summary boundary.
- Keep dedupe scoped to the actual wake lane. Under global session scope, explicit `agent:<id>:main` notifications share the `global` queue key but must not share one dedupe lane across agents.
- Keep ignored-only notification wakes ahead of HEARTBEAT task and commitment prompt selection. Charging noise should not run periodic heartbeat work just because a task is due.
- Keep the charging notification filter narrow to Android SystemUI charging-state text/key patterns so normal app notifications and unrelated SystemUI notices, such as VPN status, can still reach HEARTBEAT policy.

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

### Context-rich realtime Talk tools

Carry behavior: Gateway-owned realtime Talk is a voice-agent surface, not an isolated provider chat. `talk.session.create` with `mode: "realtime"`, `transport: "gateway-relay"`, and `brain: "agent-consult"` reads `<agentDir>/voice-agent-base.md` exactly when present, appends transient current-session context outside that file, includes projected recent history and the latest successful `message` tool mirror, and can expose opt-in direct tools through `talk.realtime.tools`. The relay keeps `openclaw_agent_consult` and `openclaw_agent_control` as escalation tools, executes configured direct tools server-side, and submits compact JSON-safe results to the provider. Browser/client-owned realtime stays consult/control-only.

Rationale: Bex's Sky voice path needs the realtime provider to share the same agent identity, recent context, message-tool visibility, and local-user tool capability as the rest of OpenClaw. The seam reuses current Gateway Talk, projected history, tool profiles, MCP/plugin policy, and relay plumbing instead of adding a parallel voice runtime.

Primary seam files:

- `src/agents/voice-agent-base-prompt-file.ts`
- `src/agents/tool-catalog.ts`
- `src/agents/agent-tools.ts`
- `src/config/types.tools.ts`
- `src/config/types.gateway.ts`
- `src/config/talk.ts`
- `src/config/zod-schema.ts`
- `src/config/zod-schema.agent-runtime.ts`
- `src/talk/realtime-instructions.ts`
- `src/talk/realtime-context.ts`
- `src/talk/realtime-direct-tools.ts`
- `src/gateway/server-methods/talk-session.ts`
- `src/gateway/server-methods/talk-shared.ts`
- `src/gateway/talk-realtime-relay.ts`
- `packages/gateway-protocol/src/schema/channels.ts`
- `packages/gateway-protocol/src/schema/agents-models-skills.ts`
- `docs/nodes/talk.md`
- `bex-fork.md`

Primary seam tests:

- `node scripts/run-vitest.mjs src/config/talk.normalize.test.ts src/config/zod-schema.talk.test.ts src/config/config.talk-validation.test.ts packages/gateway-protocol/src/talk-config.contract.test.ts`
- `node scripts/run-vitest.mjs src/agents/agent-tools.create-openclaw-coding-tools.test.ts`
- `node scripts/run-vitest.mjs src/talk/realtime-instructions.test.ts src/talk/realtime-context.test.ts src/talk/realtime-direct-tools.test.ts`
- `node scripts/run-vitest.mjs src/gateway/server-methods/talk.test.ts src/gateway/talk-realtime-relay.test.ts`
- `pnpm docs:list`
- `git diff --check`

Replay order:

1. Restore the `voice` tool profile, `talk.realtime.tools`, schema metadata, and Gateway protocol Talk config shape, including `consultRouting`.
2. Restore `runtimeToolPolicy` support in `createOpenClawCodingTools` so Talk can reuse profile, allow, alsoAllow, deny, plugin, MCP, fs, and exec policy.
3. Restore exact `voice-agent-base.md` loading, realtime instruction composition, and transient realtime context packet construction.
4. Restore the direct realtime tool adapter, including reserved-name checks, object-root schema filtering, hard message-tool exclusion, abort handling, and compact result shaping.
5. Wire `talk.session.create` gateway-relay sessions to resolve agent/session scope, compose instructions, build context, build direct tools, and pass direct executors to the relay.
6. Restore relay direct-tool execution between consult/control handling and the unknown-tool broadcast fallback.
7. Update Talk docs and rerun the focused proof commands above.

Non-negotiable invariants:

- Never generate, migrate, overwrite, or patch `<agentDir>/voice-agent-base.md`.
- Runtime context is appended outside the voice prompt file and is not persisted as a new state file.
- Unset `talk.realtime.tools` exposes no direct tools; only consult/control remain.
- `voice` is a stable profile name and starts from broad local-user capability.
- `deny` wins over profile, `allow`, `alsoAllow`, plugin, MCP, fs, and exec grants.
- Realtime voice never exposes message-sending tools, even under `profile: "full"` or `profile: "voice"`.
- Use projected history, not raw `toolResult` scraping, for latest `message` tool mirror context.
- Large-session summary failures are fail-open: inject a plain degraded-context note and bounded recent tail instead of failing session startup.
- Direct tool results sent to the provider stay compact and JSON-safe, with no binary or media payload dumps.
- Unknown realtime tool calls remain broadcast-only for existing manual/client result submission.
- Browser/client-owned realtime sessions remain consult/control-only until they get a separate client execution protocol.
- QR/setup-code pairing may grant bounded operator Talk secrets for owner-main realtime startup, but must not grant `operator.admin` or `operator.pairing`; scoped direct realtime tools still require admin or valid `spawnedBy` lineage.

Expected config shape:

```json5
{
  talk: {
    realtime: {
      provider: "openai",
      transport: "gateway-relay",
      brain: "agent-consult",
      tools: {
        profile: "voice",
        deny: ["exec"],
      },
    },
  },
}
```

### Android and Discord realtime audio

Carry behavior: Android Talk Mode discovers realtime availability from `talk.config`, starts `talk.session.create` in realtime mode with `transport: "gateway-relay"` and `brain: "agent-consult"`, streams microphone PCM through relay audio calls, and falls back to legacy batch Talk only when realtime is unavailable. Discord voice channels use the same provider-backed full-duplex realtime bridge by default; `channels.discord.voice.realtime.enabled=false` is the explicit legacy batch STT/TTS escape hatch.

Primary seam files:

- `apps/android/app/src/main/java/ai/openclaw/app/voice/*Realtime*`
- `apps/android/app/src/main/java/ai/openclaw/app/MainViewModel.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/NodeRuntime.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/chat/ChatController.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/gateway/GatewaySession.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/node/ConnectionManager.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/ui/OnboardingFlow.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/voice/TalkModeGatewayConfig.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/voice/TalkModeManager.kt`
- `extensions/openai/realtime-voice-provider.ts`
- `extensions/openai/realtime-voice-provider.test.ts`
- `src/gateway/server-methods/talk.ts`
- `src/gateway/server-methods/talk-client.ts`
- `src/gateway/server-methods/talk-session.ts`
- `src/gateway/server-methods-list.ts`
- `src/gateway/protocol/schema/channels.ts`
- `src/gateway/server-broadcast.ts`
- `src/gateway/server/ws-connection.ts`
- `src/gateway/talk-realtime-relay.ts`
- `src/talk/provider-resolver.ts`
- `src/talk/provider-resolver.test.ts`
- `src/talk/provider-types.ts`
- `src/config/types.discord.ts`
- `src/config/zod-schema.providers-core.ts`
- `src/config/bundled-channel-config-metadata.generated.ts`
- `extensions/discord/src/config-ui-hints.ts`
- `extensions/discord/src/voice/audio.ts`
- `extensions/discord/src/voice/realtime.ts`
- `extensions/discord/src/voice/manager.ts`
- `docs/channels/pairing.md`
- `docs/channels/discord.md`
- `docs/gateway/config-channels.md`

Primary seam tests:

- `apps/android/app/src/test/java/ai/openclaw/app/GatewayBootstrapAuthTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/chat/ChatControllerMessageIdentityTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/gateway/GatewaySessionInvokeTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/node/ConnectionManagerTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/voice/RealtimeTalkRelayEventParserTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/voice/RealtimeTalkManagerAudioInjectionTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/voice/TalkModeConfigParsingTest.kt`
- `src/gateway/gateway-misc.test.ts`
- `src/gateway/protocol/index.test.ts`
- `src/gateway/server-methods/talk.test.ts`
- `node scripts/run-vitest.mjs extensions/openai/realtime-voice-provider.test.ts src/talk/provider-resolver.test.ts src/gateway/server-methods/talk.test.ts`
- `extensions/discord/src/voice/manager.e2e.test.ts`
- `extensions/discord/src/voice/realtime.test.ts`

Rebase notes:

- Keep Discord realtime voice default-on. Do not preserve old disabled-by-default docs or behavior when replaying this seam.
- Keep the Gateway relay path provider-generic and protocol-visible through `talk.realtime.*`; do not introduce Discord-specific gateway RPCs.
- Keep provider configuration transport-aware. OpenAI `gpt-realtime-*` browser/WebRTC can use Codex OAuth session credentials, but native Gateway relay/server websocket bridging needs an OpenAI API key from explicit provider config or `OPENAI_API_KEY`; OAuth-only configs must not report ready for `transport: "gateway-relay"`.
- Pass the requested `transport` through `talk.session.create`, `talk.client.*`, and provider resolution so Android/Discord gateway-relay checks do not accidentally reuse browser-realtime readiness.
- Keep batch Android Talk and batch Discord voice available only as fallback or explicit opt-out behavior, not as the normal Discord voice path.
- Keep relay cleanup tied to Gateway websocket lifecycle so relay sessions close when the client connection closes.
- Keep Discord receive audio decoded into the shared PCM16 24 kHz realtime contract before sending it to the provider bridge.
- When Bex asks to build the Android app without naming a flavor, build the sideloadable third-party release APK with `cd apps/android && ./gradlew :app:assembleThirdPartyRelease`; do not default to the Play flavor because the third-party flavor keeps SMS and Call Log permissions.
- Keep Android QR/setup-code bootstrap usable for operator Talk: setup-code operator handoff includes `operator.talk.secrets`, and a pasted setup code must take precedence over a stored device token when the stored token does not cover the requested scopes. The app setup flow should copy the setup URL into the Gateway endpoint fields and the bootstrap token into bootstrap auth, not overwrite the setup-code field with the URL.
- Keep Android chat sends recoverable when the Gateway completes but the phone misses the terminal event. Pending runs must poll `chat.history`, reconcile under the canonical run id returned by `chat.send`, keep optimistic-message state synchronized, and clear the pending/working state once the persisted assistant reply appears.

### Wear OS voice companion

Carry behavior: the Android app ships a Wear OS companion module for push-to-talk voice turns. The watch discovers phones advertising `openclaw_relay_phone`, pins each turn to one reachable phone node, and accepts only terminal audio/status/error messages for the active turn and active phone node. The default watch capture path uses the platform `SpeechRecognizer` and sends final nonblank text over `/openclaw/watch/text/{turnId}`; this avoids watch-side raw audio endpointing in normal environments and lets Wear OS own speech detection. If a recognizer emits partial text and then returns an empty final transcript or `No speech recognized`, the watch sends the last nonblank partial transcript instead of dropping the turn. The raw 24 kHz PCM relay remains as the fallback when no recognizer service is available and as the debug path for synthetic endpointing/replay validation. Both Android phone and Wear apps expose the native assistant role surface with `VoiceInteractionService` and `VoiceInteractionSession`: public Android `ACTION_ASSIST` foregrounds only, while automatic assistant-triggered dictation comes from the system-bound session through an in-process trusted bridge. Phone assistant invocation opens the Voice tab and starts the normal platform `SpeechRecognizer` dictation path; watch assistant invocation starts the existing watch text-turn path. Role setup uses `RoleManager.ROLE_ASSISTANT` on each device and only appears when that device exposes the role. The phone-side relay handles watch text turns by skipping Gateway transcription and sending the transcript through normal `chat.send` with the watch-owned `thinking` level, `fastMode: true`, and the configured Wear target session. Raw PCM turns still use buffered Gateway transcription first. Both paths synthesize the final assistant text through Gateway `talk.speak`, prefer MP3/Opus response formats when negotiated, and apply final TTS playback gain locally on the watch without mutating provider audio artifacts on the wire. The watch persists `rotary_control_mode` in `openclaw.watch.settings`, defaults existing installs to media-volume control, and persists `tts_playback_gain` only after the user adjusts gain; absence keeps the existing 1.5x default. TTS gain is clamped to 0.5x..10.0x in 0.1x steps and applies only to assistant-response playback paths, not raw debug playback unless the debug path enters normal assistant-response playback.

Session target carry behavior: this fork keeps Android node identity device-scoped for presence, pairing, and capability commands, but makes the conversation target explicit. The default `SessionTargetMode.FollowSelected` starts from the Gateway canonical main session and lets chat, phone voice, Canvas restore/actions, and Wear voice follow the currently selected phone chat session. `SessionTargetMode.Main` pins those surfaces to the Gateway canonical main session, and `SessionTargetMode.Device` preserves upstream-style per-device node session isolation. First launch with this seam clears legacy Wear-only target overrides so old `wear.targetSessionKey` values do not keep the watch pinned to a stale session; after migration, a nonblank `wear.targetSessionKey` remains an explicit override for watch turns only.

Primary seam files:

- `apps/android/app/src/main/AndroidManifest.xml`
- `apps/android/app/src/main/java/ai/openclaw/app/AssistantLaunch.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/MainActivity.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/MainViewModel.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/assistant/AssistantTrustedStartBridge.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/assistant/OpenClawRecognitionService.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/assistant/OpenClawVoiceInteractionService.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/assistant/OpenClawVoiceInteractionSession.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/assistant/OpenClawVoiceInteractionSessionService.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/assistant/PhoneAssistantEntry.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/NodeRuntime.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/SessionKey.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/SessionTargetMode.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/SecurePrefs.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/ui/SettingsScreens.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/ui/SettingsSheet.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/ui/VoiceScreen.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/wear/WearAudioRelay.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/wear/WearSttTtsSession.kt`
- `apps/android/app/src/main/java/ai/openclaw/app/wear/WearRelayService.kt`
- `apps/android/app/src/main/res/xml/interaction_service.xml`
- `apps/android/app/src/main/res/xml/recognition_service.xml`
- `apps/android/app/src/test/java/ai/openclaw/app/AssistantLaunchTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/assistant/PhoneAssistantEntryTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/ui/VoiceScreenLogicTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/wear/WearAudioRelayTextTurnTest.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/wear/WearSttTtsSessionTest.kt`
- `apps/android/app/src/main/res/values/wear.xml`
- `apps/android/audio/build.gradle.kts`
- `apps/android/audio/src/main/java/ai/openclaw/audio/PcmAudio.kt`
- `apps/android/audio/src/main/java/ai/openclaw/audio/AndroidCompressedAudioDecoder.kt`
- `apps/android/common/build.gradle.kts`
- `apps/android/common/src/main/java/ai/openclaw/common/speech/SpeechRecognizerHelper.kt`
- `apps/android/common/src/main/java/ai/openclaw/common/wear/WearRelayProtocol.kt`
- `apps/android/README.md`
- `apps/android/gradle.properties`
- `apps/android/gradle/libs.versions.toml`
- `apps/android/settings.gradle.kts`
- `apps/android/wear/build.gradle.kts`
- `apps/android/wear/lint.xml`
- `apps/android/wear/proguard-rules.pro`
- `apps/android/wear/src/main/AndroidManifest.xml`
- `apps/android/wear/src/main/java/ai/openclaw/wear/WatchApp.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/WatchMainActivity.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/WatchViewModel.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/AssistantTrustedStartBridge.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/OpenClawRecognitionService.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/OpenClawVoiceInteractionService.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/OpenClawVoiceInteractionSession.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/OpenClawVoiceInteractionSessionService.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/WatchAssistantEntry.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/ambient/AmbientState.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/AudioCapture.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/AudioEndpointDetector.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/AudioPlayer.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/AudioTrackFactory.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/WearAudioRecord.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/PcmBoundarySmoother.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/AcousticAudioDebugCapture.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/PlaybackAudioDebugCapture.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/WireAudioDebugCapture.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/PhoneRelayClient.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/AudioStreamAssembler.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/BufferedAudioResponseReceiver.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/StreamingAudioResponseReceiver.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/speech/SpeechDictation.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/ui/WatchFace.kt`
- `apps/android/wear/src/main/res/xml/data_extraction_rules.xml`
- `apps/android/wear/src/main/res/xml/interaction_service.xml`
- `apps/android/wear/src/main/res/xml/network_security_config.xml`
- `apps/android/wear/src/main/res/xml/recognition_service.xml`
- `apps/android/wear/src/test/java/ai/openclaw/wear/WatchViewModelTest.kt`
- `apps/android/wear/src/test/java/ai/openclaw/wear/assistant/WatchAssistantEntryTest.kt`
- `apps/android/wear/src/test/java/ai/openclaw/wear/speech/SpeechDictationTest.kt`
- `apps/android/wear/src/test/java/ai/openclaw/wear/ui/WatchFaceHelpersTest.kt`
- `apps/android/wear/src/test/java/ai/openclaw/wear/audio/AudioCaptureTest.kt`
- `apps/android/wear/src/test/java/ai/openclaw/wear/audio/AudioEndpointDetectorTest.kt`
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
- `docs/plan/wear-assistant-entrypoint.md`

Primary seam tests:

- `cd apps/android && ./gradlew :app:testThirdPartyDebugUnitTest --tests ai.openclaw.app.wear.WearAudioRelayTextTurnTest`
- `cd apps/android && ./gradlew :app:testThirdPartyDebugUnitTest --tests ai.openclaw.app.wear.WearSttTtsSessionTest`
- `cd apps/android && ./gradlew :wear:testDebugUnitTest --tests ai.openclaw.wear.WatchViewModelTest`
- `cd apps/android && ./gradlew :wear:testDebugUnitTest --tests ai.openclaw.wear.WatchViewModelTest --tests ai.openclaw.wear.ui.WatchFaceHelpersTest`
- `cd apps/android && ./gradlew :wear:testDebugUnitTest --tests ai.openclaw.wear.WatchViewModelTest --tests ai.openclaw.wear.assistant.WatchAssistantEntryTest --tests ai.openclaw.wear.speech.SpeechDictationTest`
- `cd apps/android && ./gradlew :app:testPlayDebugUnitTest --tests ai.openclaw.app.AssistantLaunchTest --tests ai.openclaw.app.assistant.PhoneAssistantEntryTest --tests ai.openclaw.app.ui.VoiceScreenLogicTest :wear:testDebugUnitTest --tests ai.openclaw.wear.assistant.WatchAssistantEntryTest --tests ai.openclaw.wear.speech.SpeechDictationTest --tests ai.openclaw.wear.ui.WatchFaceHelpersTest`
- `cd apps/android && ./gradlew :wear:testDebugUnitTest --tests ai.openclaw.wear.audio.AudioCaptureTest --tests ai.openclaw.wear.audio.AudioEndpointDetectorTest --tests ai.openclaw.wear.audio.PcmAudioTest`
- `cd apps/android && ./gradlew :app:compilePlayDebugKotlin :wear:compileDebugKotlin :app:testPlayDebugUnitTest :wear:testDebugUnitTest :app:ktlintCheck :wear:ktlintCheck`
- `node scripts/run-vitest.mjs src/gateway/chat-final-audio.test.ts src/gateway/gateway-misc.test.ts src/gateway/talk-transcription-relay.test.ts`
- `pnpm exec oxfmt --check --threads=1 apps/android/scripts/build-release-artifacts.ts src/gateway/gateway-misc.test.ts package.json`
- `git diff --check`

Rebase notes:

- Keep phone discovery capability-based. The watch must use `CapabilityClient.getCapability("openclaw_relay_phone", FILTER_REACHABLE)`, and the phone app must advertise the capability from `apps/android/app/src/main/res/values/wear.xml`.
- Keep each watch turn pinned to one phone node and one turn id. Do not broadcast active-turn audio to every connected phone; late status/error/audio from another node or stale turn must be ignored.
- Preserve compatibility for legacy/no-turn terminal responses only while a turn is active. Both `PhoneRelayClient` and `WatchViewModel` must treat a null response turn id as the active turn, then clear active state on terminal audio/error/incomplete chunk timeout.
- Keep chunked audio responses serialized with a done payload carrying `chunkCount`; do not emit partial audio until every expected chunk is assembled, and keep the timeout path user-visible as `Audio response incomplete`.
- Keep `Close` before transcription `Ready` user-visible on the watch instead of leaving the watch stuck in `Processing`.
- Keep `WearRelayService` as the background Wearable Data Layer entrypoint, but let the foreground `NodeRuntime` relay own messages when it is already initialized so duplicate service delivery does not double-handle a turn.
- Keep the phone-side Wear relay on the normal durable turn path. STT still uses Gateway `talk.session.*` transcription events, but assistant replies should route through `chat.send`, reusable final TTS audio, and `talk.speak` only as fallback.
- Keep watch dictation text turns as the primary user path. Fall back to raw PCM only before capture starts when `SpeechRecognizer` is unavailable or debug PCM/endpoint replay is explicitly invoked; once recognition has started, no-match/client/network errors should surface briefly and return to idle instead of trying to reconstruct missed audio.
- Keep the last nonblank dictation partial as a sendable transcript until a final transcript or terminal error resolves the turn. This protects Wear OS recognizers that display correct partial text but still end with an empty final transcript or `No speech recognized`.
- Keep watch transcript status text raw. Do not prefix partial or final transcript display with `Heard:`.
- Keep `AndroidSpeechDictation` targeting a non-OpenClaw recognition service component. If only OpenClaw's assistant metadata stub is present, dictation must report unavailable so raw PCM fallback remains reachable.
- Keep assistant-triggered dictation guarded. Do not accept spoofable extras or public `ACTION_ASSIST` launches to start microphone capture; auto-start must come from the system-bound voice interaction session through `AssistantTrustedStartBridge`, and only the foreground/resumed activity path should consume that one-shot request. Preserve `onNewIntent()` handling for `SINGLE_TOP` assistant launches.
- Keep phone Voice tab transcript ownership mode-specific. The landing `Start Talk` surface should render realtime Talk entries only; dictation entries belong to the active Dictation screen and must not appear under the Talk CTA after capture returns to idle.
- Keep watch `Cancel` as a real abort, not a retry label. While listening it must cancel platform dictation or raw audio capture and discard pending audio/text. While processing or playing it must send the relay cancel request, stop local playback, invalidate stale callbacks, and ignore late status/error/audio from the old turn.
- Keep watch endpointing conservative. The fallback raw PCM path uses a longer end-silence window than the stock endpoint detector so watch speech is less likely to be cut off before the user finishes.
- Keep `WatchMainActivity` awake while it is open. The activity owns `FLAG_KEEP_SCREEN_ON` for the visible app lifetime and releases it when the user leaves by Back, Home, task switch, or other normal activity exit; do not regress to state-specific wake only. Ambient mode should still collapse to the minimal burn-in-safe watch face status instead of rendering the full interactive controls.
- Keep the voice interaction session UI disabled when handing off to `WatchMainActivity`; the session must not show a blank full-screen window over the watch dictation UI or permission prompt.
- Keep the watch assistant recognition-service delegate out of global `android.speech.RecognitionService` discovery unless it becomes a real recognizer, and keep it protected with `android.permission.BIND_SPEECH_RECOGNITION`. It exists for voice-interaction metadata and delegates to a non-OpenClaw recognizer; exposing it globally changes recognizer discovery and can block raw PCM fallback on watches without a real recognizer.
- Keep `/openclaw/watch/text/{turnId}` additive and shared through `apps/android/common`. Phone text turns must not create `talk.session.*` transcription sessions, and blank transcripts must fail without starting `chat.send`.
- Keep watch-initiated `chat.send` using low reasoning. This is a latency/thermal constraint for the watch UX, not a general Android chat default.
- Keep compressed response negotiation honest. MP3 and Opus payloads can be passed through only when the watch advertises support and the decoder path is covered; otherwise the phone should decode to PCM before delivery.
- Keep rotary/ring control watch-local. Default mode is `media_volume`, alternative mode is `tts_gain`, both selected from the existing watch settings pager. Media mode controls `AudioManager.STREAM_MUSIC` through the watch-side volume adapter with no system volume UI flags; fixed or unavailable volume should show a short unavailable overlay and make no persisted change. Gain mode changes only `tts_playback_gain` in `openclaw.watch.settings`, clamps to 0.5x..10.0x, shows the centered overlay, and gives haptic feedback only when a rotary event actually changes the selected value. Suppress the overlay in ambient mode.
- Keep mobile target-session routing generic. By default, `SessionTargetMode.FollowSelected` plus an unset `wear.targetSessionKey` makes phone voice, Canvas actions, and Wear voice follow the phone's currently selected chat session. `SessionTargetMode.Main` pins those surfaces to the Gateway canonical main session, `SessionTargetMode.Device` keeps the upstream per-device node session, and an explicit Session Target panel Wear override value overrides only watch turns. Wear code must not depend on Telegram-specific adapter internals or personal device names.
- Keep active voice turns session-stable. Phone PTT turns capture the target session at `chat.send` time, realtime Talk Mode sessions capture it at `talk.session.create` time, and Wear turns capture it at recording start. Visible chat selection may change while these are in flight, but completion events, history fallback, tool calls, and steer calls must continue using the captured session.
- Keep `chat.finalAudio.get` additive and hidden. It should expose only trusted, run-scoped local audio already produced by the chat reply pipeline, return not-found/unreadable states as fallback signals, and avoid persistent state.
- A Wear service cold start must not restore persisted phone manual mic capture. Restore that preference only from foreground/UI runtime activation.
- Wear consults and phone Talk Mode turns can overlap; pending chat completion tracking must be per `runId`, not a single shared waiter.
- Keep watch processing timeouts long enough for slow realtime/chat turns; the current watchdog is 180 seconds, not the older 60-second path.
- Keep outbound Wear Data Layer sends bounded and node-pinned. Audio chunks may be dropped under backpressure, but control messages must still be delivered in order.
- Keep packaging proof tied to the Android release helper. `build-release-artifacts.ts` must build and copy all three release artifacts (Play AAB, third-party APK, and `:wear:bundleRelease` AAB) without silently dropping the watch companion, and the `:wear` module must keep reading its version from `Config/Version.properties` so the watch artifact stays in lockstep with `:app`.
- Keep the shared `:audio` module for PCM/resampling/codec helpers that both `:app` and `:wear` consume. Do not duplicate codec logic back into either module.
- Keep the `AudioStreamAssembler` + `BufferedAudioResponseReceiver`/`StreamingAudioResponseReceiver` split so the watch can switch between whole-buffer and streaming audio delivery without rewriting the relay client.
- Keep `WearSttTtsSession` as the canonical phone-side session class; do not resurrect the old `WearAudioSession` split.
- Keep a watch-side no-response watchdog for active `Processing` turns so stale phone/chat failures do not leave the watch spinning indefinitely.
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

Carry behavior: native Codex sessions that expose visible replies through `sourceVisibleReplies: "message_tool"` / `message_tool_only` must still deliver TTS correctly. Visible `message(action=send)` sends must apply final-reply TTS before gateway/plugin dispatch, trusted local voice tool media must survive source-reply suppression without leaking private final text, direct `openclaw agent --deliver` final replies must append generated TTS as a supplemental media payload, and synthetic auto-TTS final/audio-only replies must preserve the local-media trust signal when block streaming consumes the visible final text. Internal-ui source-reply mirrors that already carry TTS media must be projected once without re-running final TTS; duplicate normal final text returned by the model remains suppressed by `message_tool_only`. Telegram/Discord voice-note delivery must stay transcode-aware so provider WAV output becomes native voice delivery instead of a plain file attachment. Channel TTS voice capabilities must be available through lightweight bundled public artifacts so the hot speech path does not materialize full channel plugins while selecting synthesis target, pre-transcode behavior, or `audioAsVoice`.

Primary seam files:

- `src/infra/outbound/message-action-runner.ts`
- `src/infra/outbound/message-action-tts.ts`
- `src/agents/command/delivery.ts`
- `src/agents/command/delivery.test.ts`
- `src/infra/outbound/message-action-runner.plugin-dispatch.test.ts`
- `extensions/codex/src/app-server/dynamic-tools.ts`
- `extensions/codex/src/app-server/event-projector.ts`
- `src/agents/embedded-agent-runner/run.ts`
- `src/agents/embedded-agent-runner/run/attempt.ts`
- `src/agents/embedded-agent-runner/run/message-tool-terminal.ts`
- `src/agents/embedded-agent-runner/run/payloads.ts`
- `src/agents/embedded-agent-runner/run/tool-media-payloads.ts`
- `src/agents/embedded-agent-subscribe.ts`
- `src/agents/embedded-agent-subscribe.handlers.tools.ts`
- `src/auto-reply/reply/dispatch-acp.ts`
- `src/auto-reply/reply/dispatch-acp-delivery.ts`
- `src/auto-reply/reply/dispatch-from-config.ts`
- `src/auto-reply/reply/dispatch-from-config.test.ts`
- `src/auto-reply/reply/tts-trusted-media.ts`
- `src/auto-reply/reply/tts-trusted-media.test.ts`
- `extensions/telegram/src/action-runtime.ts`
- `extensions/telegram/src/limits.ts`
- `extensions/telegram/src/outbound-adapter.ts`
- `extensions/telegram/src/outbound-adapter.test.ts`
- `extensions/telegram/src/send.ts`
- `extensions/telegram/src/send.test.ts`
- `extensions/telegram/src/bot/delivery.replies.ts`
- `extensions/telegram/src/telegram-outbound.test.ts`
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
- `packages/speech-core/src/tts.ts`
- `packages/speech-core/src/tts.test.ts`
- `src/channels/plugins/tts-capabilities.ts`
- `src/channels/plugins/tts-capabilities.test.ts`
- `src/plugins/bundled-plugin-metadata.test.ts`
- `src/cli/program/message/helpers.ts`

Primary seam tests:

- `src/infra/outbound/message-action-runner.plugin-dispatch.test.ts`
- `src/infra/outbound/message-action-runner.core-send.test.ts`
- `src/agents/command/delivery.test.ts`
- `extensions/codex/src/app-server/dynamic-tools.test.ts`
- `extensions/codex/src/app-server/event-projector.test.ts`
- `src/agents/embedded-agent-runner/run/message-tool-terminal.test.ts`
- `src/agents/embedded-agent-runner/run/payloads.test.ts`
- `src/agents/embedded-agent-runner/run/tool-media-payloads.test.ts`
- `src/agents/embedded-agent-subscribe.handlers.tools.test.ts`
- `src/auto-reply/reply/dispatch-acp.test.ts`
- `src/auto-reply/reply/dispatch-acp-delivery.test.ts`
- `src/auto-reply/reply/dispatch-from-config.test.ts`
- `src/auto-reply/reply/tts-trusted-media.test.ts`
- `extensions/telegram/src/action-runtime.test.ts`
- `extensions/telegram/src/send.test.ts`
- `extensions/telegram/src/outbound-adapter.test.ts`
- `extensions/telegram/src/telegram-outbound.test.ts`
- `extensions/telegram/src/voice.test.ts`
- `extensions/telegram/src/bot/delivery.test.ts`
- `packages/speech-core/src/tts.test.ts`
- `src/channels/plugins/tts-capabilities.test.ts`
- `src/plugins/bundled-plugin-metadata.test.ts`
- `src/cli/program/message/helpers.test.ts`
- focused native proof via `node dist/index.js message send --channel telegram ... [[tts:text]]...[[/tts:text]]`

Rebase notes:

- `v2026.5.16-beta.7` already includes adjacent native Codex message-tool/private-final and transcript-mirror protections. Keep this seam only for the still-missing pieces: trusted local voice media through `message_tool_only`, generated TTS local-media trust, voice-note transcode truth, and lightweight channel TTS capability lookup.
- Do not replay the stale upstream message-tool TTS patches blindly. Rebuild the seam against the current outbound runner, current Codex app-server telemetry shape, and current channel voice capabilities.
- The invariant is earlier than `executeSendAction`: gateway-owned/plugin-routed `send` actions must apply TTS before the gateway branch returns, not only on the core send path.
- The direct `openclaw agent --deliver` path is part of the same invariant. It is not a message-action send, but final text still needs the final-reply TTS pass and a supplemental trusted local media payload before channel delivery.
- Async/deferred TTS supplements must be delivered after the visible text payload without replacing that text. The runner should keep the user-visible reply immediate and then send the generated audio supplement through the same channel/plugin context.
- In `message_tool_only`, keep the private final assistant text suppressed. Only trusted local voice media may bypass source-reply suppression, and only as a media-only payload.
- Internal-ui source-reply mirrors are the live Gateway/TUI projection vehicle, but a mirror that already carries `ttsSupplement.spokenText` plus media is already the TTS result. Dispatch must not call final TTS again for that mirror; it should still normalize media, run final hooks, mirror transcript metadata, and queue/broadcast the single final payload. Text-only mirrors still take the normal one-pass final TTS path.
- Preserve the trusted-media signal end to end through Codex tool telemetry, embedded attempt results, and final payload merging. Losing `trustedLocalMedia` is a functional regression, not a harmless metadata drop.
- Synthetic auto-TTS generated after block streaming is part of the same seam. When `messages.tts.mode = "final"` and block/ACP streaming leaves no normal final payload, the rebuilt media-only final reply must mark generated local/file TTS media as `trustedLocalMedia` before Telegram/Discord delivery. Do not mark remote or mixed local/remote media as trusted.
- Keep voice-note channel capabilities honest. Telegram and Discord both need transcode-aware TTS handling; if the channel can make provider output voice-compatible, advertise `transcodesAudio: true` so speech-core does not fall back to plain audio-file semantics.
- Keep channel TTS voice capability lookup on narrow public artifacts such as `tts-capabilities-api.js`, not `getChannelPlugin`. The speech-core request path may resolve the delivery fact once and reuse it, but must not cross the full bundled channel plugin loader to answer target/pre-transcode/`audioAsVoice` decisions.
- Keep Telegram voice sends able to repair non-voice-compatible audio locally before `sendVoice`, and re-prove both the direct send path and the bot reply-delivery path.
- Keep Telegram text chunking centralized on `TELEGRAM_TEXT_CHUNK_LIMIT` and shared between bot replies and outbound payload delivery. Changing one path without the other can reintroduce oversize-message behavior or inconsistent caption splitting.
- Preserve `audioAsVoice` from both the durable payload and the channel send context into Telegram media delivery. Missing that context can make generated voice TTS arrive as ordinary audio even though the payload was synthesized for voice delivery.
- Keep CLI `message send` preloading the scoped channel plugin for gateway-owned sends when plugin routing needs it, but do not depend on that preload for speech-core TTS capability truth. Missing lightweight artifacts can make speech-core miss channel TTS capabilities and synthesize WAV `audio-file` output that never reaches the voice/transcode branch.
- Re-prove the seam after replay with both focused tests and a live Telegram smoke after build/restart. The important failure signature is a delivered `voice-*.wav` attachment instead of a native voice message.

Closeout proof from the 2026-06-21 direct-delivery async TTS pass:

- Focused regression batch: `pnpm test src/agents/command/delivery.test.ts src/infra/outbound/message-action-runner.core-send.test.ts src/infra/outbound/message-action-runner.plugin-dispatch.test.ts extensions/telegram/src/outbound-adapter.test.ts extensions/telegram/src/telegram-outbound.test.ts extensions/telegram/src/send.test.ts extensions/telegram/src/voice.test.ts extensions/telegram/src/bot/delivery.test.ts` passed targeted Vitest shards.
- Static proof: `node_modules/.bin/oxfmt --check --threads=1` on the touched delivery/TTS/Telegram files passed; `node scripts/run-oxlint.mjs --tsconfig config/tsconfig/oxlint.core.json` on the core touched files passed; `node scripts/run-oxlint.mjs --tsconfig config/tsconfig/oxlint.extensions.json` on the Telegram touched files passed; `git diff --check` passed.
- Build/prod proof: `pnpm build` passed, then `systemctl --user restart openclaw-gateway.service` restarted the managed Gateway and `pnpm openclaw channels status --json` reported Telegram running/connected with no `lastError`.
- Live Telegram smoke: `openclaw agent --agent sky --message "Sky voice final regression sweep: reply with exactly 'Sky final voice OK'." --deliver --reply-channel telegram --reply-to 1637222485 --reply-account default --timeout 180 --json` produced run `3a2bf2d7-0dee-43f3-a35e-90c782525291`, delivered visible text plus `/tmp/openclaw/tts-gcWIQM/voice-1782041688674.opus`, and the Opus file probed as mono 48 kHz audio with 2.457 s duration. User confirmed the Telegram audio arrived.

Closeout proof from the 2026-06-16 duplicate-source-reply pass:

- Focused regression: `node scripts/run-vitest.mjs src/auto-reply/reply/dispatch-from-config.test.ts -t "does not re-synthesize or redeliver internal source replies" --no-watch`.
- Dispatch surface: `node scripts/run-vitest.mjs src/auto-reply/reply/dispatch-from-config.test.ts --no-watch`.
- Adjacent source-reply surfaces: `node scripts/run-vitest.mjs src/gateway/server-methods/chat.directive-tags.test.ts --no-watch`, `node scripts/run-vitest.mjs src/agents/embedded-agent-runner/run/message-tool-terminal.test.ts --no-watch`, and `node scripts/run-vitest.mjs src/agents/embedded-agent-runner/run/payloads.test.ts --no-watch`.
- Review: focused `@reviewer` pass found no actionable findings; residual risk is limited to future producer paths that attach TTS media without `ttsSupplement.spokenText`.
- Build/deploy: `git diff --check`, `pnpm build`, and explicit `pnpm ui:build` passed; `openclaw gateway restart && openclaw gateway status --deep` restarted `openclaw-gateway.service` and reported `Connectivity probe: ok` on PID `2827297`. Existing config warning: disabled bundled WhatsApp plugin has config present.

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

### Systemd EnvironmentFile shell-safe value quoting

Carry behavior: the generated systemd `EnvironmentFile` single-quotes any value outside a conservative shell-safe set (`SHELL_SAFE_ENV_VALUE = /^[A-Za-z0-9_./:@%+=,-]*$/`) so the file stays safe to `source` in a POSIX shell and so an operator's manual quoting survives re-stage. systemd's own `EnvironmentFile` parser preserves unquoted internal spaces, so this is a shell-safety + operator-intent guarantee, not a systemd-correctness fix. Both systemd and OpenClaw's `parseEnvironmentFileLine` reader strip the surrounding single quotes, so the round-trip value is unchanged. Plain values (ports, JWT-only tokens, `-`/`_`/`.` keys) stay unquoted, so byte output for existing files is unchanged.

Primary seam files:

- `src/daemon/systemd.ts`
- `src/daemon/systemd.test.ts`

Primary seam tests:

- `node scripts/run-vitest.mjs src/daemon/systemd.test.ts`

Rebase notes:

- Quoting is write-side only: the `quoteSystemdEnvFileValue` helper sits directly above `writeSystemdGatewayEnvironmentFile`, and the wrapper is applied at the `${key}=${quoteSystemdEnvFileValue(value)}` content build. If upstream rewrites that `${key}=${value}` join, re-apply the wrapper there.
- Do not add a reader-side decode. `parseEnvironmentFileLine` already strips both `'...'` and `"..."`; it is shared with the unit `Environment=` read path, so leave it untouched.
- Keep the helper local to `systemd.ts`; do not unify it with `shellQuoteArg` (`service-layout.ts`) or `shellSingleQuote` (`launchd.ts`) unless upstream introduces a shared env-quoting utility. A single-file seam rebases cleanly.
- Keys are never quoted (validated via `normalizeSystemdEnvironmentKey`).
- A literal single quote in a value does not round-trip through `parseEnvironmentFileLine` (it does not decode `'\''`); acceptable because real tokens/keys/secrets do not contain single quotes.
- The `#88274` operator-secret test now expects the literal-`$` value single-quoted (`LOWERCASE_LITERAL_API_KEY='$ecret123'`); the value is still preserved, just shell-safe.

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
