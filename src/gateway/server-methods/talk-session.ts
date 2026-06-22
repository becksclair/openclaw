import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "@openclaw/normalization-core/string-coerce";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateTalkSessionAppendAudioParams,
  validateTalkSessionCancelOutputParams,
  validateTalkSessionCancelTurnParams,
  validateTalkSessionCloseParams,
  validateTalkSessionCreateParams,
  validateTalkSessionJoinParams,
  validateTalkSessionSteerParams,
  validateTalkSessionSubmitToolResultParams,
  validateTalkSessionTurnParams,
} from "../../../packages/gateway-protocol/src/index.js";
import {
  resolveAgentConfig,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { readVoiceAgentBasePrompt } from "../../agents/voice-agent-base-prompt-file.js";
import {
  canonicalizeMainSessionAlias,
  resolveAgentIdFromSessionKey,
} from "../../config/sessions.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { REALTIME_VOICE_AGENT_CONSULT_TOOL } from "../../talk/agent-consult-tool.js";
import { REALTIME_VOICE_AGENT_CONTROL_TOOL } from "../../talk/agent-run-control-shared.js";
import { controlRealtimeVoiceAgentRun } from "../../talk/agent-run-control.js";
import { resolveConfiguredRealtimeVoiceProvider } from "../../talk/provider-resolver.js";
import {
  buildTalkRealtimeContextPacket,
  type TalkRealtimeContextPacket,
} from "../../talk/realtime-context.js";
import {
  createRealtimeDirectTools,
  type RealtimeDirectTools,
} from "../../talk/realtime-direct-tools.js";
import { buildTalkRealtimeInstructions } from "../../talk/realtime-instructions.js";
import type { TalkBrain, TalkMode, TalkTransport } from "../../talk/talk-events.js";
import { ADMIN_SCOPE, TALK_SECRETS_SCOPE } from "../operator-scopes.js";
import { resolveSessionKeyFromResolveParams } from "../sessions-resolve.js";
import {
  cancelTalkHandoffTurn,
  createTalkHandoff,
  endTalkHandoffTurn,
  getTalkHandoff,
  joinTalkHandoff,
  revokeTalkHandoff,
  startTalkHandoffTurn,
} from "../talk-handoff.js";
import {
  cancelTalkRealtimeRelayTurn,
  createTalkRealtimeRelaySession,
  sendTalkRealtimeRelayAudio,
  steerTalkRealtimeRelayAgentRun,
  stopTalkRealtimeRelaySession,
  submitTalkRealtimeRelayToolResult,
} from "../talk-realtime-relay.js";
import {
  forgetUnifiedTalkSession,
  getUnifiedTalkSession,
  rememberUnifiedTalkSession,
  requireUnifiedTalkSessionConn,
} from "../talk-session-registry.js";
import {
  TalkTranscriptionRelayProviderError,
  assertTalkTranscriptionRelayProvider,
  cancelTalkTranscriptionRelayTurn,
  createTalkTranscriptionRelaySession,
  sendTalkTranscriptionRelayAudio,
  stopTalkTranscriptionRelaySession,
} from "../talk-transcription-relay.js";
import { formatForLog } from "../ws-log.js";
import {
  broadcastTalkRoomEvents,
  buildTalkTranscriptionConfig,
  buildRealtimeVoiceLaunchOptions,
  buildTalkRealtimeConfig,
  canUseTalkDirectTools,
  resolveConfiguredRealtimeTranscriptionProvider,
  talkHandoffErrorCode,
  withRealtimeBrowserOverrides,
} from "./talk-shared.js";
import type { GatewayRequestHandlers } from "./types.js";

function normalizeTalkSessionMode(params: { mode?: string; transport?: string }): TalkMode {
  const mode = normalizeOptionalLowercaseString(params.mode) as TalkMode | undefined;
  if (mode) {
    return mode;
  }
  return normalizeOptionalLowercaseString(params.transport) === "managed-room"
    ? "stt-tts"
    : "realtime";
}

function normalizeTalkSessionTransport(params: {
  mode: TalkMode;
  transport?: string;
}): TalkTransport {
  const transport = normalizeOptionalLowercaseString(params.transport) as TalkTransport | undefined;
  if (transport) {
    return transport;
  }
  return params.mode === "stt-tts" ? "managed-room" : "gateway-relay";
}

function normalizeTalkSessionBrain(params: { mode: TalkMode; brain?: string }): TalkBrain {
  const brain = normalizeOptionalLowercaseString(params.brain) as TalkBrain | undefined;
  if (brain) {
    return brain;
  }
  return params.mode === "transcription" ? "none" : "agent-consult";
}

function isActiveManagedRoomClient(
  session: { handoffId: string },
  connId: string | undefined,
): boolean {
  if (!connId) {
    return false;
  }
  const handoff = getTalkHandoff(session.handoffId);
  return handoff?.room.activeClientId === connId;
}

function canCloseManagedRoomSession(
  session: { handoffId: string },
  connId: string | undefined,
): boolean {
  const handoff = getTalkHandoff(session.handoffId);
  return !handoff?.room.activeClientId || handoff.room.activeClientId === connId;
}

function canCreateUnscopedManagedRoomSession(
  client: { connect?: { scopes?: string[] } } | null,
): boolean {
  return client?.connect?.scopes?.includes(ADMIN_SCOPE) === true;
}

function canCreateScopedRealtimeSession(
  client: { connect?: { scopes?: string[] } } | null,
): boolean {
  return client?.connect?.scopes?.includes(ADMIN_SCOPE) === true;
}

function canCreateOwnerMainRealtimeSession(
  client: { connect?: { scopes?: string[] } } | null,
): boolean {
  const scopes = client?.connect?.scopes ?? [];
  return scopes.includes(ADMIN_SCOPE) || scopes.includes(TALK_SECRETS_SCOPE);
}

function realtimeDirectToolsScopeError() {
  return errorShape(
    ErrorCodes.INVALID_REQUEST,
    `talk.session.create realtime direct tools require spawnedBy or gateway scope: ${ADMIN_SCOPE}`,
  );
}

function isDefaultMainAgentSession(cfg: OpenClawConfig, sessionKey: string | undefined): boolean {
  if (!sessionKey) {
    return false;
  }
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return false;
  }
  return parsed.agentId === resolveDefaultAgentId(cfg) && parsed.rest === "main";
}

function resolveRealtimeSessionAgentId(cfg: OpenClawConfig, sessionKey: string | undefined) {
  return parseAgentSessionKey(sessionKey)
    ? resolveAgentIdFromSessionKey(sessionKey)
    : resolveDefaultAgentId(cfg);
}

function isMissingSessionKeyResolveError(params: {
  requestedSessionKey: string;
  resolvedSession: { ok: false; error: { code?: string; message?: string } };
}): boolean {
  return (
    params.resolvedSession.error.code === ErrorCodes.INVALID_REQUEST &&
    params.resolvedSession.error.message === `No session found: ${params.requestedSessionKey}`
  );
}

function resolveFreshDefaultRealtimeSessionKey(params: {
  cfg: OpenClawConfig;
  requestedSessionKey: string;
  resolvedSession: { ok: false; error: { code?: string; message?: string } };
}): string | undefined {
  if (!isMissingSessionKeyResolveError(params)) {
    return undefined;
  }
  const defaultAgentId = resolveDefaultAgentId(params.cfg);
  const parsed = parseAgentSessionKey(params.requestedSessionKey);
  if (parsed) {
    const isKnownAgent =
      parsed.agentId === defaultAgentId || Boolean(resolveAgentConfig(params.cfg, parsed.agentId));
    return isKnownAgent ? `agent:${parsed.agentId}:${parsed.rest}` : undefined;
  }
  const canonicalMainKey = canonicalizeMainSessionAlias({
    cfg: params.cfg,
    agentId: defaultAgentId,
    sessionKey: params.requestedSessionKey,
  });
  if (canonicalMainKey === params.requestedSessionKey) {
    return undefined;
  }
  return canonicalMainKey;
}

const REALTIME_CONTEXT_STARTUP_TIMEOUT_MS = 1_500;

async function buildTalkRealtimeContextPacketForStartup(params: {
  cfg: OpenClawConfig;
  agentId: string;
  sessionKey: string;
  summaryThresholdTokens: number;
}): Promise<TalkRealtimeContextPacket | undefined> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const contextPromise = buildTalkRealtimeContextPacket({
    ...params,
    signal: controller.signal,
  }).catch(() => undefined);
  const timeoutPromise = new Promise<TalkRealtimeContextPacket>((resolve) => {
    timeout = setTimeout(() => {
      const contextNote =
        "Realtime session context was skipped because context assembly exceeded the startup budget.";
      controller.abort();
      resolve({
        text: contextNote,
        summarySource: "none",
        degraded: true,
        contextNote,
      });
    }, REALTIME_CONTEXT_STARTUP_TIMEOUT_MS);
    if (typeof timeout === "object" && typeof timeout.unref === "function") {
      timeout.unref();
    }
  });

  try {
    return await Promise.race([contextPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function managedRoomOwnershipError(action: string) {
  return errorShape(
    ErrorCodes.INVALID_REQUEST,
    `talk.session.${action} requires the active managed-room connection`,
  );
}

export const talkSessionHandlers: GatewayRequestHandlers = {
  "talk.session.create": async ({ params, respond, context, client }) => {
    if (!validateTalkSessionCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid talk.session.create params: ${formatValidationErrors(validateTalkSessionCreateParams.errors)}`,
        ),
      );
      return;
    }

    const mode = normalizeTalkSessionMode(params);
    const transport = normalizeTalkSessionTransport({ mode, transport: params.transport });
    const brain = normalizeTalkSessionBrain({ mode, brain: params.brain });

    if (transport === "webrtc" || transport === "provider-websocket") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `talk.session.create is Gateway-managed; use talk.client.create for client transport "${transport}"`,
        ),
      );
      return;
    }

    try {
      if (transport === "managed-room") {
        if (brain === "direct-tools" && !canUseTalkDirectTools(client)) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `talk.session.create brain="direct-tools" requires gateway scope: ${ADMIN_SCOPE}`,
            ),
          );
          return;
        }
        const spawnedBy = normalizeOptionalString(params.spawnedBy);
        if (
          normalizeOptionalString(params.sessionKey) &&
          !spawnedBy &&
          !canCreateUnscopedManagedRoomSession(client)
        ) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `talk.session.create managed-room sessionKey requires spawnedBy or gateway scope: ${ADMIN_SCOPE}`,
            ),
          );
          return;
        }
        const resolvedSession = await resolveSessionKeyFromResolveParams({
          cfg: context.getRuntimeConfig(),
          p: {
            key: params.sessionKey,
            ...(spawnedBy ? { spawnedBy } : {}),
            includeGlobal: true,
            includeUnknown: true,
          },
        });
        if (!resolvedSession.ok) {
          respond(false, undefined, resolvedSession.error);
          return;
        }
        if ("missing" in resolvedSession) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, `No session found: ${params.sessionKey}`),
          );
          return;
        }
        const handoff = createTalkHandoff({
          sessionKey: resolvedSession.key,
          provider: normalizeOptionalString(params.provider),
          model: normalizeOptionalString(params.model),
          voice: normalizeOptionalString(params.voice),
          mode,
          transport,
          brain,
          ttlMs: params.ttlMs,
        });
        rememberUnifiedTalkSession(handoff.id, {
          kind: "managed-room",
          handoffId: handoff.id,
          token: handoff.token,
          roomId: handoff.roomId,
        });
        respond(
          true,
          {
            sessionId: handoff.id,
            provider: handoff.provider,
            mode: handoff.mode,
            transport: handoff.transport,
            brain: handoff.brain,
            handoffId: handoff.id,
            roomId: handoff.roomId,
            roomUrl: handoff.roomUrl,
            token: handoff.token,
            model: handoff.model,
            voice: handoff.voice,
            expiresAt: handoff.expiresAt,
          },
          undefined,
        );
        return;
      }

      const connId = client?.connId;
      if (!connId) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Talk session unavailable"));
        return;
      }

      if (mode === "realtime") {
        if (transport !== "gateway-relay" || brain !== "agent-consult") {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `realtime talk.session.create requires transport="gateway-relay" and brain="agent-consult"`,
            ),
          );
          return;
        }
        const runtimeConfig = context.getRuntimeConfig();
        const realtimeConfig = buildTalkRealtimeConfig(runtimeConfig, params.provider);
        const resolution = resolveConfiguredRealtimeVoiceProvider({
          configuredProviderId: realtimeConfig.provider,
          providerConfigs: realtimeConfig.providers,
          cfg: runtimeConfig,
          cfgForResolve: runtimeConfig,
          noRegisteredProviderMessage: "No realtime voice provider registered",
        });
        const launchOptions = buildRealtimeVoiceLaunchOptions({
          requested: params,
          defaults: realtimeConfig,
        });
        const requestedSessionKey = normalizeOptionalString(params.sessionKey);
        const spawnedBy = normalizeOptionalString(params.spawnedBy);
        const requiresScopedDirectTools = Boolean(realtimeConfig.tools);
        const canCreateScopedRealtime = canCreateScopedRealtimeSession(client);
        const canCreateOwnerMainRealtime = canCreateOwnerMainRealtimeSession(client);
        if (
          requiresScopedDirectTools &&
          !canCreateScopedRealtime &&
          !canCreateOwnerMainRealtime &&
          !(requestedSessionKey && spawnedBy)
        ) {
          respond(false, undefined, realtimeDirectToolsScopeError());
          return;
        }
        let sessionKey = requestedSessionKey;
        let resolvedSpawnLineage = false;
        if (requestedSessionKey) {
          const resolvedSession = await resolveSessionKeyFromResolveParams({
            cfg: runtimeConfig,
            p: {
              key: requestedSessionKey,
              ...(spawnedBy ? { spawnedBy } : {}),
              includeGlobal: true,
              includeUnknown: true,
            },
          });
          if (resolvedSession.ok && "key" in resolvedSession) {
            sessionKey = resolvedSession.key;
            resolvedSpawnLineage = Boolean(spawnedBy);
          } else {
            // A `missing` resolution carries no error to surface; fall back to the
            // not-found message so the fresh-default path has a concrete error.
            const notFound = resolvedSession.ok
              ? errorShape(ErrorCodes.INVALID_REQUEST, `No session found: ${requestedSessionKey}`)
              : resolvedSession.error;
            const freshSessionKey = resolveFreshDefaultRealtimeSessionKey({
              cfg: runtimeConfig,
              requestedSessionKey,
              resolvedSession: { ok: false, error: notFound },
            });
            if (!freshSessionKey) {
              if (requiresScopedDirectTools && !canCreateScopedRealtime) {
                respond(false, undefined, realtimeDirectToolsScopeError());
                return;
              }
              respond(false, undefined, notFound);
              return;
            }
            sessionKey = freshSessionKey;
          }
        }
        const canUseOwnerMainRealtime =
          canCreateOwnerMainRealtime && isDefaultMainAgentSession(runtimeConfig, sessionKey);
        const canUseRequestedSessionContext =
          !requestedSessionKey ||
          resolvedSpawnLineage ||
          canCreateScopedRealtime ||
          canUseOwnerMainRealtime;
        if (
          requiresScopedDirectTools &&
          !canCreateScopedRealtime &&
          !(requestedSessionKey && resolvedSpawnLineage) &&
          !canUseOwnerMainRealtime
        ) {
          respond(false, undefined, realtimeDirectToolsScopeError());
          return;
        }
        const agentId = resolveRealtimeSessionAgentId(runtimeConfig, sessionKey);
        const agentDir = resolveAgentDir(runtimeConfig, agentId);
        const workspaceDir = resolveAgentWorkspaceDir(runtimeConfig, agentId);
        const [voiceBasePrompt, contextPacket] = await Promise.all([
          readVoiceAgentBasePrompt({ agentDir }),
          sessionKey && canUseRequestedSessionContext
            ? buildTalkRealtimeContextPacketForStartup({
                cfg: runtimeConfig,
                agentId,
                sessionKey,
                summaryThresholdTokens: 100_000,
              })
            : Promise.resolve(undefined),
        ]);
        const directTools: RealtimeDirectTools = realtimeConfig.tools
          ? createRealtimeDirectTools({
              cfg: runtimeConfig,
              agentId,
              sessionKey,
              ...(spawnedBy && resolvedSpawnLineage ? { spawnedBy } : {}),
              agentDir,
              workspaceDir,
              modelProvider: resolution.provider.id,
              modelId: launchOptions.model,
              senderIsOwner: canCreateScopedRealtime || canUseOwnerMainRealtime,
            })
          : { tools: [], executors: new Map(), excludedTools: [] };
        const tools = [
          REALTIME_VOICE_AGENT_CONSULT_TOOL,
          REALTIME_VOICE_AGENT_CONTROL_TOOL,
          ...directTools.tools,
        ];
        const session = createTalkRealtimeRelaySession({
          context,
          connId,
          cfg: runtimeConfig,
          provider: resolution.provider,
          providerConfig: withRealtimeBrowserOverrides(resolution.providerConfig, launchOptions),
          instructions: buildTalkRealtimeInstructions({
            voiceBasePrompt,
            contextPacket,
            configuredInstructions: realtimeConfig.instructions,
          }),
          tools,
          directToolExecutors: directTools.executors,
          model: launchOptions.model,
          sessionKey,
          voice: launchOptions.voice,
          forceAgentConsultOnFinalTranscript:
            realtimeConfig.consultRouting === "force-agent-consult",
        });
        rememberUnifiedTalkSession(session.relaySessionId, {
          kind: "realtime-relay",
          connId,
          relaySessionId: session.relaySessionId,
        });
        respond(
          true,
          {
            ...session,
            sessionId: session.relaySessionId,
            mode,
            brain,
          },
          undefined,
        );
        return;
      }

      if (mode === "transcription") {
        if (transport !== "gateway-relay" || brain !== "none") {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `transcription talk.session.create requires transport="gateway-relay" and brain="none"`,
            ),
          );
          return;
        }
        const provider = normalizeOptionalString(params.provider);
        const model = normalizeOptionalString(params.model);
        const transcriptionMode =
          params.transcriptionMode === "buffered" ? "buffered" : "streaming";
        const runtimeConfig = context.getRuntimeConfig();
        let session;
        if (transcriptionMode === "buffered") {
          try {
            assertTalkTranscriptionRelayProvider({ cfg: runtimeConfig, provider });
          } catch (err) {
            if (err instanceof TalkTranscriptionRelayProviderError) {
              respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
              return;
            }
            throw err;
          }
          session = createTalkTranscriptionRelaySession({
            context,
            connId,
            transcriptionMode,
            provider,
            model,
          });
        } else {
          const transcriptionConfig = buildTalkTranscriptionConfig(runtimeConfig, provider);
          try {
            const resolution = resolveConfiguredRealtimeTranscriptionProvider({
              config: runtimeConfig,
              configuredProviderId: transcriptionConfig.provider,
              providerConfigs: transcriptionConfig.providers,
            });
            session = createTalkTranscriptionRelaySession({
              context,
              connId,
              transcriptionMode,
              provider: resolution.provider.id,
              streamingProvider: resolution.provider,
              streamingProviderConfig: resolution.providerConfig,
            });
          } catch (err) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                err instanceof Error ? err.message : String(err),
              ),
            );
            return;
          }
        }
        rememberUnifiedTalkSession(session.transcriptionSessionId, {
          kind: "transcription-relay",
          connId,
          transcriptionSessionId: session.transcriptionSessionId,
        });
        respond(
          true,
          {
            ...session,
            sessionId: session.transcriptionSessionId,
            brain,
          },
          undefined,
        );
        return;
      }

      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `stt-tts talk.session.create requires transport="managed-room"`,
        ),
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "talk.session.join": async ({ params, respond, client, context }) => {
    if (!validateTalkSessionJoinParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid talk.session.join params: ${formatValidationErrors(validateTalkSessionJoinParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const session = getUnifiedTalkSession(params.sessionId);
      if (session.kind !== "managed-room") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "talk.session.join requires a managed-room session",
          ),
        );
        return;
      }
      const result = joinTalkHandoff(session.handoffId, params.token, { clientId: client?.connId });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(
            result.reason === "invalid_token" ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE,
            `talk session join failed: ${result.reason}`,
          ),
        );
        return;
      }
      broadcastTalkRoomEvents(context, result.replacedClientId, {
        handoffId: result.record.id,
        roomId: result.record.roomId,
        events: result.replacementEvents,
      });
      broadcastTalkRoomEvents(context, client?.connId, {
        handoffId: result.record.id,
        roomId: result.record.roomId,
        events: result.activeClientEvents,
      });
      respond(true, result.record, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "talk.session.appendAudio": async ({ params, respond, client }) => {
    if (!validateTalkSessionAppendAudioParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid talk.session.appendAudio params: ${formatValidationErrors(validateTalkSessionAppendAudioParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const session = getUnifiedTalkSession(params.sessionId);
      if (session.kind === "realtime-relay") {
        const connId = requireUnifiedTalkSessionConn(session, client?.connId);
        sendTalkRealtimeRelayAudio({
          relaySessionId: session.relaySessionId,
          connId,
          audioBase64: params.audioBase64,
          timestamp: params.timestamp,
        });
        respond(true, { ok: true }, undefined);
        return;
      }
      if (session.kind === "transcription-relay") {
        const connId = requireUnifiedTalkSessionConn(session, client?.connId);
        sendTalkTranscriptionRelayAudio({
          transcriptionSessionId: session.transcriptionSessionId,
          connId,
          audioBase64: params.audioBase64,
        });
        respond(true, { ok: true }, undefined);
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "talk.session.appendAudio is not supported for managed-room sessions",
        ),
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "talk.session.startTurn": async ({ params, respond, client, context }) => {
    if (!validateTalkSessionTurnParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid talk.session.startTurn params: ${formatValidationErrors(validateTalkSessionTurnParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const session = getUnifiedTalkSession(params.sessionId);
      if (session.kind !== "managed-room") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "talk.session.startTurn requires managed-room"),
        );
        return;
      }
      if (!isActiveManagedRoomClient(session, client?.connId)) {
        respond(false, undefined, managedRoomOwnershipError("startTurn"));
        return;
      }
      const result = startTalkHandoffTurn(session.handoffId, session.token, {
        turnId: params.turnId,
        clientId: client?.connId,
      });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(
            talkHandoffErrorCode(result.reason),
            `talk turn start failed: ${result.reason}`,
          ),
        );
        return;
      }
      broadcastTalkRoomEvents(context, result.record.room.activeClientId, {
        handoffId: result.record.id,
        roomId: result.record.roomId,
        events: result.events,
      });
      respond(true, { ok: true, turnId: result.turnId, events: result.events }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "talk.session.endTurn": async ({ params, respond, client, context }) => {
    if (!validateTalkSessionTurnParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid talk.session.endTurn params: ${formatValidationErrors(validateTalkSessionTurnParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const session = getUnifiedTalkSession(params.sessionId);
      if (session.kind !== "managed-room") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "talk.session.endTurn requires managed-room"),
        );
        return;
      }
      if (!isActiveManagedRoomClient(session, client?.connId)) {
        respond(false, undefined, managedRoomOwnershipError("endTurn"));
        return;
      }
      const result = endTalkHandoffTurn(session.handoffId, session.token, {
        turnId: params.turnId,
      });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(talkHandoffErrorCode(result.reason), `talk turn end failed: ${result.reason}`),
        );
        return;
      }
      broadcastTalkRoomEvents(context, result.record.room.activeClientId, {
        handoffId: result.record.id,
        roomId: result.record.roomId,
        events: result.events,
      });
      respond(true, { ok: true, turnId: result.turnId, events: result.events }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "talk.session.cancelTurn": async ({ params, respond, client, context }) => {
    if (!validateTalkSessionCancelTurnParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid talk.session.cancelTurn params: ${formatValidationErrors(validateTalkSessionCancelTurnParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const session = getUnifiedTalkSession(params.sessionId);
      if (session.kind === "realtime-relay") {
        const connId = requireUnifiedTalkSessionConn(session, client?.connId);
        cancelTalkRealtimeRelayTurn({
          relaySessionId: session.relaySessionId,
          connId,
          reason: normalizeOptionalString(params.reason),
        });
        respond(true, { ok: true }, undefined);
        return;
      }
      if (session.kind === "transcription-relay") {
        const connId = requireUnifiedTalkSessionConn(session, client?.connId);
        cancelTalkTranscriptionRelayTurn({
          transcriptionSessionId: session.transcriptionSessionId,
          connId,
          reason: normalizeOptionalString(params.reason),
        });
        respond(true, { ok: true }, undefined);
        return;
      }
      if (!isActiveManagedRoomClient(session, client?.connId)) {
        respond(false, undefined, managedRoomOwnershipError("cancelTurn"));
        return;
      }
      const result = cancelTalkHandoffTurn(session.handoffId, session.token, {
        turnId: params.turnId,
        reason: params.reason,
      });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(
            talkHandoffErrorCode(result.reason),
            `talk turn cancel failed: ${result.reason}`,
          ),
        );
        return;
      }
      broadcastTalkRoomEvents(context, result.record.room.activeClientId, {
        handoffId: result.record.id,
        roomId: result.record.roomId,
        events: result.events,
      });
      respond(true, { ok: true, turnId: result.turnId, events: result.events }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "talk.session.cancelOutput": async ({ params, respond, client }) => {
    if (!validateTalkSessionCancelOutputParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid talk.session.cancelOutput params: ${formatValidationErrors(validateTalkSessionCancelOutputParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const session = getUnifiedTalkSession(params.sessionId);
      if (session.kind !== "realtime-relay") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "talk.session.cancelOutput requires realtime relay",
          ),
        );
        return;
      }
      const connId = requireUnifiedTalkSessionConn(session, client?.connId);
      cancelTalkRealtimeRelayTurn({
        relaySessionId: session.relaySessionId,
        connId,
        reason: normalizeOptionalString(params.reason) ?? "output-cancelled",
      });
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "talk.session.submitToolResult": async ({ params, respond, client }) => {
    if (!validateTalkSessionSubmitToolResultParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid talk.session.submitToolResult params: ${formatValidationErrors(validateTalkSessionSubmitToolResultParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const session = getUnifiedTalkSession(params.sessionId);
      if (session.kind !== "realtime-relay") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "talk.session.submitToolResult is only supported for realtime relay sessions",
          ),
        );
        return;
      }
      const connId = requireUnifiedTalkSessionConn(session, client?.connId);
      submitTalkRealtimeRelayToolResult({
        relaySessionId: session.relaySessionId,
        connId,
        callId: params.callId,
        result: params.result,
        options: params.options,
      });
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "talk.session.steer": async ({ params, respond, client }) => {
    if (!validateTalkSessionSteerParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid talk.session.steer params: ${formatValidationErrors(validateTalkSessionSteerParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const session = getUnifiedTalkSession(params.sessionId);
      if (session.kind === "realtime-relay") {
        const connId = requireUnifiedTalkSessionConn(session, client?.connId);
        const result = await steerTalkRealtimeRelayAgentRun({
          relaySessionId: session.relaySessionId,
          connId,
          sessionKey: normalizeOptionalString(params.sessionKey),
          text: params.text,
          mode: normalizeOptionalString(params.mode),
        });
        respond(true, result, undefined);
        return;
      }
      if (session.kind === "transcription-relay") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "talk.session.steer requires an agent-backed Talk session",
          ),
        );
        return;
      }
      if (!isActiveManagedRoomClient(session, client?.connId)) {
        respond(false, undefined, managedRoomOwnershipError("steer"));
        return;
      }
      const handoff = getTalkHandoff(session.handoffId);
      const sessionKey = handoff?.sessionKey;
      if (!sessionKey) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "talk.session.steer requires a session key"),
        );
        return;
      }
      const requestedSessionKey = normalizeOptionalString(params.sessionKey);
      if (requestedSessionKey && requestedSessionKey !== sessionKey) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "talk.session.steer sessionKey does not match the managed-room session",
          ),
        );
        return;
      }
      const result = await controlRealtimeVoiceAgentRun({
        sessionKey,
        text: params.text,
        mode: params.mode,
        recentEvents: handoff?.room.talk.recentEvents,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "talk.session.close": async ({ params, respond, client, context }) => {
    if (!validateTalkSessionCloseParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid talk.session.close params: ${formatValidationErrors(validateTalkSessionCloseParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const session = getUnifiedTalkSession(params.sessionId);
      if (session.kind === "realtime-relay") {
        const connId = requireUnifiedTalkSessionConn(session, client?.connId);
        stopTalkRealtimeRelaySession({ relaySessionId: session.relaySessionId, connId });
      } else if (session.kind === "transcription-relay") {
        const connId = requireUnifiedTalkSessionConn(session, client?.connId);
        stopTalkTranscriptionRelaySession({
          transcriptionSessionId: session.transcriptionSessionId,
          connId,
        });
      } else {
        if (!canCloseManagedRoomSession(session, client?.connId)) {
          respond(false, undefined, managedRoomOwnershipError("close"));
          return;
        }
        const result = revokeTalkHandoff(session.handoffId);
        broadcastTalkRoomEvents(context, result.activeClientId, {
          handoffId: session.handoffId,
          roomId: session.roomId,
          events: result.events,
        });
      }
      forgetUnifiedTalkSession(params.sessionId);
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
