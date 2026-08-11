import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isProxyCookieHeader,
  isProxyFetchDestination,
  PROXY_ROUTES,
  proxyResponseHeaders,
  resolveProxyHost,
  rewriteProxyRedirect,
} from "../../src/main/core/proxy-routes.js";

describe("proxy-routes", () => {
  it("maps only the explicit ArenaNet/NCSoft route labels", () => {
    for (const [route, host] of Object.entries(PROXY_ROUTES)) {
      assert.equal(resolveProxyHost(route), host);
      assert.equal(resolveProxyHost(route.toUpperCase()), host);
    }
    assert.throws(() => resolveProxyHost("nosuchroute"), /unknown proxy route/);
  });

  it("keeps redirects inside the custom protocol and exact upstream host", () => {
    const upstream = "https://account.arena.net/login";
    assert.equal(
      rewriteProxyRedirect("account", "/next?ticket=1", upstream),
      "gw://app/account/next?ticket=1",
    );
    for (const location of [
      "https://evil.invalid/next",
      "http://account.arena.net/next",
      "https://account.arena.net:444/next",
      "https://user:pass@account.arena.net/next",
      "https://account.arena.net.evil.invalid/next",
    ]) {
      assert.throws(() => rewriteProxyRedirect("account", location, upstream));
    }
  });

  it("applies redirect and stateless-header policy as one response boundary", () => {
    const source = new Headers({
      "Content-Security-Policy": "default-src *",
      "Content-Type": "application/xml",
      Location: "/next?ticket=1",
      "Set-Cookie": "session=secret",
      "X-Content-Type-Options": "unsafe",
    });
    const safe = proxyResponseHeaders(
      "account",
      "https://account.arena.net/login",
      302,
      source,
    );
    assert.ok(safe);
    assert.equal(safe.get("location"), "gw://app/account/next?ticket=1");
    assert.equal(safe.get("content-type"), "application/xml");
    assert.equal(safe.get("set-cookie"), null);
    assert.equal(safe.get("content-security-policy"), null);
    assert.equal(safe.get("x-content-type-options"), null);
    assert.equal(
      proxyResponseHeaders(
        "account",
        "https://account.arena.net/login",
        302,
        new Headers({ Location: "https://attacker.invalid/steal" }),
      ),
      null,
    );
  });

  it("permits proxy routes only for fetch/XHR destinations", () => {
    assert.equal(isProxyFetchDestination(""), true);
    assert.equal(isProxyFetchDestination("empty"), true);
    for (const destination of [
      "document",
      "iframe",
      "frame",
      "script",
      "style",
      "worker",
      "sharedworker",
      "serviceworker",
      "manifest",
      "object",
      "embed",
    ]) {
      assert.equal(isProxyFetchDestination(destination), false, destination);
    }
  });

  it("keeps the proxy stateless in both directions", () => {
    assert.equal(isProxyCookieHeader("Cookie"), true);
    assert.equal(isProxyCookieHeader("set-cookie"), true);
    assert.equal(isProxyCookieHeader("Set-Cookie"), true);
    assert.equal(isProxyCookieHeader("Authorization"), false);
  });
});
