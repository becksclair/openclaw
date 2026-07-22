# OpenClaw Fork Replay Ledger

This file is Bex's fork carry contract for the `openclaw-fork-replay` skill. It is intentionally shaped for `openclaw-fork-replay/scripts/impact_map.py`.

The replay unit is behavior, not old commits. Reimplement each seam against current upstream and re-prove the behavior through the runtime, config, plugin, or service surface that actually uses it.

Current replay target: `v2026.7.1` (`2d2ddc43d0`). Security fixes #102403 and #102398 remain fork carries because the stable target does not contain them.

Replay classification:

- Runtime carries: behavior that still needs fork code on top of the target.
- Partial-overlap carries: behavior upstream partly covers, but not enough to drop the fork seam.
- Support/proof carries: replay policy, tooling, tests, or ledger structure. These are not product behavior and should not be treated as runtime seams during conflict triage.

## v2026.7.1 seam necessity review

Replayed from fork head `cd140f04eb` onto upstream `v2026.7.1` (`2d2ddc43d0`). The stable target absorbed the newer Codex binding-migration convergence implementation, while #102403, #102398, and the Responses Lite reasoning-context fix remain explicit carries.

This table is the authoritative seam list. `claw-fork-prep`'s `parse_ledger_seams()` reads only the first `| Seam | Decision |` table in this file, so a seam absent from it is invisible to the generated goal package. Every row below must have a matching `### <exact name>` section under **Seam inventory** (or **Deferred live proof**), and every such section must have a row here. Seams removed from the carry live under **Dropped seams (do not reintroduce)** and must not reappear here.

Reconciled 2026-07-22 after the private npm deployment repair: **Private OpenClaw dependency publication** is a new support/proof carry that discovers, packs, verifies, and publishes every OpenClaw-owned root runtime before the private root package. The current table now contains 47 active carry rows plus 3 absorbed-upstream records.

The prior 2026-07-09 reconciliation covered the `v2026.7.1-beta.1..v2026.7.1-beta.3` delta: eight seams that existed only as `###` sections were added to this table (they were invisible to the prep generator); the misfiled **WhatsApp inbound message archive** row was moved here from the stale v2026.6.8 table; two drifted names were normalized (`Discord 30032 command deploy recovery` → `Discord command deploy 30032 recovery`; `Codex app-server force full access` → dropped entirely); and four seams were removed.

Two seams are absorbed by upstream this replay: **Reply session init burst serialization** (upstream shipped `runExclusiveSessionStoreWrite` around session initialization, so the fork queue was dropped) and **Gateway main session direct delivery** (`resolveChatSendOriginatingRoute` is byte-identical upstream). **Telegram transcribed-audio TTS intent** remains a partial-overlap carry through the shared outbound TTS path. The **Native Codex message-tool TTS delivery** and Telegram rich-message seams were reconciled onto upstream's current delivery contracts, and **Context-rich realtime Talk tools** was folded onto the current capability-policy abstraction.

| Seam                                                                 | Decision              | Importance | v2026.7.1-beta.3 evidence / replay note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backup archive owner-only mode                                       | Runtime carry         | High       | Stable still creates the archive output without mode `0o600`; replay source commit `add54436bb` remains required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Codex binding migration convergence                                  | Absorbed upstream     | High       | Stable commit `39fac06f48` and its newer bounded-fingerprint migration supersede source commit `03ac9ab6a0`; keep focused migration proof and the two-pass rehearsal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Mandatory Responses Lite reasoning context                           | Runtime carry         | High       | Stable lacks `extensions/openai/responses-lite.ts`; carry all-turn reasoning context, explicit `off` → wire `none` on normal and simple-completion paths, Lite-scoped transport headers, and the managed Codex package version captured at build/module startup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Managed native sky-cua Codex plugins                                 | Runtime carry         | Critical   | Stable has no consumer for the producer-owned `openai-bundled` marketplace. Carry the fixed-XDG pre-thread native installs for `computer-use` and `browser-use`, process-global per-client single-flight, Codex projection filtering for both plugin-owned MCP names, and the per-thread MCP-disable overlay.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Policy-safe plugin subagent delegation                               | Runtime carry         | High       | Stable's public plugin subagent facade lacks the thinking/tool override and capability contract required by `lossless-claw`. Carry policy-enforced model routing, fail-closed capability discovery, bounded/cancellable admission and session I/O, and total-message reply fencing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Wear OS voice companion                                              | Runtime carry         | Critical   | HEAD settings.gradle includes :wear/:audio/:common; wear/WatchViewModel.kt TTS gain=1.5 + RotaryStepAccumulator; WatchMainActivity FLAG_KEEP_SCREEN_ON; app compileSdk=37+ndkVersion, GatewayDiscovery CINNAMON_BUN. Tag: only :app/:benchmark, compileSdk=36, no wear/audio tree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ACP remote target-backed bridge                                      | Partial-overlap carry | Critical   | HEAD acp-spawn.ts:459 resolveTargetAcpAgentId extracts runtime.acp backend/target, threaded via targetBackendId:1372/targetRuntimeTarget:1373→spawn(target:1427,backendId:1511); schema.help.ts:321 runtime.acp.target; scripts/verify-codex-devbox-acp.js present. v2026.7.1-beta.1 returns only {agentId,configAgentId}, no target/backendId, verifier absent. acpx-remote out-of-tree in both.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Gateway runtime metadata hotpath                                     | Partial-overlap carry | Critical   | HEAD server.impl.ts:1354 captureCurrentPluginMetadataSnapshotState, :1400 applyPluginAutoEnable, :1416 restore-on-error try/catch, :1421 compatibleConfigs:[nextPluginRuntimeConfig] — all ABSENT in v2026.7.1-beta.1 server.impl.ts (reload sets snapshot at :1385 w/o restore). Snapshot module + server-model-catalog.ts byte-identical (empty diff); upstream uses restore only in list.status-command.ts:191.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ACP backend alias routing                                            | Partial-overlap carry | High       | HEAD acp-spawn.ts:471 reads runtime.acp?.backend/.target; :1372 targetBackendId=result.backendId??cfg.acp?.backend; :1511 fwd into init; :1109 backendId=params.backendId??cfg.acp?.backend. Tag:1099 only cfg.acp?.backend, resolveTargetAcpAgentId lacks backend. Upstream schema.help.ts:313 field + binding-consumer:50 use it (diff path).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ACP backend-managed runtime options                                  | Runtime carry         | High       | HEAD types.ts:78 adds managedRuntimeOptionKeys; manager.runtime-controls.ts:117/164 emits it + filters unmanagedConfigOptions. Tag v2026.7.1-beta.1 types.ts:66 AcpRuntimeCapabilities has only configOptionKeys (no managed field); tag manager applies all configOptions unfiltered (grep for both symbols empty).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Native Codex message-tool TTS delivery                               | Partial-overlap carry | High       | HEAD telegram/src/voice.ts:41 exports prepareTelegramVoiceMedia (Opus transcode) used in delivery.replies.ts:467 + send.ts:1257; ABSENT in v2026.7.1-beta.1 (only resolveTelegramVoiceSend). Codex audioAsVoice threading dynamic-tools.ts:1068/1137 + telegram sendVoice/wantsVoice are full-upstream (both refs).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Gateway message-tool history projection                              | Partial-overlap carry | High       | mirrorMessageToolVisibleReplies in both (chat-display-projection.ts:957); HEAD refines flush (flushSucceededMirrors at user boundary+final flush, line 1019/1083) vs tag clearPending/flushSelectedMirrors(flushAfterCurrentMessage,1078). HEAD resolveMessagingToolSendText w/ SendMessage alias (tools.ts:99,212) replaces tag readMessagingText (547).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Gateway main session display title                                   | Runtime carry         | Medium     | HEAD session-utils.ts: CANONICAL_MAIN_DISPLAY_NAME "Main session" (L158) + isCanonicalMainSessionKey (L2219); used in buildGatewaySessionRow displayName (L1892) and resolveSessionListSearchDisplayName (L2258). Tag v2026.7.1-beta.1: symbols absent, fallback is bare entry?.label ?? originLabel (L1890) / entry?.origin?.label (L2236).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Notification heartbeat wakes                                         | Partial-overlap carry | Medium     | HEAD src/gateway/self-notification.ts (collectOwnNotificationIdentities/isSelfAuthoredNotification) + server-node-events.ts self-tag & shouldSuppressConsecutiveNotificationWake(HEAD:88) + heartbeat-runner.ts isSelfAuthoredNotificationEntry; all absent in tag. TAG server-node-events.ts:655 only basic requestHeartbeat(source:notifications-event,intent:event)+HEARTBEAT_TOKEN.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Forced heartbeat tool construction                                   | Partial-overlap carry | Medium     | HEAD attempt-tool-construction-plan.ts:135 merge accepts forceHeartbeatTool + forces "heartbeat_respond"; :203/:219 plan threads it; attempt.ts:1196-1208 passes it. Upstream v2026.7.1-beta.1 same file:135 merge is forceMessageTool-only, plan(:193) lacks forceHeartbeatTool, attempt.ts:1183 omits it. Broader forceHeartbeatTool infra exists upstream (agent-tools.ts:618, heartbeat-runner.ts:1938).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Lobster workspace cwd sandbox                                        | Partial-overlap carry | Medium     | HEAD lobster-runner.ts:146 resolveLobsterCwd(cwd,{baseCwd}) roots at ctx.workspaceDir (index.ts:20 cwdBase), allows abs inside workspace ("must stay within the Lobster working directory"). v2026.7.1-beta.1 same file:146 resolveLobsterCwd(cwd) roots at process.cwd(), rejects ALL abs ("must be a relative path"), no baseCwd/workspace context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Persistent Codex memory recall                                       | Partial-overlap carry | High       | HEAD active-memory/index.ts:3067 promptProfile:'memory_recall',:3075 suppressPluginHooks,:2971 keepCodexClientWarm,:3081 fastMode inherit; codex run-attempt.ts:387 isCodexMemoryRecallPromptProfile. v2026.7.1-beta.1: suppressPluginHooks=0 hits, codex memory_recall=0 hits, recall run@3006 has lane but none of these fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Context-engine prompt budget accounting                              | Runtime carry         | High       | HEAD runtime: types.ts:113 ContextEnginePromptBudget; runtime-settings.ts:40 buildContextEnginePromptBudget + limits.contextEngineBudget; run-attempt.ts:1237 buildCodexContextEnginePromptBudget drives enginePromptTokenBudget projection; run-attempt.ts:1372 replayPrecomputedPromptBuildFromCurrentInputs. v2026.7.1-beta.1: base context-engine files exist but 0 hits for all budget symbols tree-wide.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Lossless transcript-wedge rebootstrap                                | Runtime carry         | High       | Core hook in HEAD: attempt-context.ts:130/155 (readContextEngineThreadBootstrapProjection, resolveContextEngineBootstrapProjectionDecision), session-binding.ts:100 mode:"thread_bootstrap", run-attempt.ts:675 + rotateOversizedCodexAppServerStartupBinding:779/1652 (projection-mismatch reproject). Same hook in v2026.7.1-beta.1 (attempt-context.ts:97/122, session-binding.ts:98/328, run-attempt.ts:484/588). But summary-prefix-v1 / context_projection_reset_generation absent from BOTH refs = external lossless-claw plugin; fork adds no host delta (bex-fork.md:473).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Lossless Active Memory recall expansion                              | Runtime carry         | High       | HEAD extensions/active-memory/index.ts:1205 isLosslessExpansionSubagentSession + guard@3738 (skips recall in lcm-expand subagents); src/agents/agent-command.ts:1817 fastModeStartedAtMs=opts.fastModeStartedAtMs??Date.now(). Tag v2026.7.1-beta.1 lacks both: no lcm-expand/lossless in active-memory; agent-command.ts:1817 hardcodes Date.now(). ContextEngine slot exists in both.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Status-only command progress text                                    | Partial-overlap carry | Medium     | HEAD threads toolResultCommandText (embedded-subscribe.ts:739, cli-dispatch.ts:288, codex projector.ts:1426/1691) + exports isCommandToolName (tool-meta.ts:11, agent-harness-runtime.ts:139). tag v2026.7.1: 0 toolResultCommandText hits; only draft-line commandText "status" in streaming.ts:540, no SDK export.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Discord command deploy 30032 recovery                                | Runtime carry         | Medium     | HEAD provider.deploy-errors.ts:376 isDiscordDeployCommandLimit (code 30032, :383); provider.deploy.ts:159 falls back to deployCommands({mode:"overwrite",force:true}). Upstream v2026.7.1-beta.1 deploy-errors.ts has only isDiscordDeployDailyCreateLimit(30034):360, no 30032; deploy.ts:142 only mode:"reconcile".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Discord auto-presence account auth store                             | Runtime carry         | Medium     | HEAD extensions/discord/src/monitor/auto-presence.ts:56-59 loadDiscordAccountAuthProfileStore uses resolveAgentRoute+resolveAgentDir; default loader L308. v2026.7.1-beta.1 same file L292 bare ensureAuthProfileStore(), no routing/agentDir import.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Google TTS volume gain                                               | Runtime carry         | Medium     | HEAD extensions/google/speech-provider.ts: applyPcm16VolumeGain def L468, applied in synthesize L684 & synthesizeTelephony L709 over synthesizeConfiguredGoogleTts; volumeGain config L76, normalizeGoogleTtsVolumeGain L161. Tag v2026.7.1-beta.1: same file returns pcm directly (L634-658), git grep -i volumegain/applyPcm16 in extensions/google = no hits (exit1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Private plugin sidecar baseline filtering                            | Support/proof carry   | Medium     | HEAD: scripts/lib/tracked-bundled-plugin-dirs.mjs listTrackedBundledPluginDirs (git ls-files); generate-runtime-sidecar-paths-baseline.ts passes trackedDirNames; src/plugins/runtime-sidecar-paths-baseline.ts filters entries by trackedDirNames?.has(dirName). v2026.7.1-beta.1: helper absent, no trackedDirNames symbol. Filter runs only in baseline gen/check tooling, not runtime consumer runtime-sidecar-paths.ts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Plugin SDK package-boundary artifacts                                | Support/proof carry   | Medium     | Build-tooling script scripts/prepare-extension-package-boundary-artifacts.mjs. HEAD adds stale-DTS delta: hasStaleOutput():376, STALE_PACKAGE_DTS_OUTPUTS:278, CHANNEL_CONTRACT_TESTING_DTS_INPUTS:74, removeIncrementalStateForMissingOrStaleOutput:386. Upstream v2026.7.1-beta.1 has only .boundary-dts.stamp + ENTRY_SHIMS + missing-only removeIncrementalStateForMissingOutput; no stale detection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Exec safe-bin realpath trust                                         | Partial-overlap carry | Medium     | HEAD src/infra/exec-safe-bin-trust.ts:191-206 isTrustedSafeBinPath adds resolvedRealPath param + requires real-target dir also trusted (test "requires symlink and real target directories to both be trusted"). Tag v2026.7.1-beta.1 (blob 701724a) has same helper+realpath plumbing but returns trustedDirs.has(resolvedDir) only, no resolvedRealPath/dual-dir invariant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Docker replay validation directives                                  | Support/proof carry   | Medium     | HEAD:AGENTS.md L127-128 (clean Docker validation container / test:docker:local:all lane) + L139-140 (no mounting Bex's real ~/.openclaw, credentials, Gateway state, private plugin/session data). Upstream v2026.7.1-beta.1:AGENTS.md grep count 0 for all four fork markers (`Bex fork replay`, `test:docker:local:all`, `mounting Bex`, `openclaw-fork-replay`); no openclaw-fork-replay ref anywhere in tag tree. Docs/policy only, no runtime code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Generic agent base prompt                                            | Runtime carry         | Medium     | HEAD adds src/agents/agent-base-prompt-file.ts (AGENT_BASE_PROMPT_FILENAME="agent-base.md"), codex-app-server-base-prompt.ts, voice-agent-base-prompt-file.ts, plus buildSandboxSection (system-prompt.ts:638) and agentBasePrompt wiring (:831,999-1145). v2026.7.1-beta.1: all 4 files missing, no buildSandboxSection/agent-base anywhere.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Context-rich realtime Talk tools                                     | Partial-overlap carry | Medium     | HEAD adds src/talk/realtime-{context,direct-tools,instructions}.ts (createRealtimeDirectTools/buildTalkRealtimeContextPacket), wired in talk-session.ts:37-44; config/talk.ts:190 normalizes talk.realtime.tools. v2026.7.1-beta.1 lacks all 3 files; only baseline direct-tools brain in talk-shared.ts (canUseTalkDirectTools/buildRealtimeInstructions), no .tools policy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Android and Discord realtime audio                                   | Partial-overlap carry | High       | Wear relay fork-only: apps/android/.../wear/{WearAudioRelay,WearRelayService,WearSttTtsSession}.kt + wear/ module absent in v2026.7.1-beta.1 (ls-tree empty; +1689 vs tag). resolveOperatorSessionConnectAuth exists both refs but HEAD NodeRuntime.kt:3238 returns bootstrapToken auth; tag:3009 returns null (test Uses vs Ignores bootstrap).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Android phone chat bubble width                                      | Partial-overlap carry | Low        | HEAD ChatScreen.kt:82 CHAT_SCREEN_BUBBLE_WIDTH_FRACTION=0.85f, applied :603 fillMaxWidth(...); ChatScreenLayoutTest.kt:9 asserts 0.85f. Upstream ChatScreen.kt:596 caps same Surface via fillMaxWidth(if(isUser)0.84f else 0.94f) role-specific, no constant, no test in tag.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Wear OS native assistant entrypoint                                  | Partial-overlap carry | Medium     | HEAD: apps/android/{app,wear}/assistant/OpenClaw{VoiceInteraction,Recognition}Service.kt + include(":wear"), manifests bind BIND_VOICE_INTERACTION/RecognitionService. Tag v2026.7.1-beta.1: git grep VoiceInteractionService/RecognitionService empty, no apps/android/wear/ tree; only phone AssistantLaunch.kt ASSIST-intent (partial overlap).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Gateway doctor source-checkout warning                               | Runtime carry         | Low        | HEAD src/commands/doctor-gateway-services.ts:431-433 hard-sets `const sourceCheckoutWarning = null` (fork comment: never nag source-checkout warning), dropping upstream's summarizeGatewayServiceLayout call; consumers at 534-549 remain but are dead. v2026.7.1-beta.1 same file:432-439 computes/emits warning from serviceLayout?.entrypointSourceCheckout. Upstream provides opposite behavior, so fork suppression must be carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Telegram transcribed-audio TTS intent                                | Absorbed upstream     | Medium     | RECLASSIFIED 2026-07-09 (was "Absorbed upstream"; that was a silent-loss risk). The Telegram transcribe body `extensions/telegram/src/bot-message-context.body.ts` is IDENTICAL HEAD vs tag, so there is no Telegram-side source carry. But the fork does thread `inboundAudio` outside Telegram: `src/infra/outbound/message-action-tts.ts` gates on `effectiveAutoMode === "inbound" && params.inboundAudio === true`, and `src/agents/command/delivery.ts` adds an `inboundAudio: boolean` param fed from `runContext.currentInboundAudio`. Neither exists upstream. Upstream v2026.7.1-beta.3 added `hasInboundAudioForTts()` in `dispatch-from-config.ts` (true when `inboundAudio` is set, or when `dispatchReplyOperation?.acceptedSteeredInboundAudio === true`) and passes it at the final delivery site. Carry = adopt upstream's `hasInboundAudioForTts()` and re-thread the fork's two non-dispatch sites onto the rewritten dispatch. Coupled to **Agent-scoped TTS conversion config**, which supplies `effectiveAutoMode`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Agent-scoped TTS conversion config                                   | Runtime carry         | Medium     | RECLASSIFIED 2026-07-09 (was "Drop candidate" on a stale anchor; dropping it would have deleted a live seam). The old evidence cited `resolveEffectiveTtsConfig`/`resolveAgentTtsOverride`, which are indeed byte-identical — but the real carry is elsewhere in the same file: `git diff v2026.7.1-beta.1..HEAD -- src/tts/tts-config.ts` is +19/-7, replacing `shouldAttemptTtsPayload` (returns `boolean`) with `resolveEffectiveTtsAutoMode` (returns a `TtsAutoMode`, or `undefined`), and re-expressing `shouldAttemptTtsPayload` on top of it. This is what lets callers gate on `autoMode === "inbound"` rather than a collapsed boolean. Upstream churn on `src/tts/tts-config.ts` across `v2026.7.1-beta.1..v2026.7.1-beta.3` is ZERO, so the seam carries clean. Enabler for **Telegram transcribed-audio TTS intent**. Prove: `pnpm test src/tts/tts-config.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CI replay repair guardrails                                          | Support/proof carry   | Low        | HEAD pnpm-workspace.yaml:118-119 undici@7=7.28.0/undici@8=8.5.0 (+lock pin); ci.yml:380-382/1993-2000 android-test/build-wear gradle cases; codeql-android +apps/android/wear/src/main. Tag v2026.7.1-beta.1: none present, apps/android/wear tree absent entirely.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Gateway memory pressure reduction                                    | Partial-overlap carry | High       | HEAD src/skills/loading/workspace.ts:11 imports internSessionEntryLargeStrings and :1427-1431 interns the skill snapshot; tag's buildWorkspaceSkillSnapshot returns snapshot directly (no interning). The intern helper store-cache.ts:112 + store-load.ts:369 usage is identical in both refs (session-store part absorbed upstream).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Async TTS voice-supplement detach                                    | Runtime carry         | High       | Post-replay seam. HEAD src/auto-reply/reply/detached-tts-tasks.ts (registerDetachedTtsTask/getDetachedTtsTaskCount/waitForDetachedTtsTasks, module-singleton `openclaw.detachedTtsTasks`) + detached-tts-supplement.ts (detachTtsSupplement: synth→visibleTextAlreadyDelivered supplement→normalize→deliver). dispatch-from-config.ts block-only final branch (~3689) hands synthesis+voice-note to a detached task via runAfterReplyOperationClear + deliverTtsSupplementToOriginating (lazy loadRouteReplyRuntime → process-scoped routeReply to the originating surface, NOT the per-turn dispatcher torn down at turn end); blockOnlyVisibleFinalDelivered guards noVisibleReplyFallbackEligible (replaces the old incidental counts.final bump; only feishu consumes the flag). server.impl.ts adds getDetachedTtsTaskCount() to getPendingReplyCount + pre-restart deferral so shutdown bounds in-flight synthesis. Upstream v2026.7.1-beta.1: maybeApplyTtsToPayload awaited inline in dispatch (block-only final ~3602, plus 2510/3418), no detach modules/registry, getDetachedTtsTaskCount 0 hits. Scope: only the block-only final path detaches (main 2510 + per-block 3418 left inline); ACP paths (dispatch-acp\*) intentionally inline (no ReplyOperation lane-clear seam; deliver mutates turn-local counters snapshotted synchronously) — documented follow-ups.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Gateway client pre-hello send gate                                   | Runtime carry         | High       | Post-replay seam. Non-connect frames are held until the connect handshake completes so nothing races ahead of req/connect; the server rejects the whole connection otherwise (src/gateway/server/ws-connection/message-handler.ts:728 "invalid handshake: first request must be connect", close 1008 — upstream/unchanged, fork touches clients only). HEAD packages/gateway-client/src/client.ts: request() gate :1719 (method!=="connect" && !helloOkReceived) awaits waitForHandshake:1527; waiters settled on hello-ok / rejected on close/stop/reconnect via settleHandshakeWaiters:1551; helloOkReceived flipped synchronously on the connect response :1507 (connectRequestId:559) ahead of its .then backstop; queued frames cleared per-connection (no replay onto a later socket). HEAD apps/android/app/src/main/java/ai/openclaw/app/gateway/GatewaySession.kt: Connection.request()/sendRequestFrame() gate on awaitHandshakeReady:537 for method!="connect" (:466,:496), parking on per-Connection connectDeferred (completes post-hello :704, exceptionally on close). Tag v2026.7.1-beta.1: TS request() gates only on readyState===OPEN (client.ts:1634), git grep waitForHandshake/handshakeWaiters/connectRequestId empty; Android Connection.request() sends immediately via sendJson(buildRequestFrame) (GatewaySession.kt:430), awaitHandshakeReady 0 hits. Tests: src/gateway/client.test.ts "pre-hello send gate"; GatewaySessionReconnectTest.nodeEventBeforeHelloWaitsForConnectHandshake.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Git plugin install same-filesystem staging                           | Runtime carry         | Medium     | Reduced carry over upstream #99896 (`5dff031467`): normal managed installs stage beside the target, but managed setup failures fail cleanly instead of falling back to default `/tmp`, which is a different filesystem on this host. The replay keeps the post-beta.3 `git clone -- <url>` security delimiter. Prove: `node scripts/run-vitest.mjs src/plugins/git-install.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Auto-TTS excludes tool delivery kind                                 | Absorbed upstream     | Medium     | `packages/speech-core/src/tts.ts` `maybeApplyTtsToPayload` skips `kind: "tool"` independent of resolved mode, so `mode: "all"` never speaks tool chrome. Tool payloads carrying real audio are promoted to `kind: "final"` in `chat.ts` before delivery. Prove: `pnpm test packages/speech-core/src/tts.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Systemd EnvironmentFile shell-safe value quoting                     | Runtime carry         | Low        | `src/daemon/systemd.ts` `quoteSystemdEnvFileValue` single-quotes values outside `SHELL_SAFE_ENV_VALUE` at the `${key}=${value}` join above `writeSystemdGatewayEnvironmentFile`. Write-side only; no reader decode (`parseEnvironmentFileLine` already strips quotes). Prove: `node scripts/run-vitest.mjs src/daemon/systemd.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| tts_prepare synthesis-seam plugin hook                               | Runtime carry         | High       | Threaded `TtsPrepareHook` fires inside `prepareSpeechSynthesis` (`packages/speech-core/src/tts.ts`) once per non-skipped provider candidate; host bridge `src/tts/tts-prepare-hook.ts` is the only file touching `getGlobalHookRunner`. Needs `tts_prepare` in BOTH the `PluginHookName` union AND `PLUGIN_HOOK_NAMES` (`hook-types.ts`), plus handler-map + 15_000ms modifying-hook timeout. Result must be applied in THREE spots in `prepareSpeechSynthesis` (the passthrough return is the only one carrying ElevenLabs). Consumer: `voice-emotion`. Prove: `node scripts/run-vitest.mjs run src/plugins/wired-hooks-tts-prepare.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Voice Emotion plugin (out-of-tree seam consumer)                     | Support/proof carry   | Medium     | Out-of-tree `~/projects/voice-emotion` binds `api.on("tts_prepare", handler)` and resolves `runtime.llm.complete` lazily per invocation. Its only fork producer seam is `tts_prepare` (including the Google `personaPrompt` override). Rebuild and run its suite after the producer re-lands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Message tool progress sends (message_tool_only turn-release opt-out) | Runtime carry         | High       | `message` send schema gains `progress?: boolean`; `isDeliveredMessageToolOnlySourceReplyResult` short-circuits to `false` (`src/agents/embedded-agent-message-tool-source-reply.ts`) so `message_tool_only` no longer sets `terminate`. `extensions/codex/src/app-server/dynamic-tools.ts` needs its own `executedArgs.progress !== true` guard on `receiptConfirmedSourceReply` (it bypasses the shared classifier). Ambient source-reply TTS gated by `progress !== true` in `message-action-runner.ts` / `message-action-tts.ts`. Counters upstream #95942 (`9b9a124cc5`). Prove: `pnpm test src/agents/embedded-agent-message-tool-source-reply.test.ts extensions/codex/src/app-server/dynamic-tools.test.ts src/infra/outbound/message-action-tts.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| WhatsApp inbound message archive                                     | Runtime carry         | Medium     | HEAD extensions/whatsapp/src/inbound/message-archive.ts: createWhatsAppMessageArchive (wa-fetch messages.db schema, WAL + short blocking busy_timeout (500ms; DatabaseSync is synchronous), INSERT OR IGNORE on Baileys message id; one BEGIN/COMMIT transaction per upsert batch with per-row-autocommit fallback so large reconnect replays are one fsync, not N; drops status@broadcast, keeps reactions/protocol raw); tapped in inbound/monitor.ts handleMessagesUpsert top (before approval/access filtering) and closed in inbound close(). Invariant: archiving can NEVER affect dispatch — the whole init (open, pragmas, schema, AND db.prepare, where an incompatible pre-existing messages table surfaces) degrades to null with the fd closed on post-open failure (init re-runs per socket attach, so a persistently broken archive must not leak per reconnect); store()/close() swallow their own errors. Multi-account: a shared channel-level dbPath means in-process WAL writer serialization bounded by the 500ms timeout — prefer per-account dbPath overrides. Hardened by a 4-pass autoreview (claude opus/high) 2026-07-07: busy_timeout 5000->500, batched transactions, prepare moved inside the guard, fd close on init failure; each with a regression test (9-test suite, incl. incompatible-schema-never-throws and 500-message batch). Config channels.whatsapp.archive {enabled,dbPath} (default off, per-account override) in zod-schema.providers-whatsapp.ts buildWhatsAppCommonShape + types.whatsapp.ts WhatsAppArchiveConfig; threaded accounts.ts ResolvedWhatsAppAccount.archive -> auto-reply/monitor.ts attach options. Tag v2026.7.1-beta.1: all symbols absent (no archive config key, no message-archive module). REBASE NOTE: after touching the zod schema you MUST regenerate src/config/bundled-channel-config-metadata.generated.ts (node --import tsx scripts/generate-bundled-channel-config-metadata.ts --write) and rebuild dist — the gateway validates channels.whatsapp against that baked JSON schema, not the live zod; a stale file crashloops the gateway with must-not-have-additional-properties: archive. Prove: node scripts/run-vitest.mjs run extensions/whatsapp/src/inbound/message-archive.test.ts |
| Tokenjuice fork runtime package                                      | Runtime carry         | High       | OpenClaw's bundled `@openclaw/tokenjuice` plugin otherwise restores upstream `tokenjuice@0.8.1` during ordinary pnpm or Gateway UI dependency reconciliation. Pin the public Heliasar fork commit `86b6447ce81b557751a4f88f4801643aabc37056` through the root pnpm override, so clean clones and frozen installs receive the reviewed bounded OpenClaw/Codex runtime without a sibling checkout or generated binary patch. Codex native-hook relay correlation preserves the model-requested Bash command for progress presentation without replacing the wrapper command used by execution, hooks, trajectory, or audit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Telegram spooled-handler progress watchdog                           | Runtime carry         | High       | Isolated polling spool handlers use reply/tool/reasoning progress to refresh their active and buffered inactivity deadlines instead of aborting at a fixed 25-minute wall-clock age. `OPENCLAW_TELEGRAM_SPOOLED_HANDLER_TIMEOUT_MS` remains the inactivity threshold override. Guarded by `extensions/telegram/src/polling-session.test.ts` and the generic reply-progress observer test in `src/auto-reply/reply/dispatch-from-config.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Private OpenClaw dependency publication                              | Support/proof carry   | High       | Saga resolves the `@openclaw` scope from private Gitea. Build, pack, verify, and publish the complete private dependency closure and root `openclaw` package from this development machine before deployment; Saga only installs the published artifact and runs restart/health proof. Workspace runtimes get immutable per-run versions; fixed external versions require exact integrity; patched fs-safe also remains bundled for non-Gitea artifacts. Keep manifest discovery, root rewrite, tarball proof, publication order, and local-build ownership aligned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Dropped seams (do not reintroduce)

Seams removed from the carry. A future replay must not resurrect these. Rows are ordered by removal date.

| Dropped seam                           | Removed    | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Removal footprint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reply session init burst serialization | 2026-07-09 | Absorbed upstream. `initSessionStateAttempt` runs `initSessionStateAttemptLocked` inside `runExclusiveSessionStoreWrite(storePath)` (`src/auto-reply/reply/session.ts`), delegating to the per-storePath FIFO `runQueuedStoreWrite`. Per-store locking is a strict superset of the fork's per-`(store, session)` key. Upstream proof: `src/auto-reply/reply/session.test.ts` "serializes concurrent initializers before reading the guarded snapshot" (8 concurrent same-session initializers). | Already banked. The fork dropped `replySessionInitializationQueues` at `c38793b46d`; `git grep replySessionInitializationQueues` returns only this file. Ledger-only cleanup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Gateway main session direct delivery   | 2026-07-09 | Absorbed upstream. `resolveChatSendOriginatingRoute` (direct-main guard `isConfiguredMainSessionScope` / `canInheritConfiguredMainRoute`) is byte-identical between `v2026.7.1-beta.3` and fork HEAD across the full function (sha256 of the function body matches). Upstream converged on the same guard independently.                                                                                                                                                                        | Zero carry. Confirm the guard survives the `src/gateway/server-methods/chat.ts` conflict resolution, then take upstream's file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Control UI read aloud through Talk     | 2026-07-09 | Dropped by owner decision; the feature is no longer wanted. Upstream also deleted the anchors (`ui/src/ui/app.ts`, `app-render.ts`, `app-view-state.ts`, `views/chat.ts`) and renamed `ui/src/ui/chat/` to `ui/src/pages/chat/`, then shipped a regression test asserting the button stays absent (`ui/src/pages/chat/components/chat-message.test.ts`, "does not render the stale assistant read-aloud footer action").                                                                        | Delete `ui/src/ui/chat/talk-tts.ts`, `talk-tts.test.ts`, `strip-markdown-for-speech.ts`, `strip-markdown-for-speech.test.ts`. Drop the fork hunks in `grouped-render.ts` (`onReadAloud`, `readAloudText`, the `extractTextCached` import), `app.ts` (`speakText` import, `handleReadAloud`), `app-render.ts` (`isTtsSupported`, `onReadAloud`), `app-view-state.ts`, `views/chat.ts`. Keep upstream's regression test as-is. NOTE: the `spawnedBy` hunk in `app.ts` belongs to **Context-rich realtime Talk tools**, not this seam; do not remove it.                                                                                                                               |
| Native Codex force full access         | 2026-07-09 | Dropped by owner decision; moot because OpenClaw does not use Codex sandboxing. Also the highest-cost carry per unit of value: upstream refactored `conversation-binding.ts` onto a SQLite binding store and `side-question.ts` auto-merges cleanly but semantically stale.                                                                                                                                                                                                                     | Revert the fork hunks: `extensions/codex/src/app-server/app-server-policy.ts` (+5, promotion bail), `config.ts` (+36/-1, `isCodexAppServerForcedFullAccess` / `clampCodexAppServerRuntimeToFullAccess` + resolver application), `side-question.ts` (+17/-9, full-access clamp), and the `OPENCLAW_CODEX_FORCE_FULL_ACCESS` references in `run-attempt-test-harness.ts`, `app-server-policy.test.ts`, `config.test.ts`, `side-question.test.ts`, `conversation-binding.test.ts`. `conversation-binding.ts` carries **zero** `FORCE_FULL_ACCESS` / `forceFullAccess` references at HEAD, so removing this seam does not disturb the **Generic agent base prompt** carry in that file. |

## v2026.6.11-beta.1 seam necessity review

Replayed from fork head `0fc81306a2` (base `v2026.6.10`) onto upstream `v2026.6.11-beta.1` (`c862a644bf`). 79 commits replayed; none went empty (all carried). Eight commits needed conflict resolution: the squashed seam bundle (`apps/android/app/build.gradle.kts` compileSdk 36 + ndkVersion, `extensions/google/speech-provider.ts` volume gain over upstream `synthesizeConfiguredGoogleTts`, `extensions/telegram/.../delivery.replies.ts` voice/react imports), and seven `:app`/extension follow-ups reconciling the fork's session-key threading and chat reconciliation against upstream's new `ChatSendAck` send-path refactor. Net fork footprint matches the prior head exactly (423 files). All 29 replayed runtime seams verified present in the rebased tree (file:line evidence); no replayed seam was lost. Two post-review bug-fix seams are also recorded below for the next fork carry: forced heartbeat tool construction and Lobster workspace cwd sandboxing.

| Seam                                      | Decision              | Importance | v2026.6.11-beta.1 evidence / replay note                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | --------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wear OS voice companion                   | Runtime carry         | Critical   | `apps/android/wear` + `apps/android/audio` modules still absent upstream; full module + phone relay carried. `:app` build pins `compileSdk = 37` (fork bump over upstream's 36, required by the `CINNAMON_BUN`/API-37 context-aware DnsResolver in `GatewayDiscovery.kt`; `:wear` already 37, `targetSdk` stays 36) plus the additive `ndkVersion = "29.0.14206865"`. 1.5x default TTS gain, rotary control, and state-gated keep-screen-awake preserved.                                |
| ACP remote target-backed bridge           | Partial-overlap carry | Critical   | Target still lacks per-agent `runtime.acp.target` extraction + codex-devbox verifier; `resolveTargetAcpAgentId` returns `target`/`backendId` and threads through spawn→manager. `extensions/acpx-remote` stays a private external lifecycle.                                                                                                                                                                                                                                             |
| Gateway runtime metadata hotpath          | Runtime carry         | Critical   | Env fingerprint + monotonic external-catalog throttle still absent upstream; carried on the current snapshot.                                                                                                                                                                                                                                                                                                                                                                            |
| ACP backend alias routing                 | Runtime carry         | High       | Per-agent backend extracted and forwarded into manager init (`acp-spawn.ts`); carried.                                                                                                                                                                                                                                                                                                                                                                                                   |
| ACP backend-managed runtime options       | Runtime carry         | High       | `managedRuntimeOptionKeys` type field + manager `unmanagedConfigOptions` filter still absent upstream; carried.                                                                                                                                                                                                                                                                                                                                                                          |
| Native Codex message-tool TTS delivery    | Partial-overlap carry | High       | `prepareTelegramVoiceMedia` + `audioAsVoice` threading carried; reconciled over upstream's `richMessages`-opt-in text-send and `message-action-runner` refactor.                                                                                                                                                                                                                                                                                                                         |
| Gateway message-tool history projection   | Runtime carry         | High       | Mirror-flush (`mirrorMessageToolVisibleReplies`) carried over upstream `readMessagingText`.                                                                                                                                                                                                                                                                                                                                                                                              |
| Gateway main session display title        | Runtime carry         | Medium     | Canonical-main display override (`session-utils.ts`) still absent upstream; carried.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Gateway main session direct delivery      | Runtime carry         | Medium     | Direct-main delivery-route guard (`server-methods/chat.ts`) still absent upstream; carried.                                                                                                                                                                                                                                                                                                                                                                                              |
| Notification heartbeat wakes              | Runtime carry         | Medium     | `notifications-event` wake bypass still absent upstream; carried with main-session routing, quiet HEARTBEAT policy, consecutive posted-summary wake dedupe, SystemUI charging-noise filtering, and self-authored agent/channel notification filtering.                                                                                                                                                                                                                                   |
| Forced heartbeat tool construction        | Runtime carry         | Medium     | Explicit `toolsAllow` runs can filter out `heartbeat_respond` even when the run forces heartbeat delivery. Carry `forceHeartbeatTool` through embedded attempt allowlist merging and construction planning so heartbeat replies remain available for empty or plugin-only allowlists.                                                                                                                                                                                                    |
| Lobster workspace cwd sandbox             | Runtime carry         | Medium     | Lobster tool calls used the Gateway process cwd as their sandbox root and rejected all absolute cwd values, so workspace-scoped calls could run in the wrong directory or fail when callers supplied the active workspace path. Carry workspace-rooted cwd resolution from the tool context while still rejecting paths outside the active workspace.                                                                                                                                    |
| Reply session init burst serialization    | Runtime carry         | High       | Telegram/direct bursts can start several same-session reply initializers before any one commits session metadata. Carry per-store/per-session initialization queueing before snapshot reads so concurrent turns reuse the winning session id instead of tripping the guarded metadata commit with `reply session initialization conflicted`.                                                                                                                                             |
| Persistent Codex memory recall            | Runtime carry         | High       | Active Memory hidden recall needs low-latency Codex/OpenAI execution without leaking hidden turns into visible session hooks, Honcho, TTS, skills, MCP servers, Codex plugins, or stale native thread context. Carry the fresh-per-recall native session, warm Codex app-server client, memory-recall prompt profile, trusted fast-mode inheritance, bounded trace instrumentation, and custom memory-tool preservation across Codex/Copilot sibling harnesses.                          |
| Context-engine prompt budget accounting   | Runtime carry         | High       | Context engines need the host-owned prompt floor subtracted before assembly/projection so Codex app-server and external engines do not spend tool/developer/base/user prompt budget twice. Carry `ContextEnginePromptBudget`, `limits.contextEngineBudget`, `runtimeContext.contextEngineBudget`, and Codex projected-context sizing from `enginePromptTokenBudget`.                                                                                                                     |
| Lossless transcript-wedge rebootstrap     | Runtime carry         | High       | `lossless-claw` must recover terminal transcript wedges by persisting a per-conversation projection reset generation and folding it into the existing `thread_bootstrap` epoch hash. The public epoch shape stays `summary-prefix-v1:<conversationId>:<hash>` while a proven wedge forces OpenClaw's Codex app-server binding compatibility path to rotate the backend thread and inject Lossless's rich compacted context once.                                                         |
| Lossless Active Memory recall expansion   | Runtime carry         | High       | `lossless-claw` delegated expansion for Active Memory recall reuses stable child sessions for continuity, but scopes the stable key by caller, conversation, sorted summary ids, token cap, message-expansion mode, and depth. Each run still refreshes grant/context/idempotency bindings, clears grant/context state afterward, and non-Active-Memory expansion sessions remain disposable and deleted.                                                                                |
| Status-only command progress text         | Runtime carry         | Medium     | `channels.<channel>.streaming.preview.commandText: "status"` must keep command execution progress label-only across draft-line, forced tool-summary, CLI tracker, and Codex app-server projector lanes. Carry the `toolResultCommandText` threading and SDK-exported command-tool matcher.                                                                                                                                                                                               |
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
| ACP remote target-backed bridge           | Partial-overlap carry | Critical   | Target still lacks `runtime.acp.target`, persistent-binding `target`, and the codex-devbox verifier. `extensions/acpx-remote` stays a private external lifecycle.                                                                                                                                                                                                                                                                                                                                                                                                                      |
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
| ACP remote target-backed bridge           | Partial-overlap carry | Critical   | Target has adjacent ACP `cwd` and backend support, but still lacks `runtime.acp.target`, persistent binding `target` metadata, and the codex-devbox ACP verifier. The private `extensions/acpx-remote` implementation remains outside this repo.                                                                                                                                                                        |
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

- `responses-lite-reasoning-context` - active seam: keep Luna/Terra/Sol Responses Lite requests on `reasoning.context: "all_turns"`, translate intentional OpenClaw `thinking: "off"` to wire effort `none` across normal and simple-completion transports, and advertise the managed Codex package version rather than a hand-maintained user-agent version.
- `policy-safe-plugin-subagent-delegation` - active seam: keep delegated plugin work on the public host subagent runtime so model allowlists/override policy remain authoritative, while exposing the thinking/tool capability, timeout/cancellation, session-total, and reply-read contracts required by `lossless-claw`.
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
- `generic-agent-base-prompt` - active seam: keep the generated global `agent-base.md` template and the agent-scoped runtime override convention for embedded OpenClaw/full prompts and native Codex app-server `baseInstructions`. Gateway startup regenerates `<stateDir>/agent-base.md`; only `<agentDir>/agent-base.md` affects runtime. Codex app-server also accepts `<agentDir>/app-server-base.md` as a legacy alias when the canonical file is absent.
- `context-rich-realtime-talk-tools` - active seam: keep Gateway-owned realtime Talk as a context-rich voice agent surface with exact `voice-agent-base.md` prompt loading, transient current-session context, latest projected `message` tool mirror context, degraded large-session fallback, opt-in `talk.realtime.tools`, the `voice` tool profile, hard exclusion of message-sending tools, and server-executed direct tools. Browser/client-owned realtime remains consult/control-only.
- `android-phone-chat-bubble-width` - active seam: keep full-screen Android phone chat bubbles in `apps/android/app/src/main/java/ai/openclaw/app/ui/chat/ChatScreen.kt` at `CHAT_SCREEN_BUBBLE_WIDTH_FRACTION = 0.85f` for user, assistant, streaming, and persisted rows. Guard with `apps/android/app/src/test/java/ai/openclaw/app/ui/chat/ChatScreenLayoutTest.kt` and verify with `./gradlew :app:testThirdPartyDebugUnitTest --tests ai.openclaw.app.ui.chat.ChatScreenLayoutTest --console=plain`; deploy Bex's phone with the third-party release APK, never Play release.
- `android-pairing-management-session-split` - active seam: keep Android Nodes & Devices pairing management on a separate pairing-capable operator path instead of broadening the normal phone runtime operator session. The normal S26 node/operator identity and `operator` token slot stay bounded to `operator.approvals`, `operator.read`, `operator.talk.secrets`, and `operator.write`; overview/background refreshes call `refreshNodesDevices()` and must not request `device.pair.list`. Only the Nodes & Devices pairing-management path calls `refreshPairingManagement()`, using the separate Android pairing identity plus local `operator-pairing` token slot with `operator.read` + `operator.pairing`. Guard with `GatewayBootstrapAuthTest.nodesDevicesRefreshMode_keepsNormalRefreshOffPairingList`, `ConnectionManagerTest.buildPairingOperatorConnectOptions_usesSeparatePairingTokenSlot`, `GatewaySessionInvokeTest` pairing auth-role coverage, and `DeviceIdentityStoreTest`; deploy Bex's phone with the third-party release APK after Android source changes.
- `notification-heartbeat-wakes` - active seam: keep Android notification wakes on the configured main session by default, keep explicit payload session keys canonicalized, preserve selected agent ids when global scope collapses explicit `agent:<id>:main` keys to `global`, make notification-event heartbeats prompt/consume only `notification:*` queued events while leaving exec, cron, and text-lookalike plugin events queued, suppress repeated wake requests for consecutive identical posted notification summaries, filter Android SystemUI charging notifications out of notification heartbeat prompts, and tag self-authored agent/channel notifications as ignorable `notification:self:*` events so the heartbeat never reacts to its own output.
- `forced-heartbeat-tool-construction` - active seam: keep embedded attempt runs that force heartbeat delivery from losing `heartbeat_respond` when callers also provide a restrictive `toolsAllow`. Forced runtime tools are merged into explicit allowlists before construction planning, while undefined and wildcard allowlists keep their existing broad behavior.
- `lobster-workspace-cwd-sandbox` - active seam: keep Lobster command cwd resolution rooted in the active plugin tool workspace, not the Gateway process cwd. Relative cwd values resolve inside `ctx.workspaceDir`; absolute cwd values are allowed only when they stay inside that workspace; omitted cwd defaults to the workspace root for tool-created Lobster instances.
- `reply-session-init-burst-serialization` - active seam: keep reply session initialization serialized per store path and canonical session key before the session-store snapshot is read. Same-session Telegram/direct bursts must queue and reuse the committed session metadata instead of preparing multiple fresh session ids and surfacing `reply session initialization conflicted` as a channel dispatch failure.
- `persistent-codex-memory-recall` - active seam: keep Active Memory recall on a stripped hidden Codex/OpenAI path with a warm app-server client but fresh native Codex session per recall, private temp transcript cleanup when user transcript persistence is off, no Honcho/plugin/TTS/skills/MCP/Codex-plugin participation, custom memory-tool allowlists preserved after broad-tool normalization, bounded trace instrumentation, and trusted parent fast-mode inheritance for plugin subagents only.
- `context-engine-prompt-budget-accounting` - active seam: keep host-owned prompt-budget accounting available to context engines. The Codex app-server builds a `ContextEnginePromptBudget` from model prompt budget minus turn prompt, developer/base instructions, OpenClaw prompt context, and tool schema/summary surfaces; threads it through `runtimeSettings.limits.contextEngineBudget` and `runtimeContext.contextEngineBudget`; and sizes Codex projected context from `enginePromptTokenBudget` so engines and projection do not overfill small context windows.
- `lossless-transcript-wedge-rebootstrap` - active seam in external `lossless-claw`: when stored compaction exhausts but host-observed live transcript tokens remain over target, bump a persisted `conversations.context_projection_reset_generation` value and include it in the existing `thread_bootstrap` epoch hash. Preserve the external OpenClaw session key/conversation identity and reproject summaries/focus/tail context into a fresh Codex backend thread without changing the v1 epoch wire shape.
- `lossless-active-memory-recall-expansion` - active seam in external `lossless-claw`: reuse Active Memory recall delegated expansion child sessions only within the same authorization/input scope, refresh per-run grants/recursion context/idempotency keys, keep non-reusable sessions deleted, and forward fast-mode/idempotency params through the plugin gateway adapter.
- `telegram-spooled-handler-progress-watchdog` - active seam: keep Telegram isolated-ingress active handlers and buffered/debounced participants on one no-progress deadline. Reply, reasoning, tool, plan, approval, and block events refresh the deadline; productive long-running turns must not be aborted merely because total handler age exceeds 25 minutes.

## Seam inventory

### Backup archive owner-only mode

Carry behavior: backup archive creation and publication keep owner-only mode `0o600`, including copy fallback paths. Stable `v2026.7.1` still opens archive output without this guarantee.

Primary seam files:

- `src/infra/backup-create.ts`
- `src/infra/backup-create.test.ts`

Primary seam tests:

- `src/infra/backup-create.test.ts`

Rebase notes:

- Carry source commit `add54436bb` behaviorally. Preserve `0o600` at initial creation and after publication/copy fallback; proving only the temporary archive is insufficient.

### Mandatory Responses Lite reasoning context

Carry behavior: ChatGPT-backed GPT-5.6 Luna, Terra, and Sol requests use the Responses Lite payload and transport contract. Every Lite request carries `reasoning.context: "all_turns"`; an intentional OpenClaw `thinking: "off"` becomes wire `reasoning.effort: "none"` instead of dropping the reasoning block, including simple-completion callers such as Active Memory. Lite-only headers identify Codex Desktop with the managed `@openai/codex` version resolved once at build or module startup, avoiding manual version drift. Non-Lite OpenAI-compatible providers keep their existing reasoning and header behavior.

Primary seam files:

- `extensions/openai/responses-lite.ts`
- `src/llm/providers/stream-wrappers/openai.ts`
- `src/agents/simple-completion-runtime.ts`
- `src/agents/openai-transport-stream.ts`
- `tsdown.config.ts`

Primary seam tests:

- `extensions/openai/responses-lite.test.ts`
- `src/llm/providers/stream-wrappers/openai.test.ts`
- `src/agents/simple-completion-runtime.test.ts`
- `src/agents/openai-transport-stream.test.ts`
- Command: `pnpm test extensions/openai/responses-lite.test.ts src/llm/providers/stream-wrappers/openai.test.ts src/agents/simple-completion-runtime.test.ts src/agents/openai-transport-stream.test.ts`

Rebase notes:

- Responses Lite requires `reasoning.context: "all_turns"` even when no effort was requested. Never omit the entire reasoning object for Lite traffic.
- Preserve the semantic distinction between omitted thinking and explicit `off`: omitted effort sends only the required context; explicit `off` sends context plus effort `none`.
- Keep Lite detection transport-aware and model-bounded. The model id alone must not add private ChatGPT headers or payload rules to arbitrary OpenAI-compatible endpoints.
- Resolve the managed Codex version once. Production bundles inject the package version at build time; source mode may read the installed package manifest once during module initialization. Do not poll or reread package metadata per request.
- The checked sibling Codex catalog currently advertises Luna/Terra reasoning levels from `low` upward, not `none`; preserve `none` here as an explicit Responses Lite wire override for OpenClaw `off`, and re-check whether Codex later promotes it into model capability metadata.
- Re-check the exact Responses Lite reasoning and model metadata contract against sibling `../codex` on every replay. Drop this seam only when upstream covers all-turn context, explicit none effort, simple-completion parity, and managed transport identity.

### Managed native sky-cua Codex plugins

Carry behavior: before any `thread/start`, every native Codex app-server client installs `computer-use` and `browser-use` from the producer-owned `openai-bundled` marketplace at `${XDG_DATA_HOME:-~/.local/share}/sky-cua/codex/openai-bundled/.agents/plugins/marketplace.json`. OpenClaw sends exactly two native `plugin/install` requests with that absolute marketplace path and the two stable plugin names. Codex owns marketplace parsing, plugin copying, version selection, config enablement, and install errors; OpenClaw does not resolve a release, read producer metadata, inspect the installed cache, or attest plugin bytes.

OpenClaw retains the global standalone `node_repl` MCP for non-Codex consumers. Inside Codex, `computer-use@openai-bundled` solely owns the `computer-use` MCP and `browser-use@openai-bundled` solely owns `node_repl`. Both Codex CLI and app-server projections filter `node_repl` and any global `computer-use` entry. Codex config MCPs have higher precedence than plugin MCPs, so projecting either name would silently shadow the installed plugin. Threads whose caller disables MCP servers keep the installed plugin state but apply the per-thread disable overlay for both canonical owners.

Concurrent first-thread starts share one process-global cache-install sequence per app-server client, including when source and dist module copies coexist. Successful installs remain cached for that client; install failures evict the client entry so the next attempt performs both installs again. Configured-owner validation is cached separately per client and exact cwd. A failed validation evicts only that cwd result, preserving the successful cache install while allowing the ownership check to retry. A replacement sky-cua installation is consumed by the next app-server client, which performs the same two native installs from the fixed path. Native plugin install remains the only Computer/Browser MCP setup inside the Codex harness. The managed `node_repl` tools remain excluded from generic PreToolUse, PostToolUse, and PermissionRequest native hook relay matchers so calls reach the plugin owner without an OpenClaw hook prompt. Do not restore release discovery, hashes, installed-cache inspection, collision inventories, readiness polling, marketplace fallback selection, standalone MCP injection, migration machinery, or status commands. Keep `codexPlugins` curated account-app policy separate. Browser transport and provenance remain producer-owned: external Chrome/Chromium through `extension_native_host`, with `isIab=false`.

After the two fixed installs, OpenClaw reads Codex's effective configured-plugin map for the exact thread cwd—the same project-layer owner source used by runtime loading—and fails the first thread explicitly if another enabled `computer-use@*` or `browser-use@*` entry could shadow the managed `openai-bundled` owner. Cache installation is single-flight per app-server client; configured-owner validation is single-flight per client and cwd so a successful check for one project cannot suppress validation for another. Both canonical owners must appear enabled after installation; missing or malformed configured state fails closed. OpenClaw does not call Codex's production-unsupported `plugin/uninstall`; operators must disable a conflicting legacy plugin deliberately. The retired `/codex computer-use` config, environment, status, install, and menu surfaces must not return, because arbitrary marketplace installation recreates the duplicate-owner state. `openclaw doctor --fix` removes shipped `plugins.entries.codex.config.computerUse` values while preserving sibling Codex config.

Primary seam files:

- `extensions/codex/src/app-server/managed-native-plugins.ts`
- `extensions/codex/src/app-server/attempt-startup.ts`
- `extensions/codex/src/app-server/run-attempt.ts`
- `extensions/codex/src/conversation-binding.ts`
- `extensions/codex/doctor-contract-api.ts`
- `extensions/codex/openclaw.plugin.json`
- `extensions/codex/src/command-handlers.ts`
- `src/agents/cli-runner/bundle-mcp-codex.ts`
- `docs/plugins/codex-computer-use.md`
- `docs/plugins/codex-harness.md`

Primary seam tests:

- `extensions/codex/src/app-server/managed-native-plugins.test.ts`
- `extensions/codex/src/app-server/attempt-startup.test.ts`
- `extensions/codex/src/app-server/run-attempt.test.ts`
- `extensions/codex/doctor-contract-api.test.ts`
- `extensions/codex/src/commands.test.ts`
- `src/agents/cli-runner/bundle-mcp-codex.user-config.test.ts`
- Command: `node scripts/run-vitest.mjs extensions/codex/doctor-contract-api.test.ts extensions/codex/src/app-server/managed-native-plugins.test.ts extensions/codex/src/app-server/attempt-startup.test.ts extensions/codex/src/app-server/run-attempt.test.ts extensions/codex/src/commands.test.ts src/agents/cli-runner/bundle-mcp-codex.user-config.test.ts`

Rebase notes:

- Re-check that `python3 install.py install` produces the fixed marketplace path before replay. OpenClaw must not read or depend on `RELEASE.json`, release ids, generation paths, or producer hashes.
- Re-check pinned sibling `../codex` before replay. Codex must still accept the absolute local marketplace JSON path, copy and enable the named plugin on `plugin/install`, and load installed plugin MCPs for a new thread.
- Keep per-client single-flight bounded to the app-server process. Do not add release keys, home locks, cache hashing, or post-install read/status calls; a replacement client is the refresh boundary.
- Browser caller provenance, extension socket discovery, `extension_native_host`, and `isIab=false` remain producer-owned behavior inside `browser-use`. Do not reintroduce OpenClaw provenance-selector environment variables, Browser hashes, or browser discovery policy.

### Policy-safe plugin subagent delegation

Carry behavior: external plugins delegate agent work through `api.runtime.subagent`, not the private embedded-agent runner. The host remains the owner of `subagent.allowModelOverride` and `subagent.allowedModels`; canonical `provider/model` references such as `openai/gpt-5.6-luna` reach that policy boundary correctly. The runtime advertises its thinking-override capability through the actual loaded-plugin facade, forwards explicit thinking and tool allowlists, bounds admission and session reads with one caller deadline, suppresses late admission after timeout, preserves `timeoutMs: 0` as unbounded, and returns total session message counts so retained transcripts can fence the current reply beyond the 1,000-message tail cap. `lossless-claw` feature-detects the complete contract before DB initialization and fails closed when the host is incompatible.

Primary seam files:

- `src/plugins/runtime/types.ts`
- `src/plugins/runtime/types-core.ts`
- `src/plugins/runtime/index.ts`
- `src/plugins/registry.ts`
- `src/gateway/server-plugins.ts`
- `src/gateway/server-methods.ts`
- `src/gateway/server-methods/shared-types.ts`
- `src/gateway/server-methods/agent.ts`
- `src/gateway/server-methods/sessions.ts`
- `packages/gateway-protocol/src/schema/agent.ts`
- `../lossless-claw/src/plugin/index.ts`
- `../lossless-claw/src/focus-briefs.ts`
- `../lossless-claw/doctor-contract-api.js`

Primary seam tests:

- `src/plugins/runtime/index.test.ts`
- `src/plugins/registry.runtime-config.test.ts`
- `src/gateway/server-plugins.test.ts`
- `src/gateway/server-methods/agent.test.ts`
- `src/gateway/server.sessions.create.test.ts`
- `packages/gateway-protocol/src/schema/agent.test.ts`
- `../lossless-claw/test/plugin-config-registration.test.ts`
- `../lossless-claw/test/focus-briefs.test.ts`
- `../lossless-claw/test/doctor-contract-api.test.ts`

Rebase notes:

- Do not restore direct `runEmbeddedAgent` use in Lossless. The public subagent runtime is the policy boundary; bypassing it silently bypasses model-override and allowlist enforcement.
- Forward capabilities through both the raw runtime and the plugin-scoped registry facade. Testing only `createPluginRuntime()` is insufficient because loaded plugins receive the facade.
- Admission timeout is cancellation, not merely a caller-side race. A timed-out request must not start later without returning a run id; zero remains the explicit no-timeout sentinel.
- Retained transcript reply selection uses host-reported total message count, not the length of a capped tail. Accept visible assistant string content plus `text` and Responses Lite `output_text` blocks.
- A canonical `summaryModel` overrides `summaryProvider`; otherwise host policy sees a malformed composite identity such as `openrouter/openai/gpt-5.6-luna`.
- Temporary delegated-session cleanup is best-effort and detached after the result deadline. Retained focus sessions are not deleted.
- The host compatibility gate is capability-based so compatible fork builds can retain an older package version. Do not replace it with a version-only check; update the declared minimum after the first tagged release containing the complete contract.

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

### Private OpenClaw dependency publication

Carry behavior: Saga's npm configuration resolves `@openclaw/*` through the private Gitea registry while ordinary dependencies resolve through npmjs. Before publishing the root package, local package preparation derives the complete OpenClaw-owned direct dependency set from `package.json` and always includes the external managed `@openclaw/codex` plugin, producing a four-package plan. It packs `@openclaw/ai` and Codex from their workspaces plus the exact installed `@openclaw/fs-safe` and `@openclaw/proxyline` runtimes, verifies every packed name/version, and publishes them first. Workspace packages receive an immutable per-run private version. Root dependency rewrites create complete exact shrinkwrap entries from each packed manifest and SHA-512 integrity, including runtime dependency metadata and `inBundle` where applicable; fixed external versions must match the freshly packed SHA-512 integrity. The root still bundles patched fs-safe so public npm and strict Docker artifacts retain the fork patch independently of Gitea. The tarball checker derives bundled public runtime entries from each bundled package's own exports map and rejects missing, mismatched, or stale dependency entries in either direction between `package.json` and shrinkwrap root metadata.

Deployment directive: build, pack, verify, and publish the private dependency closure and root `openclaw` package from this development machine before invoking Saga deployment. The closure includes any changed external managed plugin package, especially `@openclaw/codex`, because installing the root package does not replace external plugin bytes. Publish each changed plugin under a new immutable version and update it on Saga before live acceptance. Do not wait for or ask Saga to build or publish packages. The Gitea workflow has no push trigger and performs manual deployment orchestration only. Its dispatch accepts an already-published immutable root version, source version, and full commit SHA, validates all three before constructing the restricted SSH command, and does not receive npm publication credentials. Saga's role starts at installing the already-published root version, updating already-published managed plugins, then restarting OpenClaw and proving the installed versions, commit, and health.

Primary seam files:

- `package.json`
- `npm-shrinkwrap.json`
- `scripts/check-openclaw-package-tarball.mjs`
- `test/scripts/check-openclaw-package-tarball.test.ts`
- `scripts/pack-private-npm-dependencies.mjs`
- `test/scripts/pack-private-npm-dependencies.test.ts`
- `.gitea/workflows/npm-publish.yml`

Primary seam tests:

- `test/scripts/pack-private-npm-dependencies.test.ts`
- `test/scripts/check-openclaw-package-tarball.test.ts`
- Command: `node scripts/run-vitest.mjs test/scripts/pack-private-npm-dependencies.test.ts test/scripts/check-openclaw-package-tarball.test.ts`
- Actual `node scripts/pack-private-npm-dependencies.mjs pack <output-dir> <run-id>` proof followed by direct inspection of all four package tarball manifests and `rewrite-root` proof for the run-versioned AI dependency
- Actual root `pnpm --config.ignore-scripts=true pack` proof followed by `node scripts/check-openclaw-package-tarball.mjs <tarball>`

Rebase notes:

- Preserve the machine boundary: package construction and registry publication happen on this development machine. Gitea only dispatches already-published immutable inputs; Saga only installs and validates them.
- Keep the source map exhaustive against root `@openclaw/*` dependencies. A new scoped runtime must fail packaging until its owning source is explicit.
- Keep external managed plugins explicit in `MANAGED_PLUGIN_SOURCES`; root dependency discovery cannot infer them because they install outside the root package. The current plan always prepares a new immutable Codex tarball for publication even when only root code changed.
- Pack fs-safe only after `pnpm install` has applied the fork patch; verify tarball identity before publication and keep it in root `bundleDependencies` for non-Gitea artifacts.
- Give workspace dependencies a run-specific private version, publish them first, then rewrite the root manifest and any matching shrinkwrap entry before root packing. Never reuse changing workspace bytes under the source release version.
- Fixed external dependency versions are integrity-verified and skipped so reruns remain safe and cannot silently reuse a different artifact under the same version; bump their dependency version when their carried bytes change.
- Keep the root tarball checker before publication; dependency publication does not replace root artifact proof.

### Git plugin install same-filesystem staging

Carry behavior: git-spec plugin installs stage the clone under the managed git root (`~/.openclaw/git`) instead of `os.tmpdir()`, so the final `replaceDirectoryAtomic` rename into the persistent repo dir never crosses filesystems. Without this, `openclaw plugins install git:<url>` fails with `EXDEV: cross-device link not permitted` on hosts where `/tmp` is tmpfs (this host), which blocks installing and updating the self-hosted plugin forks (`openclaw-honcho`, `lossless-claw`) from `git.heliasar.com`.

Primary seam files:

- `src/infra/install-source-utils.ts` (`withTempDirIn`; `withTempDir` delegates with `os.tmpdir()`)
- `src/plugins/git-install.ts` (`withGitStagingDir`, `resolveGitInstallRepoDir` returning `{gitRoot, persistentRepoDir}`)

Primary seam tests:

- `node scripts/run-vitest.mjs src/plugins/git-install.test.ts` (asserts the clone stages under the managed git root, and an unusable git root fails cleanly before cloning)

Rebase notes:

- Upstream-eligible: this is a generic installer bug with no fork-specific behavior. Drop this seam if upstream lands an equivalent fix (same-device staging, or an EXDEV copy fallback in `@openclaw/fs-safe`'s `replaceDirectoryAtomic`).
- `replaceDirectoryAtomic` uses a bare `fs.rename` with no cross-device fallback; any rework must keep staged source and target on the same filesystem or add that fallback.
- Same-root staging creates and normalizes `~/.openclaw/git` to 0o700 on every install via `withTempWorkspace` (commented at the call site); keep that note if the block is reworked.
- Preserve the non-throwing contract of `installPluginFromGitSpec`: staging-setup failures must return `{ok: false, error: "failed to stage managed git plugin repository: ..."}`, not reject.
- Interim workaround on affected hosts without the fix: `TMPDIR=~/.openclaw/tmp openclaw plugins install/update ...`.

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

### Status-only command progress text

Carry behavior: `channels.<channel>.streaming.preview.commandText: "status"` must keep command-execution tool lines label-only (`🛠️ Exec` / `🛠️ Bash`) across every channel progress lane, not just the structured draft-line renderer. Three lanes previously leaked raw command text into Telegram progress drafts: (1) runner item events pre-fill `meta` with the compacted/explain-mode command pipeline and `summary` with live exec output, which short-circuited past the status suppression in `buildChannelProgressDraftLine`; (2) progress mode sets `forceToolResultProgress`, which forces `shouldEmitToolResult()` on with verbose off, and the resulting `formatToolAggregate` tool-summary text (raw explain pipeline, e.g. `print text → run … (+1 steps) (agent)`) was pushed verbatim into the draft by the channel `onToolResult` handler; (3) the Codex app-server event projector (`extensions/codex/src/app-server/event-projector.ts`) is a sibling harness-side implementation of the same tool-summary lane with two emitters (`emitToolResultSummary` for native thread items, `emitTranscriptToolCallProgress` for transcript-recorded tool calls) that formatted raw command meta independently. The fix suppresses all detail sources for command items in status mode in the draft-line renderer, and threads a channel-owned `toolResultCommandText?: "raw" | "status"` reply option from the telegram dispatcher through `GetReplyOptions` → `agent-runner-execution` → `RunEmbeddedAgentParams` → attempt subscription params into all tool-summary emitters (embedded `emitToolSummary`, CLI `createCliToolSummaryTracker`, and both Codex projector emitters via `EmbeddedRunAttemptParams`), which emit label-only aggregates for `exec`/`shell`/`bash` (case-insensitive) under `"status"`. `isCommandToolName` is exported through the `agent-harness-runtime` SDK seam for harness plugins.

Primary seam files:

- `src/channels/streaming.ts`
- `src/auto-reply/tool-meta.ts`
- `src/auto-reply/get-reply-options.types.ts`
- `src/auto-reply/reply/agent-runner-execution.ts`
- `src/auto-reply/reply/agent-runner-cli-dispatch.ts`
- `src/agents/embedded-agent-subscribe.ts`
- `src/agents/embedded-agent-subscribe.types.ts`
- `src/agents/embedded-agent-runner/run/params.ts`
- `src/agents/embedded-agent-runner/run.ts`
- `src/agents/embedded-agent-runner/run/attempt.ts`
- `extensions/telegram/src/bot-message-dispatch.ts`
- `extensions/codex/src/app-server/event-projector.ts`
- `src/plugin-sdk/agent-harness-runtime.ts`

Primary seam tests:

- `node scripts/run-vitest.mjs src/channels/streaming.test.ts src/auto-reply/tool-meta.test.ts src/auto-reply/reply/agent-runner-cli-dispatch.test.ts extensions/codex/src/app-server/event-projector.test.ts`
- `pnpm tsgo:core`, `pnpm tsgo:test:src`, `pnpm tsgo:extensions`

Rebase notes:

- Keep both suppression points. The draft-line fix alone is insufficient: forced tool summaries arrive at the channel as pre-formatted text with no structure left to filter, so the emitters must format label-only at the source.
- Non-command tools keep their meta/detail under status mode; `emitToolOutput` (verbose `"full"`) and tool failure warnings (`⚠️ … failed`) intentionally stay raw as explicit opt-ins and error evidence.
- `isCommandToolName` (exec/shell/bash, lowercase-normalized) is exported from `src/auto-reply/tool-meta.ts` and must stay in sync with the private matcher in `src/channels/streaming.ts`.
- Only telegram wires `onToolResult`/`forceToolResultProgress` today; if another channel adopts the forced tool-summary lane, it must also resolve and pass `toolResultCommandText` from its streaming config.
- Known upstream gap, not part of this seam: `attempt.ts` never forwarded `toolProgressDetail` into subscribe params, so embedded runs always use the `"explain"` default; `toolResultCommandText` is forwarded explicitly.
- Candidate for upstreaming; if upstream lands an equivalent contract, drop this seam and adopt theirs.

### Context-engine prompt budget accounting

Carry behavior: context engines must receive a host-owned prompt-budget split before assembly and maintenance decisions. The host-resolved prompt budget is not all available to the engine: current user prompt text, developer instructions, base instructions, OpenClaw prompt context, and tool schema/summary definitions already consume part of the model prompt window. Codex app-server computes that non-engine floor as a `ContextEnginePromptBudget`, exposes it through both `runtimeSettings.limits.contextEngineBudget` and `runtimeContext.contextEngineBudget`, and sizes rendered Codex context projection from `enginePromptTokenBudget`. Without this seam, context engines can spend the full model budget on assembled context and then overflow once OpenClaw adds the host-owned prompt surfaces.

Primary seam files:

- `src/context-engine/types.ts`
- `src/context-engine/runtime-settings.ts`
- `src/context-engine/registry.ts`
- `src/plugin-sdk/agent-harness-runtime.ts`
- `extensions/codex/src/app-server/attempt-context.ts`
- `extensions/codex/src/app-server/run-attempt.ts`
- `extensions/codex/src/app-server/context-engine-projection.ts`
- `extensions/codex/src/app-server/thread-lifecycle.ts`

Primary seam tests:

- `node scripts/run-vitest.mjs src/context-engine/runtime-settings.test.ts src/context-engine/context-engine.test.ts src/agents/harness/context-engine-lifecycle.test.ts extensions/codex/src/app-server/attempt-context.test.ts extensions/codex/src/app-server/context-engine-projection.test.ts extensions/codex/src/app-server/run-attempt.context-engine.test.ts extensions/codex/src/app-server/thread-lifecycle.binding.test.ts`
- `pnpm tsgo:core`, `pnpm tsgo:extensions`

Rebase notes:

- Keep `ContextEnginePromptBudget` in the plugin SDK harness surface. External context-engine owners need the same `promptTokenBudget`, `nonEnginePromptTokens`, `enginePromptTokenBudget`, optional `observedPromptTokens`, and `source` shape that core and Codex use.
- Normalize budget fields as non-negative integers in `buildContextEngineRuntimeSettings`; do not pass fractional or negative values into engine contracts.
- Build the Codex budget from the same prompt surfaces reported by `buildCodexSystemPromptReport` plus the current turn prompt, base instructions, developer instructions, and OpenClaw context frame. Tool definitions include both schema chars and summary/description chars.
- Pass the budget to engines in both places: `runtimeSettings.limits.contextEngineBudget` for durable settings and `runtimeContext.contextEngineBudget` for live runtime callbacks.
- When projecting context for Codex, prefer `enginePromptTokenBudget` over the full context token budget and allow the rendered context to shrink to zero if host-owned prompt surfaces consume the whole small-model budget.
- Preserve the reserve-token behavior for runs that do not have budget accounting yet; budget-aware runs use the explicit split instead of a blind native reserve.

### Persistent Codex memory recall

Carry behavior: Active Memory hidden recall runs should be fast, private, and isolated. OpenAI recall models run through the Codex harness with `reasoningLevel: "off"` and a compact memory-recall profile, while keeping the Codex app-server client warm across recalls. Each recall still uses a fresh hidden session key, ephemeral native Codex thread, session id, run id, and temp transcript file so stale hidden memory cannot bleed into later queries. The Codex owner uses an attempt-local volatile binding store for this profile, so hidden recalls neither materialize native rollouts nor consume durable SQLite binding rows. When `persistTranscripts: false`, private runtime transcript files live under `os.tmpdir()` and are removed in `finally` after result or partial-timeout evidence recovery. Hidden runs must not call Honcho, auto-TTS, generic plugin hooks, native Codex hooks, native Copilot hooks, skills, MCP servers, Codex plugins, message tools, or the context engine.

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

- `packages/acp-core/src/runtime/types.ts`
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

Self-authored channel output is also ignorable notification context. A forwarded phone notification that is really one of OpenClaw's own agents or channel bots posting on an active channel must be matched from visible sender identity, not package name, so the same guard works for Android and iOS notification payloads. The Gateway derives lowercased identities from the assistant name, agent names, agent identity names, `openclaw`, and configured channel runtime account identities such as bot usernames and account labels. Posted notifications whose title or grouped body sender prefix matches that bounded identity set are enqueued under `notification:self:<key>` and then drained through the ignorable-notification path without waking the model.

Primary seam files:

- `src/gateway/server-node-events.ts`
- `src/gateway/server-node-events.test.ts`
- `src/gateway/self-notification.ts`
- `src/gateway/self-notification.test.ts`
- `src/gateway/server-node-events-types.ts`
- `src/gateway/server-methods/nodes.ts`
- `src/infra/heartbeat-runner.ts`
- `src/infra/heartbeat-events-filter.ts`
- `src/infra/heartbeat-events-filter.test.ts`
- `src/infra/heartbeat-runner.returns-default-unset.test.ts`

Primary seam tests:

- `node scripts/run-vitest.mjs src/gateway/server-node-events.test.ts src/gateway/self-notification.test.ts src/infra/heartbeat-events-filter.test.ts src/infra/heartbeat-runner.returns-default-unset.test.ts src/infra/event-session-routing.test.ts`
- `pnpm exec oxfmt --check --threads=1 src/gateway/server-node-events.ts src/gateway/server-node-events.test.ts src/gateway/self-notification.ts src/gateway/self-notification.test.ts src/gateway/server-node-events-types.ts src/gateway/server-methods/nodes.ts src/infra/heartbeat-events-filter.ts src/infra/heartbeat-events-filter.test.ts src/infra/heartbeat-runner.ts src/infra/heartbeat-runner.returns-default-unset.test.ts`
- `node scripts/run-oxlint.mjs src/gateway/server-node-events.ts src/gateway/server-node-events.test.ts src/gateway/self-notification.ts src/gateway/self-notification.test.ts src/gateway/server-node-events-types.ts src/gateway/server-methods/nodes.ts src/infra/heartbeat-events-filter.ts src/infra/heartbeat-events-filter.test.ts src/infra/heartbeat-runner.ts src/infra/heartbeat-runner.returns-default-unset.test.ts`

Rebase notes:

- Keep `notifications-event` classified as an inspectable wake payload. It must bypass the "no due heartbeat task" null-prompt outcome without turning queued notification events into unconditional outbound messages.
- Keep notification event enqueueing generic and session-scoped. The heartbeat wake should create the policy prompt; HEARTBEAT.md remains the owner of notify/suppress decisions.
- Keep implicit notification routing on `resolveMainSessionKey(cfg)`, not `node-${nodeId}`. Explicit payload session keys still go through `loadSessionEntry()`, but do not erase an explicit agent id when global scope canonicalizes the queue key to `global`.
- Keep notification prompt and drain selection context-owned. Text alone is not enough: unrelated plugins can enqueue strings that begin with `Notification posted`, and exec events can coexist in the same queue. A `notifications-event` wake should leave those entries queued.
- Keep the repeated-summary wake dedupe separate from event enqueueing and limited to consecutive posted notifications with visible summary text. Dropping enqueue would hide notification history; deduping removals can hide distinct removal events, but removals still reset the consecutive posted-summary boundary.
- Keep dedupe scoped to the actual wake lane. Under global session scope, explicit `agent:<id>:main` notifications share the `global` queue key but must not share one dedupe lane across agents.
- Keep ignored-only notification wakes ahead of HEARTBEAT task and commitment prompt selection. Charging noise should not run periodic heartbeat work just because a task is due.
- Keep the charging notification filter narrow to Android SystemUI charging-state text/key patterns so normal app notifications and unrelated SystemUI notices, such as VPN status, can still reach HEARTBEAT policy.
- Keep self-authored detection package-name-free and channel-config-scoped. Match only the notification title or the leading `Sender:` prefix in grouped bodies; do not treat body mentions as authorship. Preserve the minimum identity length and bounded-word regex to avoid suppressing real human senders such as `Skylar` or messages that merely mention an agent name.
- Keep `notification:self:*` outside the normal notification prompt selector but inside the ignorable drain selector. The event should remain visible in queued history/debug state, but it must not create a HEARTBEAT model call.

### ACP remote target-backed bridge

Carry behavior: OpenClaw can keep the top-level ACP agent generic, such as `codex`, while binding-level ACP config selects the remote execution target and working directory. `acpx-remote` materializes the private target-specific delegate session at runtime and deploys/uses the Codex ACP bridge from native Codex ChatGPT subscription auth when the public ACP agent is `codex`, including Discord/Telegram-bound session routing proof.

Primary seam files:

- `scripts/verify-codex-devbox-acp.js`
- `../acpx-remote`
- `src/acp/control-plane/manager.core.ts`
- `src/acp/control-plane/runtime-options.ts`
- `src/acp/persistent-bindings.lifecycle.ts`
- `src/acp/persistent-bindings.types.ts`
- `src/channels/plugins/acp-configured-binding-consumer.ts`
- `src/config/zod-schema.agents.ts`
- `src/config/zod-schema.agent-runtime.ts`
- `docs/tools/acp-agents.md`

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

Rebase notes:

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
- `packages/gateway-protocol/src/schema/channels.ts`
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
- `apps/android/app/src/test/java/ai/openclaw/app/voice/TalkModeConfigParsingTest.kt`
- `src/gateway/gateway-misc.test.ts`
- `packages/gateway-protocol/src/index.test.ts`
- `src/gateway/server-methods/talk.test.ts`
- `node scripts/run-vitest.mjs extensions/openai/realtime-voice-provider.test.ts src/talk/provider-resolver.test.ts src/gateway/server-methods/talk.test.ts`
- `extensions/discord/src/voice/manager.e2e.test.ts`
- `extensions/discord/src/voice/realtime.wake-name-followup.test.ts`

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
- Keep Android pairing management split from the normal operator runtime session. The normal S26 node/operator identity and `operator` token slot remain bounded to `operator.approvals`, `operator.read`, `operator.talk.secrets`, and `operator.write`; Nodes & Devices pairing reads use a separate Android pairing identity plus local `operator-pairing` token slot requesting only `operator.read` + `operator.pairing`. Do not add `operator.pairing` to setup-code/bootstrap operator handoff scopes or rotate the normal operator token to carry pairing authority.
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
- `apps/android/audio/src/main/java/ai/openclaw/audio/PcmAudio.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/AcousticAudioDebugCapture.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/audio/PlaybackAudioDebugCapture.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/WireAudioDebugCapture.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/PhoneRelayClient.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/AudioStreamAssembler.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/BufferedAudioResponseReceiver.kt`
- `apps/android/wear/src/main/java/ai/openclaw/wear/client/BufferedAudioResponseReceiver.kt`
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
- `apps/android/wear/src/test/java/ai/openclaw/wear/audio/PcmAudioTest.kt`
- `apps/android/wear/src/test/java/ai/openclaw/wear/client/BufferedAudioResponseReceiverTest.kt`
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
- Keep the phone-side Wear relay on the normal durable turn path. STT still uses Gateway `talk.session.*` transcription events, assistant replies route through `chat.send`, and the completed assistant text is synthesized for the watch through `talk.speak` in the negotiated format.
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
- `chat.finalAudio.get` remains an additive hidden Gateway surface for other clients, but it is not part of the current Wear relay contract. Wear uses `talk.speak` directly after `chat.send`; do not restore the older reusable-final-audio branch without a new carry decision and proof.
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

### tts_prepare synthesis-seam plugin hook

Carry behavior: a new first-class `tts_prepare` plugin hook fires at the speech-synthesis chokepoint — inside `prepareSpeechSynthesis` in `packages/speech-core/src/tts.ts`, once per non-skipped provider fallback candidate, before the provider's own `prepareSynthesis`. It carries the fitted text about to be spoken, the effective host/provider/model `maxTextLength`, resolved provider id, provider model id, persona (id and full object), attempt index, and the owning `agentId` (when the host call site knows it), and lets a plugin return `{ text?, providerOverrides? }` to enrich delivery (e.g. ElevenLabs v3 inline audio tags, or a Gemini per-message style instruction). The `agentId` lets a plugin resolve model/credentials against the bound agent (e.g. `runtime.llm.complete`); it is surfaced purely through the host bridge's `ctxInfo`, not the Layer-A `TtsPrepareHook` input, since agent scope is a host-call-site concern. This is the fork seam the out-of-tree `voice-emotion` plugin binds to; without it the plugin cannot see the resolved synthesis target, so an emotion-enrichment plugin would have to guess the model and risk speaking bracket tags aloud. Transform-only (no cancel), fail-open: a thrown or timed-out handler logs at `logger.error` via `handleHookError` and synthesis proceeds with the fitted input. Upstream-PR candidate — the hook is generic and provider-agnostic.

Length invariant: `SpeechProviderPlugin.resolveSynthesisTextLimit` lets the selected provider resolve a model-aware character ceiling without putting provider ids in core. Speech-core takes the minimum of that value and `messages.tts.maxTextLength`, summarizes over-limit input before `tts_prepare`, and falls back to UTF-16-safe bounded truncation when summarization is disabled, fails, returns empty text, or remains too long. A hook result that exceeds the effective limit is rejected together with its coupled overrides. Provider-owned preparation is also checked against a declared provider limit before network synthesis. ElevenLabs resolves 5,000 characters for `eleven_v3*` and a conservative 6,000 for its other models, matching the carried `codex-voice` behavior. Fallback candidates fit independently; equal limits reuse the same in-call fit result.

Mechanism note (why it is threaded, not a direct import): `packages/speech-core` is import-restricted to `openclaw/plugin-sdk/*` and physically cannot reach the plugin hook dispatcher (`getGlobalHookRunner`). So the hook is a threaded callback (`TtsPrepareHook`, Layer A) injected from host call sites; a single host bridge file (`src/tts/tts-prepare-hook.ts`, `buildTtsPrepareHook`) is the only code that touches `getGlobalHookRunner` and maps Layer A ↔ the Layer-B plugin event/context. The bridge returns `undefined` when no `tts_prepare` hook is registered, so the hook path costs nothing when unused. Every real agent/tool voice-note synthesis path is wired for consistent enrichment: the `tts` tool (`tts-tool.ts`), the gateway `tts.convert` RPC (`gateway/server-methods/tts.ts`), the main reply dispatch (`dispatch-from-config.ts`), the ACP block-tail and per-kind delivery paths (`dispatch-acp.ts`, `dispatch-acp-delivery.ts`), isolated cron delivery (`cron/isolated-agent/delivery-dispatch.ts`), message-action sends including the deferred source-reply supplement (`infra/outbound/message-action-tts.ts`), embedded agent-command delivery (`agents/command/delivery.ts`), and the `/tts` command's direct `textToSpeech` calls (`auto-reply/reply/commands-tts.ts`). Each threads `buildTtsPrepareHook({ agentId, channelId, accountId })` into its existing `maybeApplyTtsToPayload`/`textToSpeech` call without altering the surrounding gates (hidden-recall, tool/block kind exclusions, auto-mode/inbound checks) that decide whether TTS runs at all. Talk (`streamSpeech`) and telephony (`textToSpeechTelephony`) pass no `prepareHook`, so the hook never fires there.

A second, small consented Google-provider carry rides with this seam: `extensions/google/speech-provider.ts` now reads a `personaPrompt` (alias `instruction`) from `providerOverrides`, extends its wrap gate, and concatenates it into the audio-profile prompt's DIRECTOR'S NOTES (TRANSCRIPT untouched, double-wrap guard intact). Without it the Gemini style-instruction strategy is a silent no-op, because the Google provider otherwise reads its persona prompt only from static `providerConfig`.

Primary seam files:

- `src/plugins/hook-types.ts`
- `src/plugins/hooks.ts`
- `packages/speech-core/src/tts.ts`
- `packages/speech-core/runtime-api.ts`
- `src/plugin-sdk/tts-runtime.ts`
- `src/tts/tts.ts`
- `src/tts/tts-prepare-hook.ts`
- `src/agents/tools/tts-tool.ts`
- `src/gateway/server-methods/tts.ts`
- `src/auto-reply/reply/dispatch-from-config.ts`
- `src/auto-reply/reply/dispatch-acp.ts`
- `src/auto-reply/reply/dispatch-acp-delivery.ts`
- `src/cron/isolated-agent/delivery-dispatch.ts`
- `src/infra/outbound/message-action-tts.ts`
- `src/agents/command/delivery.ts`
- `src/auto-reply/reply/commands-tts.ts`
- `extensions/google/speech-provider.ts`
- `extensions/elevenlabs/speech-provider.ts`
- `src/plugins/wired-hooks-tts-prepare.test.ts`
- `packages/speech-core/src/tts.test.ts`
- `bex-fork.md`

Primary seam tests:

- `node scripts/run-vitest.mjs run src/plugins/wired-hooks-tts-prepare.test.ts`
- `node scripts/run-vitest.mjs run packages/speech-core/src/tts.test.ts`
- `node scripts/run-vitest.mjs run extensions/elevenlabs/speech-provider.test.ts`

Rebase notes:

- `tts_prepare` must be added to BOTH the `PluginHookName` union AND the `PLUGIN_HOOK_NAMES` array in `hook-types.ts`, or the compile-time exhaustiveness assert fails. It also needs a `PluginHookHandlerMap` entry and a `DEFAULT_MODIFYING_HOOK_TIMEOUT_MS_BY_HOOK` entry (`15_000`, above the plugin's own ~12s total budget).
- `runTtsPrepare` in `hooks.ts` is modeled on `runReplyPayloadSending`: sequential-modifying, text last-writer-wins, `providerOverrides` shallow spread-merge, void/undefined handler results skipped, `undefined` returned when nothing changed. Register it in the `createHookRunner` return object.
- The hook result must be applied in THREE spots inside `prepareSpeechSynthesis` via merged local `text`/`providerOverrides` copies: the passthrough return for providers with no `prepareSynthesis` (the ONLY path that carries the result for ElevenLabs, which registers none), the `provider.prepareSynthesis` ctx, and the final merged return. Dropping the passthrough application silently disables ElevenLabs enrichment.
- `providerModel` (= `voiceModel?.model`) and `attempt` (per non-skipped candidate) are threaded into `prepareSpeechSynthesis` from the `synthesizeSpeech` fallback loop. `providerModel` is load-bearing: the plugin selects its strategy by model id (`eleven_v3` vs Gemini TTS).
- Preserve the `resolveSynthesisTextLimit` SDK type/barrel exports, ElevenLabs resolver, per-candidate fitting cache, and both pre/post-hook limit checks. `maxTextLength` must remain in the Layer-A → Layer-B bridge completeness assertion and event mapping, or the consumer can expand text past the provider/model ceiling.
- Keep the Google `personaPrompt`/`instruction` override read in `readGoogleTtsOverrides` and the `|| Boolean(overrides.personaPrompt)` gate + `[config.personaPrompt, overrides.personaPrompt].filter(Boolean).join("\n\n")` merge in `prepareSynthesis`. If upstream ever adds native per-request Google style prompts, re-evaluate this half of the carry.
- `PluginHookTtsPrepareEvent.agentId` is optional and is set from the bridge's `ctxInfo.agentId` in `buildTtsPrepareHook` (not from the Layer-A `TtsPrepareHook` input, which has no agent scope). Do not add `agentId` to the speech-core `TtsPrepareHook` input shape; keep it a bridge-only field so speech-core stays import-restricted and agent-agnostic.
- The `prepareHook` must be threaded into EVERY agent/tool synthesis call site, not just `dispatch-from-config.ts`, or enrichment is inconsistent depending on which path speaks. Wired call sites: `tts-tool.ts`, `gateway/server-methods/tts.ts`, `dispatch-from-config.ts`, `dispatch-acp.ts`, `dispatch-acp-delivery.ts`, `cron/isolated-agent/delivery-dispatch.ts`, `infra/outbound/message-action-tts.ts` (both the deferred source-reply supplement and the direct send), `agents/command/delivery.ts`, and `commands-tts.ts`. Never thread it into `streamSpeech` (Talk) or `textToSpeechTelephony`.

### Voice Emotion plugin (out-of-tree seam consumer)

Carry behavior: the `tts_prepare` hook and Google `personaPrompt` override above serve one feature: the `voice-emotion` plugin — a separate git-installed repo at `~/projects/voice-emotion`, wired through `plugins.entries.voice-emotion` — which preprocesses every agent voice note through an LLM to add provider-appropriate emotional delivery before synthesis. It is documented here because the seams are inert without their consumer, and the plugin's integrity contract (fail-open; never corrupt spoken text) is what justifies their transform-only and director's-notes-only shapes.

Primary seam files:

- `../voice-emotion/index.ts`
- `../voice-emotion/src/engine.ts`
- `../voice-emotion/src/runtime-guard.ts`

Primary seam tests:

- `../voice-emotion/test/engine.test.ts`
- `../voice-emotion/test/pipeline.test.ts`
- `../voice-emotion/test/runtime-guard.test.ts`

Binding. On load (when `enabled`) the plugin registers `api.on("tts_prepare", handler)` — the TYPED hook table, NOT the legacy `api.registerHook`, which the typed dispatcher silently ignores (a hook registered the legacy way never fires, with no error). It resolves `runtime.llm.complete` lazily per invocation, not at register time, so it never dereferences a missing runtime in a CLI/no-gateway context. The handler wraps the whole engine in try/catch and returns `undefined` on any throw, so a plugin bug degrades to plain TTS instead of breaking synthesis.

Strategy pipeline (`src/engine.ts`, selected from the resolved provider id + the hook's `providerModel`). ElevenLabs on `eleven_v3` → INLINE-TAGS: the annotation LLM inserts bracketed v3 audio tags (`[softly]`, `[laughs]`, …) from a v3-tuned palette and distils physical-action narration out of the spoken words, returning `{ text: tagged }`. Google `gemini-2.5-flash-preview-tts` → STYLE-INSTRUCTION: the LLM returns JSON `{ spoken, direction }`; the plugin speaks `spoken` (narration distilled out) and passes `direction` as `providerOverrides.personaPrompt`, which the Google-provider carry routes into the Gemini director's notes (never the transcript). Any other provider → passthrough. Strategy selection is why `providerModel` is load-bearing in the hook: `eleven_v3` inline tags vs a Gemini style prompt are not interchangeable, and sending inline tags to a non-v3 model would speak the brackets aloud.

Integrity guards — the part that took four review passes to get right, because a plugin must NEVER speak fabricated or meaning-inverted text. Distilled `spoken` output must be an ordered SUBSEQUENCE of the original (`preservationRatio ≥ 0.97`; catches fabrication, reordering, wholesale rewrite); a keep-floor rejects near-total gutting of a long message; and a NEGATION guard catches meaning inversion from over-distillation ("I will not go" → "I will go") WITHOUT penalising legitimate narration removal, which frequently carries its own negations ("he doesn't move"). The negation guard aligns kept words in BOTH directions (leftmost- and rightmost-greedy) and flags a dropped polarity token only when it is dropped under both alignments AND sat next to a word kept under both — this distinguishes a genuinely lost negation from a duplicate-collision artifact (a repeated "don't" where one copy survives). The tokenizer normalises apostrophe variants (U+2019/U+02BC/U+FF07/U+2032/… → ASCII) in BOTH the word tokenizer and the span tokenizer so contractions like "won't" stay one matchable token and the repair path's offsets stay consistent. The inline-tags path additionally repairs bare descriptive cues into brackets (`Smiles softly.` → `[Smiles softly]`) while preserving all validated cues; tag count is intentionally uncapped. Every guard failure fails open to the original text. Known accepted residuals: the negation adjacency window is ±1 (an inversion whose negation has both index-neighbours also stripped is missed), and polarity lexemes outside the negation set (refuse/deny/unless) are unchecked — both low-realism given the annotation model's discipline, both documented rather than fixed to avoid re-introducing false positives.

Orchestration + fail-open. Each annotation runs the configured `model` then `fallbackModels` in order, each under a per-attempt AbortController timeout RACED against an independent timer (so a signal-ignoring adapter still cannot exceed the budget), bounded by a total budget; retryable failures (timeout/429/5xx/408/425) advance to the next model, auth/config errors are terminal, and a non-string completion is treated as retryable rather than allowed to throw. Results are cached in a bounded LRU keyed by strategy+model+persona+text. Any exhaustion, timeout, JSON-parse failure, or validation miss returns the original text unchanged — synthesis is never blocked or corrupted.

Live wiring (`openclaw.json`). Annotation uses `openai/gpt-5.6-luna` with no explicit reasoning request and no fallback model. Sky's persona routes to ElevenLabs `eleven_v3` (inline-tags), as does Luke. The plugin owns its own tests (`npm test` in `~/projects/voice-emotion`); the fork-side seam tests are listed under the `tts_prepare` section above.

Rebase notes:

- Keep this as an out-of-tree consumer contract. Core owns the generic `tts_prepare` and provider-override seams; model prompts, integrity guards, retry policy, and cache behavior remain in `voice-emotion`.
- Re-prove fail-open behavior in both repositories whenever the hook event, provider override, or synthesis-limit contract changes.

### Message tool progress sends (message_tool_only turn-release opt-out)

Carry behavior: the `message` tool send schema gains an optional `progress?: boolean`. When `progress: true`, a delivered implicit-route `message(action=send)` (or receipt-confirmed `action=reply`) is treated as a mid-turn status ping, NOT the final source reply: `isDeliveredMessageToolOnlySourceReplyResult` returns `false`, so in `message_tool_only` mode the send no longer sets `terminate` on the Codex dynamic-tool response and the app-server turn keeps running. Motivation: upstream #95942 (`9b9a124cc5`, first shipped in the v2026.7.1-beta.1 base) started classifying every delivered implicit source send as the completed source reply and releasing the Codex turn (`releaseTurnAfterTerminalDynamicTool`), which killed mid-turn progress updates on Telegram/Codex sessions — the agent's "working on it…" ping ended its own turn. Progress sends intentionally do NOT set `didDeliverSourceReplyViaMessageTool`, so a turn whose only visible output was progress pings still counts as having sent no final reply. Additive/optional and upstream-PR candidate.

Primary seam files:

- `src/agents/tools/message-tool.ts` (send schema `progress` param)
- `src/agents/embedded-agent-message-tool-source-reply.ts` (`progress === true` short-circuit in `isDeliveredMessageToolOnlySourceReplyResult` — the shared chokepoint; covers the Codex bridge, embedded runner, CLI runner, and SDK harness consumers)
- `extensions/codex/src/app-server/dynamic-tools.ts` (`executedArgs.progress !== true` guard on `receiptConfirmedSourceReply`, which bypasses the shared classifier)
- `src/infra/outbound/message-action-tts.ts` + `src/infra/outbound/message-action-runner.ts` (`progress !== true` gate on ambient source-reply TTS: message-action TTS hardcodes `kind: "final"` because every message_tool_only send used to BE final; without the gate, `mode: "final"` config still voice-notes progress pings)
- `src/agents/embedded-agent-message-tool-source-reply.test.ts`
- `extensions/codex/src/app-server/dynamic-tools.test.ts`
- `src/infra/outbound/message-action-tts.test.ts`

Primary seam tests:

- `pnpm test src/agents/embedded-agent-message-tool-source-reply.test.ts extensions/codex/src/app-server/dynamic-tools.test.ts src/infra/outbound/message-action-tts.test.ts`

Rebase notes:

- The classifier short-circuit must stay ABOVE the send/reply action gating in `isDeliveredMessageToolOnlySourceReplyResult` so it covers both the implicit-send and verified-explicit-route paths.
- `receiptConfirmedSourceReply` in the Codex bridge is computed independently of the classifier; it needs its own `executedArgs.progress !== true` term or progress `action=reply` receipts re-terminate the turn.
- `toolConfirmedSourceReply` (tool result `terminate: true`) is intentionally NOT guarded: a tool explicitly terminating overrides the progress marker.
- Agent-facing contract lives only in the schema description; workspace prompts for agents that send status pings should tell them to pass `progress: true` on non-final sends.
- The ambient-TTS gate reads `progress` via `readBooleanParam(params, "progress")` in `message-action-runner.ts` and must ride along with the classifier carry: dropping it re-enables voice notes on progress pings whenever `messages.tts.auto` is `always` in message_tool_only sessions. Explicit `[tts]` directives in progress text still synthesize by design.

### Telegram spooled-handler progress watchdog

Carry behavior: Telegram isolated polling may abort a claimed spooled update only after the configured interval passes with no reply-run progress. Total handler age is not a timeout. Active `bot.handleUpdate()` work and deferred debounce/media-group work share the same progress contract, so the active-to-buffered handoff cannot lose a progress pulse. The default inactivity window remains 25 minutes; `OPENCLAW_TELEGRAM_SPOOLED_HANDLER_TIMEOUT_MS` overrides that inactivity window for polling sessions.

Primary seam files:

- `src/auto-reply/get-reply-options.types.ts`
- `src/auto-reply/reply/dispatch-from-config.ts`
- `extensions/telegram/src/bot-processing-outcome.ts`
- `extensions/telegram/src/bot-handlers.runtime.ts`
- `extensions/telegram/src/bot-message.ts`
- `extensions/telegram/src/bot-message-dispatch.ts`
- `extensions/telegram/src/polling-session.ts`

Rebase notes:

- Keep the generic `GetReplyOptions.onProgress` observer best-effort and non-fatal. It must follow the existing centralized reply-progress marker so tool, reasoning, item, plan, approval, patch, command-output, and block progress all count without Telegram duplicating event classification.
- `dispatchTelegramMessage` must destructure and forward its optional `onProgress` callback directly into `replyOptions`; keep an identity assertion in `bot-message-dispatch.test.ts` so an undeclared or dropped callback cannot break every inbound Telegram dispatch at runtime.
- Immediate spooled turns report through the replay async context. Buffered/debounced turns carry `TelegramSpooledReplayDeferredParticipant.noteProgress()` explicitly, and the participant owns the last-progress timestamp across the handoff.
- Preserve stuck-turn recovery: once the inactivity threshold expires, fail the spool claim, supersede the Telegram reply fence, wait the abort grace, and restart isolated ingress exactly as before.
- Focused proof: `node scripts/run-vitest.mjs extensions/telegram/src/polling-session.test.ts --reporter=verbose` passed 74/74, including active and buffered deadline refresh regressions. `src/auto-reply/reply/dispatch-from-config.test.ts` passed 259/259 in the combined focused run, including the generic observer assertion. After the post-land callback-plumbing correction, `node scripts/run-vitest.mjs extensions/telegram/src/bot-message-dispatch.test.ts` passed 177/177.

### WhatsApp inbound message archive

Carry behavior: `extensions/whatsapp/src/inbound/message-archive.ts` (`createWhatsAppMessageArchive`) writes inbound Baileys messages into a `wa-fetch`-schema `messages.db` (WAL, 500ms blocking `busy_timeout`, `INSERT OR IGNORE` on Baileys message id, one `BEGIN`/`COMMIT` per upsert batch with per-row-autocommit fallback). It is tapped in `inbound/monitor.ts` `handleMessagesUpsert` at the top, before approval/access filtering, and closed in the inbound `close()`.

Invariant: archiving can NEVER affect dispatch. The whole init (open, pragmas, schema, and `db.prepare`, where an incompatible pre-existing `messages` table surfaces) degrades to `null` with the fd closed on post-open failure; `store()` and `close()` swallow their own errors.

Primary seam files:

- `extensions/whatsapp/src/inbound/message-archive.ts`
- `extensions/whatsapp/src/inbound/monitor.ts`
- `extensions/whatsapp/src/zod-schema.providers-whatsapp.ts` (`buildWhatsAppCommonShape`)
- `extensions/whatsapp/src/types.whatsapp.ts` (`WhatsAppArchiveConfig`)
- `extensions/whatsapp/src/accounts.ts` (`ResolvedWhatsAppAccount.archive`)
- `src/config/bundled-channel-config-metadata.generated.ts` (generated; see rebase note)

Primary seam tests:

- `node scripts/run-vitest.mjs run extensions/whatsapp/src/inbound/message-archive.test.ts`

Rebase notes:

- REBASE TRAP: after touching the zod schema you MUST regenerate `src/config/bundled-channel-config-metadata.generated.ts` (`node --import tsx scripts/generate-bundled-channel-config-metadata.ts --write`) and rebuild `dist`. The gateway validates `channels.whatsapp` against that baked JSON schema, not the live zod. A hand-merged or stale file crashloops the gateway with `must-not-have-additional-properties: archive`. Regenerate; never hand-merge this file.
- Config `channels.whatsapp.archive {enabled, dbPath}` defaults to off, with per-account override.
- Multi-account: a shared channel-level `dbPath` means in-process WAL writer serialization bounded by the 500ms timeout. Prefer per-account `dbPath` overrides.

### Android phone chat bubble width

Carry behavior: `apps/android/.../ui/chat/ChatScreen.kt` defines `CHAT_SCREEN_BUBBLE_WIDTH_FRACTION = 0.85f` and applies it uniformly, replacing upstream's role-specific `fillMaxWidth(if (isUser) 0.84f else 0.94f)`.

Primary seam files:

- `apps/android/app/src/main/java/ai/openclaw/app/ui/chat/ChatScreen.kt`
- `apps/android/app/src/test/java/ai/openclaw/app/ui/chat/ChatScreenLayoutTest.kt`

Rebase notes:

- Upstream heavily rewrote `ChatScreen.kt`; re-anchor the constant onto the current `Surface` width modifier rather than reapplying the old hunk.

### Wear OS native assistant entrypoint

Carry behavior: `apps/android/{app,wear}/assistant/OpenClawVoiceInteractionService.kt` and `OpenClawRecognitionService.kt` bind `BIND_VOICE_INTERACTION` / `RecognitionService` via manifest, giving the watch a native assistant entrypoint. Upstream ships only the phone `AssistantLaunch.kt` ASSIST intent (partial overlap).

Primary seam files:

- `apps/android/app/src/main/java/ai/openclaw/app/assistant/*`
- `apps/android/wear/**` (fork-only module; `settings.gradle` `include(":wear")`)

Rebase notes:

- The `wear/` tree is absent upstream and re-drops clean; the integration surfaces (`NodeRuntime.kt`, manifests) are what conflict.

### Gateway doctor source-checkout warning

Carry behavior: `src/commands/doctor-gateway-services.ts` hard-sets `const sourceCheckoutWarning = null`, suppressing upstream's `summarizeGatewayServiceLayout` nag on a source checkout. Upstream provides the opposite behavior, so the suppression must be carried.

Primary seam files:

- `src/commands/doctor-gateway-services.ts`

Rebase notes:

- Downstream consumers of `sourceCheckoutWarning` remain but are dead code. If upstream restructures the warning, re-suppress at the new computation site rather than deleting the consumers.

### Async TTS voice-supplement detach

Carry behavior: `src/auto-reply/reply/detached-tts-tasks.ts` (`registerDetachedTtsTask` / `getDetachedTtsTaskCount` / `waitForDetachedTtsTasks`, module-singleton `openclaw.detachedTtsTasks`) plus `detached-tts-supplement.ts` (`detachTtsSupplement`) move block-only final TTS synthesis off the dispatch turn. `dispatch-from-config.ts` hands synthesis and voice-note delivery to a detached task via `runAfterReplyOperationClear` and `deliverTtsSupplementToOriginating` (lazy `loadRouteReplyRuntime`, process-scoped `routeReply` to the originating surface, NOT the per-turn dispatcher torn down at turn end). `server.impl.ts` adds `getDetachedTtsTaskCount()` to `getPendingReplyCount` plus a pre-restart deferral so shutdown bounds in-flight synthesis.

Primary seam files:

- `src/auto-reply/reply/detached-tts-tasks.ts`
- `src/auto-reply/reply/detached-tts-supplement.ts`
- `src/auto-reply/reply/dispatch-from-config.ts`
- `src/gateway/server.impl.ts`

Rebase notes:

- Scope is deliberately narrow: only the block-only final path detaches. The main and per-block paths stay inline, and ACP paths (`dispatch-acp*`) are intentionally inline because they have no `ReplyOperation` lane-clear seam and `deliver` mutates turn-local counters snapshotted synchronously.
- `blockOnlyVisibleFinalDelivered` guards `noVisibleReplyFallbackEligible`, replacing the old incidental `counts.final` bump. Only Feishu consumes the flag.
- Upstream rewrote `dispatch-from-config.ts` heavily; re-anchor the block-only final branch rather than reapplying the old hunk.

### Gateway client pre-hello send gate

Carry behavior: non-connect frames are held until the connect handshake completes, so nothing races ahead of `req/connect`. The server otherwise rejects the whole connection (`src/gateway/server/ws-connection/message-handler.ts` "invalid handshake: first request must be connect", close 1008 — upstream and unchanged; the fork touches clients only).

Primary seam files:

- `packages/gateway-client/src/client.ts` (`request()` gate; `waitForHandshake`; waiters settled on hello-ok, rejected on close/stop/reconnect via `settleHandshakeWaiters`; `helloOkReceived` flipped synchronously on the connect response ahead of its `.then` backstop; queued frames cleared per-connection, never replayed onto a later socket)
- `apps/android/app/src/main/java/ai/openclaw/app/gateway/GatewaySession.kt` (`Connection.request()` / `sendRequestFrame()` gate on `awaitHandshakeReady` for `method != "connect"`, parking on a per-`Connection` `connectDeferred`)

Primary seam tests:

- `src/gateway/client.test.ts` ("pre-hello send gate")
- `GatewaySessionReconnectTest.nodeEventBeforeHelloWaitsForConnectHandshake`

Rebase notes:

- Queued frames must never replay onto a later socket; keep the per-connection clear.
- `helloOkReceived` must flip synchronously on the connect response, not only in the `.then` backstop, or the first post-connect request can still race.

### Tokenjuice fork runtime package

Carry behavior: the bundled `@openclaw/tokenjuice` plugin must execute the runtime produced by Bex's committed Tokenjuice fork, including bounded OpenClaw fallback and Codex-native PreToolUse wrapping. OpenClaw overrides public `tokenjuice@0.8.1` with the exact public Heliasar Git commit; this keeps clean-clone installs reproducible while the fork repository remains the source and test owner. Codex command progress resolves the model-requested command from OpenClaw's native PreToolUse relay for presentation, while execution, policy, hooks, trajectory, and audit continue to use the actual Tokenjuice wrapper command.

Primary seam files:

- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `src/agents/harness/native-hook-relay.ts`
- `src/plugin-sdk/agent-harness-runtime.ts`
- `extensions/codex/src/app-server/run-attempt.ts`
- `extensions/codex/src/app-server/event-projector.ts`

Primary seam tests:

- `pnpm install --frozen-lockfile`
- SHA-256 checks for installed `dist/index.js` and `dist/hosts/codex/index.js` must match Heliasar commit `86b6447ce81b557751a4f88f4801643aabc37056`.
- `node scripts/run-vitest.mjs extensions/tokenjuice/index.test.ts extensions/tokenjuice/manifest.test.ts test/scripts/root-package-overrides.test.ts`
- `node scripts/run-vitest.mjs src/agents/harness/native-hook-relay.test.ts extensions/codex/src/app-server/event-projector.test.ts`

Closeout proof from the implementation pass:

- `node scripts/run-vitest.mjs src/agents/harness/native-hook-relay.test.ts extensions/codex/src/app-server/event-projector.test.ts extensions/codex/src/app-server/run-attempt.native-hook-relay.test.ts src/plugins/sdk-alias.test.ts` passed 313 tests across three Vitest shards.
- `pnpm build` passed, `openclaw-gateway.service` was restarted, and the direct final-dist Gateway probe reported the service active and listening on `127.0.0.1:18789`.
- Live Sky run `d06f00ac-a3dc-4d5a-b686-abb625c2557e` (session `6f4e9412-9aed-4367-8230-64ffea9cccc8`) made one Bash call. The mirrored assistant/UI transcript stored only `printf 'tokenjuice-ui-proof\\n'`; the matching trajectory event retained the actual `tokenjuice wrap --source codex --no-record-stats` execution command and the tool result succeeded.

Rebase notes:

- Update the full commit pin only after the Tokenjuice fork commit is pushed to Heliasar and its complete validation suite passes.
- Keep `extensions/tokenjuice/package.json` on the public `tokenjuice` version. The root override is Bex-fork install policy, not a published plugin dependency contract.
- Correlate presentation input by the exact native relay id and tool-use id; never parse Tokenjuice command strings or infer the original command from `commandActions`.
- Normal progress labels and presents the model-requested command when it differs from execution; raw progress and every execution, approval, policy, after-tool hook, trajectory, action fingerprint, and audit diagnostic keep the executed command. Missing or truncated relay input falls back to the executed command.
- Restart the Gateway after reinstalling and verify checksums again after any automatic UI dependency reconciliation.
- Drop when the Tokenjuice fork's bounded OpenClaw and Codex-native compaction seams are absorbed upstream.

## Narrow validation set

- `pnpm test extensions/openai/responses-lite.test.ts src/llm/providers/stream-wrappers/openai.test.ts src/agents/simple-completion-runtime.test.ts src/agents/openai-transport-stream.test.ts`
- `pnpm test src/plugins/runtime/index.test.ts src/plugins/registry.runtime-config.test.ts src/gateway/server-plugins.test.ts src/gateway/server-methods/agent.test.ts src/gateway/server.sessions.create.test.ts packages/gateway-protocol/src/schema/agent.test.ts extensions/active-memory/index.test.ts`
- `cd ../lossless-claw && npm test -- --run test/plugin-config-registration.test.ts test/focus-briefs.test.ts test/doctor-contract-api.test.ts && npm run typecheck && npm run build`
- `pnpm test src/plugins/bundled-plugin-metadata.test.ts test/scripts/tracked-bundled-plugin-dirs.test.ts`
- `pnpm runtime-sidecars:check`
- `pnpm test src/agents/acp-spawn.test.ts`
- `pnpm test src/acp/control-plane/manager.test.ts`
- `node scripts/run-vitest.mjs src/gateway/runtime-plugin-config.test.ts src/config/sessions.cache.test.ts src/agents/provider-auth-aliases.test.ts src/channels/plugins/package-state-probes.test.ts src/plugins/plugin-metadata-snapshot.memo.test.ts src/plugins/plugin-registry-snapshot.test.ts src/plugins/plugin-registry-contributions.current-snapshot.test.ts src/plugins/sdk-alias.test.ts`
- `pnpm build && pnpm ui:build`
- `openclaw gateway restart && openclaw gateway status --deep`
- `./scripts/verify-codex-devbox-acp.js --help`
- `pnpm test ui/src/ui/chat/grouped-render.test.ts ui/src/ui/chat/talk-tts.test.ts ui/src/ui/chat/strip-markdown-for-speech.test.ts`
- `pnpm test src/gateway/server-methods/talk.test.ts src/gateway/talk-realtime-relay.test.ts packages/gateway-protocol/src/index.test.ts`
- `pnpm test src/gateway/gateway-misc.test.ts src/gateway/server-methods/talk.test.ts src/gateway/talk-realtime-relay.test.ts packages/gateway-protocol/src/index.test.ts extensions/discord/src/voice/realtime.wake-name-followup.test.ts extensions/discord/src/voice/manager.e2e.test.ts`
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
- The managed/minimum Codex app-server is `0.144.5`. Its current-platform npm package must contain executable sibling `codex` and `codex-code-mode-host` artifacts; no separate sidecar package is installed. Responses Lite transport identity must derive this managed package version instead of carrying a second hardcoded version. Preserve `ultra` as a distinct canonical thinking level for GPT-5.6 Sol/Terra and clamp it through authoritative model metadata for models such as Luna that stop at `max`.

Closeout proof from the implementation pass:

- Focused validation: `node scripts/run-vitest.mjs src/agents/codex-app-server-base-prompt.test.ts src/agents/system-prompt.test.ts src/agents/embedded-agent-runner/run/attempt-system-prompt.test.ts extensions/codex/src/app-server/thread-lifecycle.test.ts extensions/codex/src/app-server/run-attempt.test.ts extensions/codex/src/app-server/run-attempt.context-engine.test.ts extensions/codex/src/conversation-binding.test.ts src/gateway/gateway.test.ts`
- Docs/format/build: `pnpm docs:check-mdx`, `git diff --check`, `pnpm build`.
- Review loop: `.agents/skills/autoreview/scripts/autoreview --mode local --engine codex` clean after fixing two accepted findings; `$ultra-review` found no additional blocking/actionable issues.
- Deployment: `openclaw-gateway.service` stopped, `pnpm build` passed, requested `pnpm ui:rebuild` was unavailable in this checkout, supported `pnpm ui:build` passed, gateway restarted.
- Runtime proof: `/healthz` returned `200 OK`; `/readyz` remained `503` only because configured dependency `whatsapp` was failing, unrelated to this seam.
