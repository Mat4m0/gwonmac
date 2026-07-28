// Drives the real acquisition window against a local fixture server: a genuine
// BrowserWindow, a genuine OAuth-shaped 302 chain, a genuine redirect
// interception. No network, no Steam, no token that ever existed.
//
// The whole flow is reachable offline because every Steam-specific value is
// configuration (KTD7): point `authorizationBaseUrl` at 127.0.0.1 and the
// window, the origin allowlist, and the redirect matcher all follow.
import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  closeOffline,
  launchOffline,
  root,
  type OfflineFixture,
} from "./fixtures.mts";
import type { SteamOAuthConfig } from "../../src/main/core/steam-oauth.js";

const MODULE_PATH = path.join(root, "build/main/steam-acquire.js");

/** Never a real token: 32 hex characters that were typed here, not issued. */
const TOKEN = "0123456789abcdef0123456789abcdef";

/**
 * The return URL is deliberately unresolvable. `.test` is reserved and never
 * resolves, so if the redirect were ever actually fetched instead of
 * intercepted, these tests would fail loudly rather than quietly reach out.
 */
const RETURN_URL = "https://www.guildwars.test/app/live/auth";

type FixtureMode = "redirect" | "wrong-state" | "no-token" | "hang" | "escape";

interface Hit {
  path: string;
  cookie: string | undefined;
}

interface Fixture {
  readonly origin: string;
  readonly hits: Hit[];
  close(): Promise<void>;
}

async function startFixture(mode: FixtureMode): Promise<Fixture> {
  const hits: Hit[] = [];
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    hits.push({ path: url.pathname, cookie: request.headers.cookie });
    const nonce = url.searchParams.get("state") ?? "";

    if (url.pathname === "/authorize") {
      // A second same-origin hop, so a cookie set here is offered back on the
      // next request — which is what makes the partition assertion meaningful.
      if (mode === "hang" || mode === "escape") {
        const body =
          mode === "hang"
            ? "<title>fixture</title>waiting"
            : `<title>fixture</title><script>location.href="https://evil.example/";</script>`;
        response.writeHead(200, { "content-type": "text/html" });
        response.end(body);
        return;
      }
      response.writeHead(302, {
        "set-cookie": "gwfixture=1; Path=/",
        location: `/second?state=${encodeURIComponent(nonce)}`,
      });
      response.end();
      return;
    }

    if (url.pathname === "/second") {
      const fragment =
        mode === "wrong-state"
          ? `#access_token=${TOKEN}&state=not-the-nonce-we-generated`
          : mode === "no-token"
            ? `#state=${encodeURIComponent(nonce)}`
            : `#access_token=${TOKEN}&state=${encodeURIComponent(nonce)}`;
      response.writeHead(302, { location: `${RETURN_URL}${fragment}` });
      response.end();
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function configFor(fixture: Fixture): SteamOAuthConfig {
  return {
    clientId: "FIXTURE-CLIENT",
    authorizationBaseUrl: `${fixture.origin}/authorize`,
    redirectUrl: RETURN_URL,
    responseType: "token",
    // Nothing Steam-owned is reachable offline; the authorize origin is the
    // only thing this config permits, which is exactly the point.
    allowedHostSuffixes: [],
  };
}

interface AcquireRun {
  result:
    | { ok: true; token: string }
    | { ok: false; reason: "cancelled" | "state-mismatch" | "no-token" | "failed" };
  events: { k: string; what?: string; outcome?: string }[];
}

/** Start acquisition in main and leave it running, so a test can interact. */
async function beginAcquire(
  app: OfflineFixture["app"],
  config: SteamOAuthConfig,
): Promise<void> {
  await app.evaluate(async (_electron, arg) => {
    // Playwright evaluates this body with `eval`, which has no dynamic-import
    // callback, so `import()` is unavailable here. `createRequire` reaches the
    // same compiled module (Node's require-of-ESM handles it: no top-level
    // await anywhere in this graph) and keeps the test hook entirely inside the
    // test -- production source carries no affordance for being poked at.
    const { createRequire } = process.getBuiltinModule("module");
    const load = createRequire(arg.modulePath);
    const { acquireSteamToken } = load(arg.modulePath) as {
      acquireSteamToken: (config: unknown, options: unknown) => Promise<unknown>;
    };
    const scope = globalThis as unknown as {
      __steamEvents: unknown[];
      __steamRun: Promise<unknown>;
    };
    scope.__steamEvents = [];
    scope.__steamRun = acquireSteamToken(arg.config, {
      record: (event: unknown) => scope.__steamEvents.push(event),
    });
  }, { modulePath: MODULE_PATH, config });
}

async function settleAcquire(app: OfflineFixture["app"]): Promise<AcquireRun> {
  return (await app.evaluate(async () => {
    const scope = globalThis as unknown as {
      __steamEvents: unknown[];
      __steamRun: Promise<unknown>;
    };
    return { result: await scope.__steamRun, events: scope.__steamEvents };
  })) as AcquireRun;
}

async function acquire(
  app: OfflineFixture["app"],
  config: SteamOAuthConfig,
): Promise<AcquireRun> {
  await beginAcquire(app, config);
  return settleAcquire(app);
}

/** How many windows exist, so teardown can be observed rather than assumed. */
async function windowCount(app: OfflineFixture["app"]): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

/** Windows currently showing the fixture server, identified by URL. */
async function signInWindows(app: OfflineFixture["app"]): Promise<number> {
  return app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((win) =>
        win.webContents.getURL().includes("127.0.0.1"),
      ).length,
  );
}

/**
 * Wait for the sign-in window's navigation to actually commit. Polling the
 * window *count* is not enough: `getURL()` is empty until then, so a close that
 * raced ahead of the commit would find nothing to destroy and the acquisition
 * would never settle.
 */
async function waitForSignInWindow(app: OfflineFixture["app"]): Promise<void> {
  await expect.poll(() => signInWindows(app), { timeout: 15_000 }).toBe(1);
}

async function closeSignInWindow(app: OfflineFixture["app"]): Promise<void> {
  const destroyed = await app.evaluate(({ BrowserWindow }) => {
    let count = 0;
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.getURL().includes("127.0.0.1")) {
        win.destroy();
        count += 1;
      }
    }
    return count;
  });
  expect(destroyed).toBe(1);
}

test.describe("acquiring a Steam token", () => {
  let fixture: OfflineFixture;
  let server: Fixture;

  test.afterEach(async () => {
    if (fixture) await closeOffline(fixture);
    if (server) await server.close();
  });

  test("lifts the token out of the redirect and tears the window down", async () => {
    // Covers AE2.
    server = await startFixture("redirect");
    fixture = await launchOffline("gw-steam-acquire-ok-");
    const before = await windowCount(fixture.app);

    const run = await acquire(fixture.app, configFor(server));

    expect(run.result).toEqual({ ok: true, token: TOKEN });
    expect(run.events.map((event) => event.k)).toContain("opened");
    expect(run.events.at(-1)).toEqual({ k: "settled", outcome: "success" });
    // The return URL was never fetched -- it does not resolve, and the fixture
    // only ever saw the two hops it serves itself.
    expect(server.hits.map((hit) => hit.path)).toEqual(["/authorize", "/second"]);
    expect(await windowCount(fixture.app)).toBe(before);
  });

  test("refuses a response whose state it did not generate", async () => {
    // Covers AE10.
    server = await startFixture("wrong-state");
    fixture = await launchOffline("gw-steam-acquire-state-");
    const before = await windowCount(fixture.app);

    const run = await acquire(fixture.app, configFor(server));

    expect(run.result).toEqual({ ok: false, reason: "state-mismatch" });
    expect(run.events.at(-1)).toEqual({ k: "settled", outcome: "state-mismatch" });
    expect(await windowCount(fixture.app)).toBe(before);
  });

  test("reports a redirect that carries no token", async () => {
    server = await startFixture("no-token");
    fixture = await launchOffline("gw-steam-acquire-no-token-");

    const run = await acquire(fixture.app, configFor(server));

    expect(run.result).toEqual({ ok: false, reason: "no-token" });
    expect(run.events.at(-1)).toEqual({ k: "settled", outcome: "no-token" });
  });

  test("treats a closed window as a cancelled sign-in", async () => {
    // Covers AE3: the credential request must resolve, not hang, when the
    // player gives up -- otherwise the client's login screen stalls forever.
    server = await startFixture("hang");
    fixture = await launchOffline("gw-steam-acquire-cancel-");
    const before = await windowCount(fixture.app);

    await beginAcquire(fixture.app, configFor(server));
    await waitForSignInWindow(fixture.app);
    await closeSignInWindow(fixture.app);
    const run = await settleAcquire(fixture.app);

    expect(run.result).toEqual({ ok: false, reason: "cancelled" });
    expect(run.events.at(-1)).toEqual({ k: "settled", outcome: "cancelled" });
    expect(await windowCount(fixture.app)).toBe(before);
  });

  test("blocks a navigation that leaves the configured origins", async () => {
    server = await startFixture("escape");
    fixture = await launchOffline("gw-steam-acquire-escape-");

    await beginAcquire(fixture.app, configFor(server));
    await waitForSignInWindow(fixture.app);
    await expect
      .poll(
        async () =>
          (
            await fixture.app.evaluate(() => {
              const scope = globalThis as unknown as { __steamEvents: { k: string }[] };
              return scope.__steamEvents;
            })
          ).some((event) => event.k === "blocked"),
        { timeout: 15_000 },
      )
      .toBe(true);
    await closeSignInWindow(fixture.app);
    const run = await settleAcquire(fixture.app);

    expect(run.events).toContainEqual({ k: "blocked", what: "navigation" });
    expect(run.result).toEqual({ ok: false, reason: "cancelled" });
  });

  test("leaves no cookie behind for the next sign-in", async () => {
    // R19: the partition dies with the window. The fixture sets a cookie on the
    // first hop and offers proof it works by seeing it returned on the second --
    // so a second acquisition arriving cookie-less is a real observation, not a
    // server that never set one.
    server = await startFixture("redirect");
    fixture = await launchOffline("gw-steam-acquire-partition-");
    const config = configFor(server);

    const first = await acquire(fixture.app, config);
    expect(first.result).toEqual({ ok: true, token: TOKEN });
    expect(server.hits).toEqual([
      { path: "/authorize", cookie: undefined },
      { path: "/second", cookie: "gwfixture=1" },
    ]);

    server.hits.length = 0;
    const second = await acquire(fixture.app, config);
    expect(second.result).toEqual({ ok: true, token: TOKEN });
    expect(server.hits[0]).toEqual({ path: "/authorize", cookie: undefined });
  });
});
