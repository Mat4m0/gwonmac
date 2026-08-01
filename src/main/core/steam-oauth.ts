/**
 * The Steam sign-in flow as data and pure predicates: the authorize URL, the
 * set of URLs the window may load, and the one redirect that ends an attempt.
 *
 * Nothing here opens a window, stores a token, or imports Electron. That is
 * what lets the same rules run offline against a fixture server, so every
 * decision this file makes is testable without a live Steam account.
 *
 * Both predicates fail closed and neither repairs its input. Recognising the
 * redirect and extracting the token are deliberately one operation, so no
 * caller can accept a matching nonce that arrived from the wrong host, port,
 * scheme or path.
 */
import { randomUUID } from "node:crypto";

/**
 * Everything the Steam sign-in flow needs to know, as data.
 *
 * Held as a parameter rather than read off the module so the whole flow — the
 * authorize URL, the origin allowlist, and the redirect matcher — can be
 * pointed at a local fixture server in tests. That is the only way to cover
 * acquisition offline, and it costs nothing in production: `STEAM_OAUTH` below
 * is the one config the app ever passes.
 */
export interface SteamOAuthConfig {
  clientId: string;
  authorizationBaseUrl: string;
  redirectUrl: string;
  responseType: string;
  /**
   * Apex domains the sign-in window may load, matched as the host itself or
   * any subdomain of it. The configured authorize origin is always permitted
   * on top of these, so a config never has to name its own host twice.
   */
  allowedHostSuffixes: readonly string[];
}

/**
 * The Steam sign-in parameters, read verbatim out of the official client's
 * bundled configuration (Guild Wars Reforged, Capacitor/Auth Connect):
 *
 *   oauth2.Steam = { clientId, authorizationBaseUrl, redirectUrl, responseType: "token" }
 *
 * The credential this yields is a Steam OAuth2 access token. There is no
 * separate ArenaNet issuance step: the token the login exchange replays in
 * `<PasswordToken>` is exactly what Steam returns here. The account service
 * validates it and maps it to the linked Guild Wars account at `login.xml`.
 *
 * The exact wire shape of the authorize request lives in Auth Connect's native
 * code, which is compiled and could not be read statically, so this is a
 * standard OAuth2 implicit-flow request built from the known config.
 *
 * The host suffixes are broader than the login page alone on purpose: Steam's
 * login renders assets from its CDNs and may bounce through its own auth
 * hosts, and a window that renders broken because a stylesheet was blocked is
 * not a working sign-in. Every entry is still a Steam- or Valve-owned apex.
 */
export const STEAM_OAUTH = {
  clientId: "CE9BDCEC",
  authorizationBaseUrl: "https://steamcommunity.com/oauth/login",
  redirectUrl: "https://www.guildwars.com/app/live/auth",
  responseType: "token",
  allowedHostSuffixes: [
    "steamcommunity.com",
    "steampowered.com",
    "steamstatic.com",
    "valvesoftware.com",
  ],
} as const satisfies SteamOAuthConfig;

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

/**
 * Whether the sign-in window may load this URL. Fail-closed: anything this
 * does not recognise is blocked.
 *
 * Two ways in, and no others. A suffix match must be https on the default
 * port with no embedded credentials — the posture `rewriteProxyRedirect` holds
 * the proxy to. An exact match on the configured authorize origin is also
 * allowed, because the window has to be able to load the page it was opened
 * at; for the production config that origin is https and suffix-matched
 * anyway, so this branch only ever widens a config that deliberately points
 * somewhere else.
 */
export function isAllowedOrigin(config: SteamOAuthConfig, rawUrl: string): boolean {
  const u = parseUrl(rawUrl);
  if (!u) return false;
  // Before either branch: `URL.origin` drops embedded credentials, so a
  // `user:pass@` URL would otherwise match the authorize origin exactly and
  // walk straight in.
  if (u.username || u.password) return false;
  const authorize = parseUrl(config.authorizationBaseUrl);
  // Scheme and host, not `origin`. A nested-origin scheme reports the origin it
  // wraps — `new URL("blob:https://steamcommunity.com/x").origin` is
  // `https://steamcommunity.com` — so comparing origins would admit a `blob:`
  // URL and skip the https requirement below it entirely.
  if (
    authorize &&
    u.protocol === authorize.protocol &&
    u.host === authorize.host
  ) {
    return true;
  }
  if (u.protocol !== "https:") return false;
  if (u.port !== "" && u.port !== "443") return false;
  const host = u.hostname.toLowerCase();
  return config.allowedHostSuffixes.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/** A fresh, unguessable nonce for one sign-in attempt. */
export function newState(): string {
  return randomUUID();
}

export function buildAuthUrl(config: SteamOAuthConfig, state: string): string {
  const u = new URL(config.authorizationBaseUrl);
  u.searchParams.set("response_type", config.responseType);
  u.searchParams.set("client_id", config.clientId);
  u.searchParams.set("redirect_uri", config.redirectUrl);
  u.searchParams.set("state", state);
  return u.toString();
}

export type SteamRedirectResult =
  | { ok: true; token: string }
  | { ok: false; reason: "no-token" | "state-mismatch" };

export type SteamRedirectInspection =
  | { kind: "not-redirect" }
  | { kind: "redirect"; result: SteamRedirectResult };

/**
 * Recognise the configured OAuth redirect and extract its token only when the
 * `state` generated for this attempt comes back unchanged.
 *
 * An implicit flow returns the token in the fragment; some servers use the
 * query, so both are read, fragment first. The `state` is checked before any
 * token is looked at. Target recognition and token parsing are deliberately
 * one operation so no caller can accept a matching nonce from the wrong host,
 * port, scheme, or path.
 */
export function inspectRedirect(
  config: SteamOAuthConfig,
  rawUrl: string,
  expectedState: string,
): SteamRedirectInspection {
  const u = parseUrl(rawUrl);
  const target = parseUrl(config.redirectUrl);
  if (
    !u ||
    !target ||
    u.username ||
    u.password ||
    u.protocol !== "https:" ||
    target.protocol !== "https:" ||
    u.host.toLowerCase() !== target.host.toLowerCase() ||
    u.pathname !== target.pathname
  ) {
    return { kind: "not-redirect" };
  }

  const fragment = new URLSearchParams(u.hash.replace(/^#/, ""));
  const carrier =
    fragment.has("access_token") || fragment.has("token") || fragment.has("state")
      ? fragment
      : u.searchParams;
  if (carrier.get("state") !== expectedState) {
    return {
      kind: "redirect",
      result: { ok: false, reason: "state-mismatch" },
    };
  }
  const token = carrier.get("access_token") ?? carrier.get("token");
  if (!token) {
    return { kind: "redirect", result: { ok: false, reason: "no-token" } };
  }
  return { kind: "redirect", result: { ok: true, token } };
}
