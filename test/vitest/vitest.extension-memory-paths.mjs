export const memoryExtensionTestRoots = [
  "extensions/memory-core",
  "extensions/memory-lancedb",
  "extensions/memory-maintenance",
  "extensions/memory-wiki",
];

export function isMemoryExtensionRoot(root) {
  return memoryExtensionTestRoots.includes(root);
}
