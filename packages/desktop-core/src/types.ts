import type {
  GatewayAgentRow as SharedGatewayAgentRow,
  SessionsListResultBase,
} from "../../../src/shared/session-types.js";

export type GatewaySessionsDefaults = {
  modelProvider: string | null;
  model: string | null;
  contextTokens: number | null;
};

export type GatewayAgentRow = SharedGatewayAgentRow;

export type AgentsListResult = {
  defaultId: string;
  mainKey: string;
  scope: string;
  agents: GatewayAgentRow[];
};

export type GatewaySessionRow = {
  key: string;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
};

export type SessionsListResult = SessionsListResultBase<GatewaySessionsDefaults, GatewaySessionRow>;

export type ModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image" | "document">;
};

export type ToolCatalogProfile =
  import("../../../src/gateway/protocol/schema/types.js").ToolCatalogProfile;
export type ToolCatalogEntry =
  import("../../../src/gateway/protocol/schema/types.js").ToolCatalogEntry;
export type ToolCatalogGroup =
  import("../../../src/gateway/protocol/schema/types.js").ToolCatalogGroup;
export type ToolsCatalogResult =
  import("../../../src/gateway/protocol/schema/types.js").ToolsCatalogResult;
export type ToolsEffectiveEntry =
  import("../../../src/gateway/protocol/schema/types.js").ToolsEffectiveEntry;
export type ToolsEffectiveGroup =
  import("../../../src/gateway/protocol/schema/types.js").ToolsEffectiveGroup;
export type ToolsEffectiveResult =
  import("../../../src/gateway/protocol/schema/types.js").ToolsEffectiveResult;
