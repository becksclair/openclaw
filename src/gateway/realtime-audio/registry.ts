import { InMemoryRealtimeConversationSession } from "./session.js";
import type {
  RealtimeConversationSession,
  RealtimeConversationTransport,
  RealtimeSessionProviderBinding,
  RealtimeSessionToolBinding,
  RealtimeSessionTransportBinding,
} from "./types.js";

export type CreateRealtimeSessionOptions = {
  transport: RealtimeConversationTransport;
  provider?: string;
  fallbackEnabled?: boolean;
  providerBinding?: RealtimeSessionProviderBinding;
  toolBinding?: RealtimeSessionToolBinding;
  transportBinding?: RealtimeSessionTransportBinding;
  ownerConnId?: string;
};

type RealtimeConversationSessionRegistryEntry = {
  session: RealtimeConversationSession;
  ownerConnId?: string;
};

export class RealtimeConversationSessionRegistry {
  private sessions = new Map<string, RealtimeConversationSessionRegistryEntry>();

  create(options: CreateRealtimeSessionOptions): RealtimeConversationSession {
    const session = new InMemoryRealtimeConversationSession(options);
    this.sessions.set(session.id, { session, ownerConnId: options.ownerConnId });
    return session;
  }

  get(sessionId: string): RealtimeConversationSession | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  getForConn(sessionId: string, connId?: string): RealtimeConversationSession | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return undefined;
    }
    if (entry.ownerConnId) {
      if (!connId || entry.ownerConnId !== connId) {
        return undefined;
      }
    }
    return entry.session;
  }

  async close(sessionId: string, reason?: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return false;
    }
    await entry.session.close(reason);
    this.sessions.delete(sessionId);
    return true;
  }

  clear(): void {
    this.sessions.clear();
  }
}

export const realtimeConversationSessions = new RealtimeConversationSessionRegistry();
