const TRUSTED_PATHS = new Set(["/", "/index.html"]);

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
    if (entries.length !== 1) return false;
    const [name, value] = entries[0]!;
    return name === "toolbox-automation" && value === "1";
  } catch {
    return false;
  }
}
