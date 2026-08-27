/** The one copy filter used by Forge and the packaged-app inventory proof. */
export function ignorePackageFile(file: string): boolean {
  if (!file || file === "/") return false;
  const p = file.startsWith("/") ? file : `/${file}`;
  if (p === "/package.json") return false;
  // The main process imports the production WebSocket client at runtime.
  // Forge can classify `ws` as a production module only after node_modules is
  // admitted to the copy walk, and the project filter must admit its files.
  if (
    p === "/node_modules"
    || p === "/node_modules/ws"
    || p.startsWith("/node_modules/ws/")
  ) return false;
  if (p === "/build" || p === "/build/main" || p === "/build/shared") {
    return false;
  }
  if (p.startsWith("/build/main/") || p.startsWith("/build/shared/")) {
    return p.endsWith(".map") || p.endsWith(".d.ts") || p.endsWith(".d.ts.map");
  }
  if (p === "/build/renderer") return false;
  if (p.startsWith("/build/renderer/")) {
    return p.endsWith(".map") || p.endsWith(".d.ts");
  }
  if (
    p === "/build/preload"
    || p === "/build/preload/preload-core.cjs"
    || p === "/build/preload/preload-tools.cjs"
  ) return false;
  if (
    p === "/build/native"
    || p === "/build/native/host.node"
    || p === "/build/native/gw-dat-decode"
  ) {
    return false;
  }
  return true;
}
