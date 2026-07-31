// Reads repository text, and says so in its filename.
//
// Eleven of the fourteen security-posture assertions this repository used to
// make about src/main by regular expression are asked of the running
// application instead, in tests/electron/sandbox.spec.ts (P5.18). These three
// are what is left. Each one is a call site: the predicate it calls is executed
// by a unit test, and what has no executable form is that main still asks it.
// They are here, under a filename
// that admits what they are, rather than deleted — a call site nothing checks
// is exactly how a guard gets dropped in a refactor and noticed in an incident.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("IPC still refuses a sender that is not the main frame at the canonical URL", () => {
  // Not reachable from a test: `frame-src 'none'` means the renderer cannot
  // create a subframe to invoke from, and the `will-navigate` guard — proved
  // for real in tests/electron/sandbox.spec.ts — means the main frame cannot
  // leave the canonical URL. `isCanonicalRendererUrl` itself is executed in
  // tests/unit/renderer-trust.test.ts.
  const ipc = read("src/main/ipc.ts");
  assert.match(ipc, /event\.senderFrame !== event\.sender\.mainFrame/u);
  assert.match(ipc, /isCanonicalRendererUrl\(event\.senderFrame\.url\)/u);
});

test("the proxy still answers only fetches", () => {
  // `isProxyFetchDestination` is executed over every destination Chromium can
  // set in tests/unit/proxy-routes.test.ts. Triggering the call site would need
  // a live request to an ArenaNet host, which no automated test may make.
  assert.match(
    read("src/main/protocol.ts"),
    /if \(!isProxyFetchDestination\(destination\)\)/u,
  );
  assert.equal(
    read("src/main/protocol.ts").match(/isProxyCookieHeader\(key\)/gu)?.length,
    2,
  );
});
