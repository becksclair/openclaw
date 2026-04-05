import { ErrorCodes, errorShape, formatValidationErrors } from "../protocol/index.js";
import { realtimeConversationSessions } from "../realtime-audio/registry.js";
import type { GatewayRequestHandlers } from "./types.js";

type Respond = Parameters<GatewayRequestHandlers[string]>[0]["respond"];

export function respondRealtimeInvalidParams(params: {
  respond: Respond;
  method: string;
  errors: Parameters<typeof formatValidationErrors>[0];
}): void {
  params.respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${params.method} params: ${formatValidationErrors(params.errors)}`,
    ),
  );
}

export function respondRealtimeUnknownSession(respond: Respond): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown realtime session"));
}

export function respondRealtimeUnavailable(respond: Respond, error: unknown): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
  );
}

export function getRealtimeSessionForClient(sessionId: string, connId?: string) {
  return realtimeConversationSessions.getForConn(sessionId, connId);
}

export async function withRealtimeSessionAction<TParams extends { sessionId: string }>(params: {
  respond: Respond;
  connId?: string;
  actionParams: TParams;
  action: (session: NonNullable<ReturnType<typeof getRealtimeSessionForClient>>) => Promise<void>;
}): Promise<void> {
  const session = getRealtimeSessionForClient(params.actionParams.sessionId, params.connId);
  if (!session) {
    respondRealtimeUnknownSession(params.respond);
    return;
  }

  try {
    await params.action(session);
    params.respond(true, { ok: true }, undefined);
  } catch (error) {
    respondRealtimeUnavailable(params.respond, error);
  }
}
