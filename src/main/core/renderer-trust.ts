const TRUSTED_PATHS = new Set(["/", "/index.html"]);
const TRUSTED_RENDERER_PARAMETERS = new Set([
  "toolbox-automation",
  "native-cursor",
  "template-fs-trace",
]);

export function isCanonicalRendererUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "gw:"
      || url.hostname !== "app"
      || url.port
      || url.username
      || url.password
      || url.hash
      || !TRUSTED_PATHS.has(url.pathname)
    ) {
      return false;
    }

    const entries = [...url.searchParams.entries()];
    if (entries.length === 0) return true;
    if (entries.length > TRUSTED_RENDERER_PARAMETERS.size) return false;
    const names = new Set<string>();
    for (const [name, value] of entries) {
      if (
        value !== "1"
        || !TRUSTED_RENDERER_PARAMETERS.has(name)
        || names.has(name)
      ) {
        return false;
      }
      names.add(name);
    }
    return true;
  } catch {
    return false;
  }
}
