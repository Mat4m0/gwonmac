// Reads repository text, and says so in its filename. It is here rather than in
// tests/policy/ for one reason: each assertion compares hand-written source
// against a *compiled* module under build/, and tests/policy runs without a
// build.
//
// The renderer half of each pair cannot be imported. src/renderer/diagnostics.ts
// is a classic IIFE served over gw:// to a sandboxed page — it exports nothing
// and has no module form — so the only way to compare its constants with the
// canonical ones is to read them out of its text. That is a weaker proof than
// executing it, and saying so is the point of the filename.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

// Each canonical constant below is loaded from `build/`, which is the point of
// this file, and typed from the `src/` module `build/` is emitted from. The
// annotation is on the declaration rather than an assertion on the call: a
// dynamic `import()` whose specifier is not a literal resolves to `any`, so
// without it the assertions would compare against an unchecked shape and a
// renamed export would read as `undefined` instead of failing `tsc`.

test("renderer and main process use the same histogram boundaries", async () => {
  const renderer = read("src/renderer/diagnostics.ts");
  const literal = renderer.match(/const histogramLimitsUs = \[([\s\S]*?)\];/)?.[1];
  assert.ok(literal, "renderer histogram boundaries are missing");
  const rendererBuckets = [
    ...literal.matchAll(/Number\.MAX_SAFE_INTEGER|\d[\d_]*/g),
  ].map(([token]) =>
    token === "Number.MAX_SAFE_INTEGER"
      ? Number.MAX_SAFE_INTEGER
      : Number(token.replaceAll("_", "")),
  );
  const { DIAGNOSTIC_BUCKETS_US }: typeof import("../../src/shared/diagnostics.ts") =
    await import(new URL("../../build/shared/diagnostics.js", import.meta.url).href);
  assert.deepEqual(rendererBuckets, [...DIAGNOSTIC_BUCKETS_US]);
});

test("renderer and main process use the same diagnostic event allowlist", async () => {
  const renderer = read("src/renderer/diagnostics.ts");
  const literal = renderer.match(
    /const rendererEventNames = new Set\(\[([\s\S]*?)\]\);/,
  )?.[1];
  assert.ok(literal, "renderer event allowlist is missing");
  const rendererNames = [...literal.matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .sort();
  const { RENDERER_EVENT_NAMES }: typeof import("../../src/shared/diagnostics.ts") =
    await import(new URL("../../build/shared/diagnostics.js", import.meta.url).href);
  assert.deepEqual(rendererNames, [...RENDERER_EVENT_NAMES].sort());
});

test("every main→renderer event channel is named somewhere in main", async () => {
  // What used to be a 35-channel × 2 source scan. Both halves it policed are
  // now compile-time or executed facts:
  //  - the preload's constants are generated from `IPC`, and
  //    tests/release/preload-behaviour.test.ts calls every capability the
  //    generated bridge exposes;
  //  - the handler registry is `satisfies Record<InvokeChannel, …>`, so
  //    an `invoke` channel with no handler fails `tsc`.
  // The event channels have neither a registry nor a caller to execute:
  // main sends them, and a channel main never sends is dead weight nothing else
  // would notice.
  const { EVENT_CHANNELS }: typeof import("../../src/shared/contracts.ts") =
    await import(new URL("../../build/shared/contracts.js", import.meta.url).href);
  const main = execFileSync("git", ["ls-files", "--", "src/main"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file && existsSync(path.join(root, file)))
    .map(read)
    .join("\n");
  assert.equal(EVENT_CHANNELS.length, 6);
  for (const key of EVENT_CHANNELS) {
    assert.match(main, new RegExp(`\\bIPC\\.${key}\\b`), `${key} is missing from main`);
  }
});
