// Reads repository text, and says so in its filename.
//
// Most security-posture assertions this repository used to make about
// src/main by regular expression are now asked of the running application.
// These are the call sites whose rejected branch cannot be constructed past
// the surrounding Electron guard. Each predicate is executed by a unit test;
// this file proves only that main still asks it. It lives under a filename
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
  // set in tests/unit/proxy-routes.test.ts. The complete accepted path, cookie
  // isolation, and refusal outcomes run through the actual protocol handler in
  // tests/electron/webgate.spec.ts; only this unreachable destination branch
  // remains a source assertion.
  assert.match(
    read("src/main/protocol.ts"),
    /if \(!isProxyFetchDestination\(destination\)\)/u,
  );
});

test("the proxy response still crosses the canonical header boundary", () => {
  // The pure boundary is exercised with safe and escaped redirects in
  // proxy-routes.test.ts. Chromium's custom-protocol fixture cannot expose a
  // synthetic 302 to net.fetch, so retain only this one production call-site
  // assertion rather than introducing a second transport implementation.
  assert.match(
    read("src/main/protocol.ts"),
    /proxyResponseHeaders\(\s*route,\s*upstream,\s*res\.status,\s*res\.headers,/u,
  );
});
