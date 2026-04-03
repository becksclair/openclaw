export {
  buildToolsEffectiveRequestKey,
  loadAgents,
  loadToolsCatalog,
  loadToolsEffective,
  refreshVisibleToolsEffectiveForCurrentSession,
  resetToolsEffectiveState,
  type AgentsState,
} from "../../../../packages/desktop-core/src/controllers/agents.ts";

import {
  loadAgents,
  type AgentsState,
} from "../../../../packages/desktop-core/src/controllers/agents.ts";
import { saveConfig } from "./config.ts";
import type { ConfigState } from "./config.ts";

export type AgentsConfigSaveState = AgentsState & ConfigState;

export async function saveAgentsConfig(state: AgentsConfigSaveState) {
  const selectedBefore = state.agentsSelectedId;
  await saveConfig(state);
  await loadAgents(state);
  if (selectedBefore && state.agentsList?.agents.some((entry) => entry.id === selectedBefore)) {
    state.agentsSelectedId = selectedBefore;
  }
}
