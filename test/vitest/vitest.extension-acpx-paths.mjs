export const acpxExtensionTestRoots = ["extensions/acpx", "extensions/acpx-remote"];

export function isAcpxExtensionRoot(root) {
  return acpxExtensionTestRoots.includes(root);
}
