/** The one copy filter used by Forge and the packaged-app inventory proof. */
export function ignorePackageFile(file: string): boolean {
  if (!file || file === "/") return false;
  const p = file.startsWith("/") ? file : `/${file}`;
  if (p === "/package.json") return false;
  if (p === "/build" || p === "/build/main" || p === "/build/shared") {
    return false;
  }
  if (p.startsWith("/build/main/") || p.startsWith("/build/shared/")) {
    return p.endsWith(".map") || p.endsWith(".d.ts") || p.endsWith(".d.ts.map");
  }
  if (p === "/build/renderer") return false;
  if (p.startsWith("/build/renderer/")) return p.endsWith(".d.ts");
  if (p === "/build/preload" || p === "/build/preload/preload.cjs") return false;
  if (
    p === "/build/native"
    || p === "/build/native/keychain.node"
    || p === "/build/native/gw-dat-decode"
  ) {
    return false;
  }
  return true;
}
