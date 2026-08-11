/**
 * The closed route labels shared by ArenaNet's glue and the native proxy.
 * This is the only source allowed to decide which first-label route exists.
 */
export const PROXY_ROUTE_NAMES = [
  "webgate",
  "account",
  "help",
  "store",
  "www",
] as const;

export type ProxyRouteName = (typeof PROXY_ROUTE_NAMES)[number];

/** Narrows a lower-cased URL label to the closed proxy vocabulary. */
export function isProxyRouteName(route: string): route is ProxyRouteName {
  return PROXY_ROUTE_NAMES.some((name) => name === route);
}
