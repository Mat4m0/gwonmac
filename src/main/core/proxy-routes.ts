import { AppError, AllowlistError } from "../../shared/errors.js";

export const PROXY_ROUTES: Readonly<Record<string, string>> = {
  webgate: "webgate.ncplatform.net",
  account: "account.arena.net",
  help: "help.guildwars.com",
  store: "store.guildwars.com",
  www: "www.guildwars.com",
};

const ROUTE_RE = /^\/([a-z0-9][a-z0-9-]{0,30})(\/.*)$/i;

export interface ProxyTarget {
  route: string;
  host: string;
  path: string;
}

export function resolveProxyHost(route: string): string {
  const host = PROXY_ROUTES[route.toLowerCase()];
  if (!host) throw new AllowlistError(`unknown proxy route: ${route}`);
  return host;
}

export function isProxyRoute(route: string): boolean {
  return Object.hasOwn(PROXY_ROUTES, route.toLowerCase());
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
