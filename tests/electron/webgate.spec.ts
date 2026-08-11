// One composed proof for the game's stateless WebGate transport. The fixture
// replaces Chromium's built-in HTTPS handler inside the launched Electron
// session, so requests still enter through the production gw:// handler and
// production net.fetch without opening a socket or reaching ArenaNet.
import { expect, test } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { closeOffline, launchOffline, root } from "./fixtures.mjs";

const REQUEST_SECRET = "WEBGATE_REQUEST_CANARY_7b7137";
const COOKIE_SECRET = "WEBGATE_COOKIE_CANARY_d8f42d";
const RESPONSE_SECRET = "WEBGATE_RESPONSE_CANARY_294a51";
const DIAGNOSTICS_MODULE = path.join(root, "build/main/diagnostics.js");
const MAX_PROXY_BODY_BYTES = 8 * 1024 * 1024;

interface FixtureHit {
  readonly body: string;
  readonly cookie: string | null;
  readonly method: string;
  readonly path: string;
  readonly query: string;
}

test.describe("stateless WebGate proxy", () => {
  test("completes the bounded login exchange without browser auth state", async () => {
    const fixture = await launchOffline("gw-webgate-e2e-");
    try {
      await fixture.app.evaluate(async ({ session }, args) => {
        const scope = globalThis as typeof globalThis & {
          __webGateFixtureHits?: FixtureHit[];
        };
        scope.__webGateFixtureHits = [];

        // Plant state that Chromium would attach if the proxy relied only on
        // deleting the renderer's Cookie header. Production must ignore it.
        await session.defaultSession.cookies.set({
          url: "https://webgate.ncplatform.net/",
          name: "preexisting",
          value: args.cookieSecret,
          path: "/",
          secure: true,
          httpOnly: true,
        });

        await session.defaultSession.protocol.handle("https", async (request) => {
          const url = new URL(request.url);
          if (url.hostname !== "webgate.ncplatform.net") {
            return new Response("fixture refused host", { status: 502 });
          }
          const body = request.method === "GET" ? "" : await request.text();
          scope.__webGateFixtureHits!.push({
            body,
            cookie: request.headers.get("cookie"),
            method: request.method,
            path: url.pathname,
            query: url.search,
          });
          if (url.pathname === "/users/escape.xml") {
            return new Response(null, {
              status: 302,
              headers: { Location: "https://not-arenanet.invalid/steal" },
            });
          }
          if (url.pathname === "/users/offline.xml") {
            throw new Error(`fixture transport failed: ${args.responseSecret}`);
          }
          return new Response("<LoginResult>ok</LoginResult>", {
            status: 200,
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Set-Cookie": `webgate-response=${args.responseSecret}; Path=/; Secure; HttpOnly`,
            },
          });
        });
      }, { cookieSecret: COOKIE_SECRET, responseSecret: RESPONSE_SECRET });

      const exchange = await fixture.page.evaluate(
        async ({ requestSecret, oversizedBytes }) => {
          const call = async (path: string, init?: RequestInit) => {
            const response = await fetch(`gw://app/webgate${path}`, init);
            return {
              body: await response.text(),
              contentType: response.headers.get("content-type"),
              location: response.headers.get("location"),
              setCookie: response.headers.get("set-cookie"),
              status: response.status,
            };
          };
          return {
            login: await call("/users/login.xml?game=gw", {
              method: "POST",
              headers: { "Content-Type": "application/xml" },
              body: `<Login><PasswordToken>${requestSecret}</PasswordToken></Login>`,
            }),
            redirect: await call("/users/escape.xml"),
            offline: await call("/users/offline.xml"),
            method: await call("/users/login.xml", { method: "DELETE" }),
            oversized: await call("/users/login.xml", {
              method: "POST",
              body: new Uint8Array(oversizedBytes),
            }),
          };
        },
        {
          requestSecret: REQUEST_SECRET,
          oversizedBytes: MAX_PROXY_BODY_BYTES + 1,
        },
      );

      expect(exchange.login).toEqual({
        body: "<LoginResult>ok</LoginResult>",
        contentType: "application/xml; charset=utf-8",
        location: null,
        setCookie: null,
        status: 200,
      });
      expect(exchange.redirect).toMatchObject({
        // Chromium rejects a redirect returned by a custom protocol handler
        // before net.fetch exposes its Location. The composed boundary still
        // refuses it with the proxy's closed transport outcome; the explicit
        // escape classifier is exercised in proxy-routes.test.ts.
        body: "proxy error",
        location: null,
        status: 502,
      });
      expect(exchange.offline).toMatchObject({
        body: "proxy error",
        location: null,
        status: 502,
      });
      expect(exchange.method).toMatchObject({
        body: "method not allowed",
        status: 405,
      });
      expect(exchange.oversized).toMatchObject({
        body: "request body too large",
        status: 413,
      });

      const observed = await fixture.app.evaluate(({ session }) => {
        const scope = globalThis as typeof globalThis & {
          __webGateFixtureHits?: FixtureHit[];
        };
        return Promise.all([
          Promise.resolve(scope.__webGateFixtureHits ?? []),
          session.defaultSession.cookies.get({
            domain: "webgate.ncplatform.net",
          }),
        ]).then(([hits, cookies]) => ({
          hits,
          cookies: cookies.map(({ name, value }) => ({ name, value })),
        }));
      });
      expect(observed.hits).toEqual([
        {
          body: `<Login><PasswordToken>${REQUEST_SECRET}</PasswordToken></Login>`,
          cookie: null,
          method: "POST",
          path: "/users/login.xml",
          query: "?game=gw",
        },
        {
          body: "",
          cookie: null,
          method: "GET",
          path: "/users/escape.xml",
          query: "",
        },
        {
          body: "",
          cookie: null,
          method: "GET",
          path: "/users/offline.xml",
          query: "",
        },
      ]);
      expect(observed.cookies).toEqual([
        { name: "preexisting", value: COOKIE_SECRET },
      ]);

      await fixture.app.evaluate(async (_, modulePath) => {
        const load = process
          .getBuiltinModule("node:module")
          .createRequire(modulePath);
        await load(modulePath).flushDiagnostics();
      }, DIAGNOSTICS_MODULE);
      const diagnosticFiles = await readdir(
        path.join(fixture.userData, "diagnostics"),
      );
      const diagnostics = (
        await Promise.all(
          diagnosticFiles
            .filter((name) => name.endsWith(".jsonl"))
            .map((name) =>
              readFile(path.join(fixture.userData, "diagnostics", name), "utf8"),
            ),
        )
      ).join("\n");
      for (const secret of [REQUEST_SECRET, COOKIE_SECRET, RESPONSE_SECRET]) {
        expect(JSON.stringify(exchange)).not.toContain(secret);
        expect(diagnostics).not.toContain(secret);
      }
    } finally {
      await closeOffline(fixture);
    }
  });
});
