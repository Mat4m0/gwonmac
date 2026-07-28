import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthUrl,
  isAllowedOrigin,
  isRedirectTarget,
  newState,
  parseRedirect,
  STEAM_OAUTH,
  type SteamOAuthConfig,
} from "../../src/main/core/steam-oauth.js";

/**
 * A second, deliberately non-Steam configuration. Every helper takes its
 * config as a parameter (KTD7), and these tests prove that by asking the same
 * function two different questions — which is also what lets the acquisition
 * spec drive the real window against a local fixture server.
 */
const FIXTURE: SteamOAuthConfig = {
  clientId: "FIXTURE-ID",
  authorizationBaseUrl: "http://127.0.0.1:4999/authorize",
  redirectUrl: "https://return.example/app/live/auth",
  responseType: "token",
  allowedHostSuffixes: ["assets.example"],
};

describe("the Steam authorize URL", () => {
  it("carries the config read out of the official client", () => {
    const url = new URL(buildAuthUrl(STEAM_OAUTH, "nonce-123"));
    assert.equal(url.origin + url.pathname, STEAM_OAUTH.authorizationBaseUrl);
    assert.equal(url.searchParams.get("client_id"), "CE9BDCEC");
    assert.equal(url.searchParams.get("response_type"), "token");
    assert.equal(url.searchParams.get("redirect_uri"), STEAM_OAUTH.redirectUrl);
    assert.equal(url.searchParams.get("state"), "nonce-123");
  });

  it("is built from whichever config it is handed", () => {
    const url = new URL(buildAuthUrl(FIXTURE, "fixture-nonce"));
    assert.equal(url.origin + url.pathname, FIXTURE.authorizationBaseUrl);
    assert.equal(url.searchParams.get("client_id"), "FIXTURE-ID");
    assert.equal(url.searchParams.get("redirect_uri"), FIXTURE.redirectUrl);
    assert.equal(url.searchParams.get("state"), "fixture-nonce");
  });
});

describe("the sign-in origin allowlist", () => {
  it("admits the configured Steam-owned https hosts and their subdomains", () => {
    for (const ok of [
      "https://steamcommunity.com/oauth/login",
      "https://login.steampowered.com/jwt/ajaxcheckdevicetoken",
      "https://store.steampowered.com/login/",
      "https://community.cloudflare.steamstatic.com/public/style.css",
    ]) {
      assert.equal(isAllowedOrigin(STEAM_OAUTH, ok), true, ok);
    }
  });

  it("admits the configured authorize origin itself", () => {
    // The window has to be able to load the page it was opened at. For the
    // production config that origin is https and also suffix-matched; for a
    // fixture config it is the only thing this permits.
    assert.equal(isAllowedOrigin(STEAM_OAUTH, STEAM_OAUTH.authorizationBaseUrl), true);
    assert.equal(isAllowedOrigin(FIXTURE, FIXTURE.authorizationBaseUrl), true);
    assert.equal(isAllowedOrigin(FIXTURE, "http://127.0.0.1:4999/authorize?x=1"), true);
  });

  it("rejects non-Steam hosts, plaintext, and suffix look-alikes", () => {
    for (const bad of [
      "https://evil.example/steal",
      "http://steamcommunity.com/oauth/login", // not https
      "https://steamcommunity.com.evil.example/", // suffix trick
      "https://notsteampowered.com/", // bare substring, not a subdomain
      "https://steampowered.com.attacker.net/",
      "https://user:pass@steamcommunity.com/", // embedded credentials
      "https://steamcommunity.com:8443/oauth/login", // off-port
      // A nested-origin scheme reports the origin it wraps, so `URL.origin`
      // alone would call this the authorize origin and skip the https check.
      "blob:https://steamcommunity.com/8f2a-uuid",
      "blob:https://login.steampowered.com/x",
      "not a url",
      "",
    ]) {
      assert.equal(isAllowedOrigin(STEAM_OAUTH, bad), false, bad);
    }
  });

  it("rejects a trailing-dot host rather than resolving it to the same name", () => {
    // `steamcommunity.com.` is the absolute-FQDN spelling of an allowed host,
    // and `allowedName` in src/main/core/allowlists.ts *does* admit it — it
    // strips the trailing dot before matching. This check deliberately does
    // not, and does not delegate to that helper: widening a sign-in allowlist
    // to a second spelling buys nothing (Steam never emits one) and the
    // fail-closed direction is the safe one to be wrong in. Pinned so the
    // difference between the two helpers is a decision, not a surprise.
    assert.equal(isAllowedOrigin(STEAM_OAUTH, "https://steamcommunity.com./oauth/login"), false);
    assert.equal(isAllowedOrigin(STEAM_OAUTH, "https://store.steampowered.com./"), false);
  });

  it("answers from the config it is given, not a module-level list", () => {
    // The fixture config knows nothing about Steam, and the production config
    // knows nothing about the fixture's asset host.
    assert.equal(isAllowedOrigin(FIXTURE, "https://steamcommunity.com/oauth/login"), false);
    assert.equal(isAllowedOrigin(FIXTURE, "https://assets.example/style.css"), true);
    assert.equal(isAllowedOrigin(STEAM_OAUTH, "https://assets.example/style.css"), false);
    assert.equal(isAllowedOrigin(STEAM_OAUTH, "http://127.0.0.1:4999/authorize"), false);
  });
});

describe("the redirect target", () => {
  it("matches only the exact configured return host and path", () => {
    assert.equal(
      isRedirectTarget(
        STEAM_OAUTH,
        "https://www.guildwars.com/app/live/auth#access_token=x&state=y",
      ),
      true,
    );
    assert.equal(
      isRedirectTarget(STEAM_OAUTH, "https://www.guildwars.com/app/live/auth?access_token=x"),
      true,
    );
    assert.equal(
      isRedirectTarget(FIXTURE, "https://return.example/app/live/auth#access_token=x"),
      true,
    );
  });

  it("does not match a different path, host, or scheme", () => {
    for (const bad of [
      "https://www.guildwars.com/app/live/auth/evil",
      "https://www.guildwars.com/app/live/authorize",
      "https://evil.example/app/live/auth",
      "http://www.guildwars.com/app/live/auth",
      "https://return.example/app/live/auth", // the *fixture's* return URL
      // Same name, different port is a different service, and it must not be
      // trusted to supply the state-matching response.
      "https://www.guildwars.com:8443/app/live/auth",
      "not a url",
    ]) {
      assert.equal(isRedirectTarget(STEAM_OAUTH, bad), false, bad);
    }
  });
});

describe("reading the token back", () => {
  const STATE = "the-generated-nonce";
  const RETURN = "https://www.guildwars.com/app/live/auth";

  it("accepts a fragment token whose state matches", () => {
    const r = parseRedirect(
      `${RETURN}#access_token=abc123&state=${STATE}&token_type=bearer`,
      STATE,
    );
    assert.deepEqual(r, { ok: true, token: "abc123" });
  });

  it("accepts a query token as well as a fragment token", () => {
    const r = parseRedirect(`${RETURN}?access_token=q99&state=${STATE}`, STATE);
    assert.deepEqual(r, { ok: true, token: "q99" });
  });

  it("accepts a bare `token` key as well as `access_token`", () => {
    // Both spellings are read, fragment first. Untested, a typo or wrong
    // precedence here would only surface against a live server that happens to
    // use the alternate name.
    assert.deepEqual(parseRedirect(`${RETURN}#token=abc123&state=${STATE}`, STATE), {
      ok: true,
      token: "abc123",
    });
    assert.deepEqual(parseRedirect(`${RETURN}?token=q99&state=${STATE}`, STATE), {
      ok: true,
      token: "q99",
    });
  });

  it("prefers access_token when a response carries both", () => {
    assert.deepEqual(
      parseRedirect(`${RETURN}#access_token=primary&token=secondary&state=${STATE}`, STATE),
      { ok: true, token: "primary" },
    );
  });

  it("rejects a response whose state does not match the attempt", () => {
    // AE10 / R17: an unsolicited or replayed response fails before the token
    // is read, so a token that arrives unasked-for is never trusted.
    const r = parseRedirect(`${RETURN}#access_token=abc123&state=someone-elses`, STATE);
    assert.deepEqual(r, { ok: false, reason: "state-mismatch" });
  });

  it("rejects a response carrying no state at all", () => {
    const r = parseRedirect(`${RETURN}#access_token=abc123`, STATE);
    assert.deepEqual(r, { ok: false, reason: "state-mismatch" });
  });

  it("rejects a matching-state response that carries no token", () => {
    const r = parseRedirect(`${RETURN}#state=${STATE}`, STATE);
    assert.deepEqual(r, { ok: false, reason: "no-token" });
  });

  it("rejects a matching-state response whose token is empty", () => {
    const r = parseRedirect(`${RETURN}#access_token=&state=${STATE}`, STATE);
    assert.deepEqual(r, { ok: false, reason: "no-token" });
  });

  it("rejects something that is not a URL", () => {
    assert.deepEqual(parseRedirect("not a url", STATE), {
      ok: false,
      reason: "state-mismatch",
    });
  });
});

describe("the state nonce", () => {
  it("is unguessable and fresh per attempt", () => {
    const a = newState();
    const b = newState();
    assert.notEqual(a, b);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
