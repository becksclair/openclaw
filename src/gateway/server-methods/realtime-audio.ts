import { readConfigFileSnapshot } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  validateRealtimeSessionCloseParams,
  validateRealtimeSessionCreateParams,
  validateRealtimeSessionInputAudioParams,
  validateRealtimeSessionInputTextParams,
  validateRealtimeSessionInterruptParams,
  validateRealtimeSessionToolCallParams,
  validateRealtimeSessionToolResultParams,
  validateRealtimeSessionTransportSignalParams,
} from "../protocol/index.js";
import { createRealtimeProviderAdapter } from "../realtime-audio/providers/index.js";
import { realtimeConversationSessions } from "../realtime-audio/registry.js";
import { DefaultRealtimeToolRuntime } from "../realtime-audio/tool-runtime.js";
import type { RealtimeSessionEvent } from "../realtime-audio/types.js";
import {
  respondRealtimeInvalidParams,
  withRealtimeSessionAction,
} from "./realtime-audio-handler-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function serializeRealtimeSessionEvent(event: RealtimeSessionEvent):
  | RealtimeSessionEvent
  | {
      type: "audio.output";
      sessionId: string;
      audio: {
        itemId: string;
        pcm16Base64: string;
        sampleRate: number;
        mimeType: string;
      };
    } {
  if (event.type !== "audio.output") {
    return event;
  }
  return {
    type: "audio.output",
    sessionId: event.sessionId,
    audio: {
      itemId: event.audio.itemId,
      pcm16Base64: event.audio.chunk.toString("base64"),
      sampleRate: event.audio.sampleRate,
      mimeType: event.audio.mimeType,
    },
  };
}

function resolveRealtimeProviderId(provider?: string): "openai" | "google-live" | undefined {
  if (!provider || provider === "openai") {
    return provider ? "openai" : undefined;
  }
  if (provider === "google-live") {
    return provider;
  }
  return undefined;
}

function missingRequestedCapabilities(
  requested: string[] | undefined,
  actual: Record<string, boolean>,
): string[] {
  if (!requested || requested.length === 0) {
    return [];
  }
  return requested.filter((name) => !actual[name]);
}

export const realtimeAudioHandlers: GatewayRequestHandlers = {
  "realtime.session.create": async ({ params, respond, context, client }) => {
    if (!validateRealtimeSessionCreateParams(params)) {
      respondRealtimeInvalidParams({
        respond,
        method: "realtime.session.create",
        errors: validateRealtimeSessionCreateParams.errors,
      });
      return;
    }

    const providerId = resolveRealtimeProviderId(params.provider);
    if (params.provider && !providerId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unsupported realtime provider: ${params.provider}`),
      );
      return;
    }

    const snapshot = await readConfigFileSnapshot();
    const providerBinding =
      params.transport !== "test" || providerId
        ? {
            adapter: createRealtimeProviderAdapter({
              provider: providerId ?? "openai",
              cfg: snapshot.config,
              agentDir: params.agentDir,
            }),
          }
        : undefined;
    const toolBinding =
      params.transport === "test" ||
      params.sessionKey !== undefined ||
      params.workspaceDir !== undefined ||
      params.agentDir !== undefined
        ? {
            runtime: new DefaultRealtimeToolRuntime({
              config: snapshot.config,
              workspaceDir: params.workspaceDir,
              sessionKey: params.sessionKey,
              agentDir: params.agentDir,
              senderIsOwner: params.senderIsOwner,
            }),
          }
        : undefined;

    const session = realtimeConversationSessions.create({
      transport: params.transport,
      provider: providerBinding ? (providerId ?? "openai") : params.provider,
      fallbackEnabled: params.fallbackEnabled,
      ...(providerBinding ? { providerBinding } : {}),
      ...(toolBinding ? { toolBinding } : {}),
      ownerConnId: client?.connId,
    });
    const targetConnIds = client?.connId ? new Set([client.connId]) : undefined;
    session.subscribe((event) => {
      const payload = serializeRealtimeSessionEvent(event);
      if (targetConnIds) {
        context.broadcastToConnIds("realtime.session", payload, targetConnIds, {
          dropIfSlow: true,
        });
        return;
      }
      context.broadcast("realtime.session", payload, { dropIfSlow: true });
    });
    await session.start();

    const capabilities = session.getCapabilities();
    const missingCapabilities = missingRequestedCapabilities(params.capabilities, capabilities);
    if (missingCapabilities.length > 0) {
      await realtimeConversationSessions.close(
        session.id,
        `missing capabilities: ${missingCapabilities.join(", ")}`,
      );
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `realtime session does not support requested capabilities: ${missingCapabilities.join(", ")}`,
        ),
      );
      return;
    }

    const snapshotState = session.getSnapshot();
    respond(
      true,
      {
        sessionId: snapshotState.sessionId,
        mode: snapshotState.mode,
        state: snapshotState.state,
        capabilities,
      },
      undefined,
    );
  },
  "realtime.session.interrupt": async ({ params, respond, client }) => {
    if (!validateRealtimeSessionInterruptParams(params)) {
      respondRealtimeInvalidParams({
        respond,
        method: "realtime.session.interrupt",
        errors: validateRealtimeSessionInterruptParams.errors,
      });
      return;
    }

    await withRealtimeSessionAction({
      respond,
      connId: client?.connId,
      actionParams: params,
      action: async (session) => {
        await session.interrupt(params.target);
      },
    });
  },
  "realtime.session.close": async ({ params, respond, client }) => {
    if (!validateRealtimeSessionCloseParams(params)) {
      respondRealtimeInvalidParams({
        respond,
        method: "realtime.session.close",
        errors: validateRealtimeSessionCloseParams.errors,
      });
      return;
    }

    await withRealtimeSessionAction({
      respond,
      connId: client?.connId,
      actionParams: params,
      action: async () => {
        await realtimeConversationSessions.close(params.sessionId, params.reason);
      },
    });
  },
  "realtime.session.input.text": async ({ params, respond, client }) => {
    if (!validateRealtimeSessionInputTextParams(params)) {
      respondRealtimeInvalidParams({
        respond,
        method: "realtime.session.input.text",
        errors: validateRealtimeSessionInputTextParams.errors,
      });
      return;
    }

    await withRealtimeSessionAction({
      respond,
      connId: client?.connId,
      actionParams: params,
      action: async (session) => {
        await session.submitText(params.text);
      },
    });
  },
  "realtime.session.input.audio": async ({ params, respond, client }) => {
    if (!validateRealtimeSessionInputAudioParams(params)) {
      respondRealtimeInvalidParams({
        respond,
        method: "realtime.session.input.audio",
        errors: validateRealtimeSessionInputAudioParams.errors,
      });
      return;
    }

    await withRealtimeSessionAction({
      respond,
      connId: client?.connId,
      actionParams: params,
      action: async (session) => {
        await session.submitAudio(Buffer.from(params.audioBase64, "base64"), {
          sampleRate: params.sampleRate,
          channels: params.channels,
        });
      },
    });
  },
  "realtime.session.transport.signal": async ({ params, respond, client }) => {
    if (!validateRealtimeSessionTransportSignalParams(params)) {
      respondRealtimeInvalidParams({
        respond,
        method: "realtime.session.transport.signal",
        errors: validateRealtimeSessionTransportSignalParams.errors,
      });
      return;
    }

    await withRealtimeSessionAction({
      respond,
      connId: client?.connId,
      actionParams: params,
      action: async (session) => {
        await session.submitTransportSignal(params.signal);
      },
    });
  },
  "realtime.session.tool.call": async ({ params, respond, client }) => {
    if (!validateRealtimeSessionToolCallParams(params)) {
      respondRealtimeInvalidParams({
        respond,
        method: "realtime.session.tool.call",
        errors: validateRealtimeSessionToolCallParams.errors,
      });
      return;
    }

    await withRealtimeSessionAction({
      respond,
      connId: client?.connId,
      actionParams: params,
      action: async (session) => {
        await session.invokeToolCall(params.toolCallId, params.toolName, params.args);
      },
    });
  },
  "realtime.session.tool.result": async ({ params, respond, client }) => {
    if (!validateRealtimeSessionToolResultParams(params)) {
      respondRealtimeInvalidParams({
        respond,
        method: "realtime.session.tool.result",
        errors: validateRealtimeSessionToolResultParams.errors,
      });
      return;
    }

    await withRealtimeSessionAction({
      respond,
      connId: client?.connId,
      actionParams: params,
      action: async (session) => {
        await session.submitPendingToolResult(params.toolCallId, params.output);
      },
    });
  },
};
