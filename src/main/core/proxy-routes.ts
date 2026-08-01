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
import { AppError, AllowlistError } from "../../shared/errors.js";

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

const ROUTE_RE = /^\/([a-z0-9][a-z0-9-]{0,30})(\/.*)$/i;

export interface ProxyTarget {
  route: string;
  host: string;
  path: string;
}

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

export function resolveProxyRoute(
  path: string,
  routes: Readonly<Record<string, string>> = PROXY_ROUTES,
): ProxyTarget {
  const m = ROUTE_RE.exec(path);
  if (!m) {
    throw new AppError("proxy_path", `not a proxy path: ${path}`);
  }
  const route = m[1]!;
  const rest = m[2]!;
  const host = routes[route.toLowerCase()];
  if (!host) {
    throw new AppError(
      "unknown_proxy_route",
      `unknown proxy route ${JSON.stringify(route)} — known: ${Object.keys(routes).sort().join(", ")}`,
    );
  }
  return { route: route.toLowerCase(), host, path: rest };
}
