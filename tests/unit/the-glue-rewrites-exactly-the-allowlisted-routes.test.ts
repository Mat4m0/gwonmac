// Two tables describe the same allowlist from opposite ends. src/main/core/
// proxy-routes.ts decides which hosts `gw://app/<route>/…` may reach; the
// renderer rewrites the client's same-origin API calls onto those paths, and
// the labels it recognises are written out again in src/renderer/harness.ts
// because the import boundary keeps the renderer out of src/main.
//
// Neither drift is loud. A label the renderer does not know leaves the call on
// its original URL, where the proxy never sees it and the request fails as a
// network error rather than as a refusal. A label the route table has since
// dropped is rewritten into a `gw://app` path that fails closed, which is safe
// and also indistinguishable from the feature never having worked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PROXY_ROUTES } from "../../src/main/core/proxy-routes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const GLUE = "src/renderer/harness.ts";

const PROXY_LABELS = /const PROXY_LABELS = new Set\(\[([^\]]*)\]\);/u;

/**
 * The renderer's label set is read out of its source rather than imported:
 * harness.ts installs itself onto `window` and `Module` at import time, and a
 * DOM-less test process has neither.
 */
function glueLabels(): string[] {
  const text = readFileSync(path.join(root, GLUE), "utf8");
  const match = PROXY_LABELS.exec(text);
  assert.ok(match, `${GLUE} no longer declares a PROXY_LABELS set`);
  return [...match[1]!.matchAll(/['"]([^'"]*)['"]/gu)].map((entry) => entry[1]!);
}

test("the renderer rewrites every allowlisted route and no other label", () => {
  assert.deepEqual(glueLabels().sort(), Object.keys(PROXY_ROUTES).sort());
});
