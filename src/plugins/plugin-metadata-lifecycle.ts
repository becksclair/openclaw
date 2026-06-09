/** Coordinates plugin metadata snapshot and process memo cache lifecycle resets. */
import { clearCurrentPluginMetadataSnapshotState } from "./current-plugin-metadata-state.js";

const pluginMetadataLifecycleCacheClearers = new Set<() => void>();

/** Registers a process-local plugin metadata memo clear hook. */
export function registerPluginMetadataProcessMemoLifecycleClear(
  clearProcessMemo: () => void,
): () => void {
  pluginMetadataLifecycleCacheClearers.add(clearProcessMemo);
  return () => {
    pluginMetadataLifecycleCacheClearers.delete(clearProcessMemo);
  };
}

/** Clears plugin metadata snapshots and registered process memo caches. */
export function clearPluginMetadataLifecycleCaches(): void {
  clearCurrentPluginMetadataSnapshotState();
  for (const clearProcessMemo of pluginMetadataLifecycleCacheClearers) {
    clearProcessMemo();
  }
}
