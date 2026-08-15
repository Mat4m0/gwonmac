/**
 * What counts as the game renderer document: two paths under `gw://app`, with no
 * port, credentials, query or fragment.
 *
 * Callers decide from this whether a navigation is the application itself, so
 * it answers yes or no and never repairs a URL into an acceptable one. There is
 * nothing to allow in a query string — launch configuration reaches the
 * renderer through `RENDERER_INIT_ARGUMENT`, which is what keeps this boundary
 * from having to know what any individual setting means.
 */
const TRUSTED_PATHS = new Set(["/", "/index.html"]);
const ACCOUNTS_PATH = "/accounts.html";

function trustedUrl(raw: string, paths: ReadonlySet<string>): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "gw:"
      && url.hostname === "app"
      && !url.port
      && !url.username
      && !url.password
      && !url.hash
      && !url.search
      && paths.has(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * The renderer document, and nothing else. There is no query string to
 * allow-list: launch configuration reaches the renderer through
 * `RENDERER_INIT_ARGUMENT`, so a security boundary no longer has to know what a
 * cursor preference is.
 */
export function isCanonicalRendererUrl(raw: string): boolean {
  return trustedUrl(raw, TRUSTED_PATHS);
}

/** The Hub document is separate so a game window can never navigate to it. */
export function isAccountsRendererUrl(raw: string): boolean {
  return trustedUrl(raw, new Set([ACCOUNTS_PATH]));
}
