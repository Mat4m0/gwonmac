const TRUSTED_PATHS = new Set(["/", "/index.html"]);

/**
 * The renderer document, and nothing else. There is no query string to
 * allow-list: launch configuration reaches the renderer through
 * `RENDERER_INIT_ARGUMENT`, so a security boundary no longer has to know what a
 * cursor preference is.
 */
function isCanonicalRendererUrlFor(raw: string, hostname: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "gw:"
      && url.hostname === hostname
      && !url.port
      && !url.username
      && !url.password
      && !url.hash
      && !url.search
      && TRUSTED_PATHS.has(url.pathname)
    );
  } catch {
    return false;
  }
}

export function isCanonicalRendererUrl(raw: string): boolean {
  return isCanonicalRendererUrlFor(raw, "app");
}

export function isCanonicalControlRendererUrl(raw: string): boolean {
  return isCanonicalRendererUrlFor(raw, "control");
}
