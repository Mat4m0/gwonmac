import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PROXY_ROUTES,
  resolveProxyRoute,
  rewriteProxyRedirect,
} from "../../src/main/core/proxy-routes.js";
import { AppError } from "../../src/shared/errors.js";

describe("proxy-routes", () => {
  it("maps the explicit ArenaNet/NCSoft routes", () => {
    assert.deepEqual(resolveProxyRoute("/webgate/session/create.xml"), {
      route: "webgate",
      host: "webgate.ncplatform.net",
      path: "/session/create.xml",
    });
    assert.equal(resolveProxyRoute("/account/login").host, "account.arena.net");
    assert.equal(resolveProxyRoute("/help/x").host, "help.guildwars.com");
    assert.equal(resolveProxyRoute("/store/y").host, "store.guildwars.com");
    assert.equal(resolveProxyRoute("/www/z").host, "www.guildwars.com");
  });

  it("preserves the path after the route segment", () => {
    const t = resolveProxyRoute("/webgate/session/create.xml");
    assert.equal(t.host, PROXY_ROUTES.webgate);
    assert.equal(t.path, "/session/create.xml");
  });

  it("names unknown routes instead of guessing", () => {
    assert.throws(() => resolveProxyRoute("/nosuchroute/x"), (e: unknown) => {
      assert.ok(e instanceof AppError);
      assert.equal(e.code, "unknown_proxy_route");
      assert.match(e.message, /nosuchroute/);
      return true;
    });
  });

  it("rejects paths that are not /route/rest", () => {
    assert.throws(() => resolveProxyRoute("/webgate"), AppError);
    assert.throws(() => resolveProxyRoute("webgate/x"), AppError);
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
});
