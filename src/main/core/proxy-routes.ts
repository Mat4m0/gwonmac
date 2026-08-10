/**
 * The five web-service hosts `gw://app` may proxy to, and the rules that stop a
 * response from leading anywhere else.
 *
 * The route set is closed and its keys are the type, so diagnostics can name a
 * failing route without introducing an open string. An unrecognised route fails
 * closed instead of being forwarded. A redirect is rewritten only if it stays
 * on the same allowlisted host over https, on the default port, with no
 * credentials in the URL; anything else is refused rather than followed. Cookie
 * headers are identified here so the proxy can drop them — login state belongs
 * in the native secret slots, never in Chromium's cookie store.
 *
 * These are web services. Game infrastructure is allowlisted separately in
 * `allowlists.ts`, and the two lists do not merge.
 */
import { AllowlistError } from "../../shared/errors.js";

export const PROXY_ROUTES = {
  webgate: "webgate.ncplatform.net",
  account: "account.arena.net",
  help: "help.guildwars.com",
  store: "store.guildwars.com",
  www: "www.guildwars.com",
} as const satisfies Readonly<Record<string, string>>;

/**
 * A five-key allowlist, so its keys belong in the type. Diagnostics records
 * which route failed, and `Record<string, string>` would have made that field
 * an open string.
 */
export type ProxyRoute = keyof typeof PROXY_ROUTES;

export function resolveProxyHost(route: string): string {
  const key = route.toLowerCase();
  if (!isProxyRoute(key)) {
    throw new AllowlistError(`unknown proxy route: ${route}`);
  }
  return PROXY_ROUTES[key];
}

/** Narrows an already-lower-cased path label. `resolveProxyHost` still folds
 *  case, so mixed-case routes keep resolving; only the narrowing needs the
 *  caller to have normalised, and it says so in the type rather than folding
 *  case here and claiming a narrowing it has not proved. */
export function isProxyRoute(route: string): route is ProxyRoute {
  return Object.hasOwn(PROXY_ROUTES, route);
}

export function isProxyFetchDestination(destination: string): boolean {
  return destination === "" || destination === "empty";
}

/** The game proxy is deliberately stateless; login state belongs in the two
 *  native secret slots, never Chromium's cookie store. */
export function isProxyCookieHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "cookie" || lower === "set-cookie";
}

export function rewriteProxyRedirect(
  route: string,
  location: string,
  upstream: string,
): string {
  const host = resolveProxyHost(route);
  let next: URL;
  try {
    next = new URL(location, upstream);
  } catch {
    throw new AllowlistError("invalid proxy redirect");
  }
  if (
    next.protocol !== "https:" ||
    next.hostname !== host ||
    (next.port !== "" && next.port !== "443") ||
    next.username ||
    next.password
  ) {
    throw new AllowlistError("proxy redirect escaped its allowlisted host");
  }
  return `gw://app/${route}${next.pathname}${next.search}`;
}

/**
 * Applies the response half of the stateless proxy boundary.
 *
 * `null` means a redirect tried to leave its exact allowlisted host. The main
 * handler owns the resulting diagnostic and 502 response; this function owns
 * only the deterministic header decision, including stripping every cookie
 * and upstream policy header before the custom scheme adds its own policy.
 */
export function proxyResponseHeaders(
  route: ProxyRoute,
  upstream: string,
  status: number,
  source: Headers,
): Headers | null {
  let safeLocation = "";
  if (status >= 300 && status < 400) {
    const location = source.get("location");
    if (location) {
      try {
        safeLocation = rewriteProxyRedirect(route, location, upstream);
      } catch {
        return null;
      }
    }
  }

  const output = new Headers();
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (isProxyCookieHeader(lower)) continue;
    if (
      lower === "content-security-policy"
      || lower === "content-security-policy-report-only"
      || lower === "x-content-type-options"
    ) {
      continue;
    }
    output.set(name, lower === "location" && safeLocation ? safeLocation : value);
  }
  return output;
}
