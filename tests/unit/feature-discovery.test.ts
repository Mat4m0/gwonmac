import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "../../scripts/enhancements-live/scenarios.js";
import { inspectWasmBytes } from "../../src/tools/wasm-inspection.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
let temporary: string;
let guard: string;
before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "gwonmac-discovery-"));
  guard = path.join(temporary, "guard.mjs");
  // Any build, game launch, network access, or Playwright import makes discovery
  // fail. This checks executed behavior rather than matching source wording.
  await writeFile(guard, `
    import cp from 'node:child_process';
    import net from 'node:net';
    import http from 'node:http';
    import https from 'node:https';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    const refuse = () => { throw new Error('discovery crossed an execution boundary'); };
    for (const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) cp[name] = refuse;
    if (process.env.DISCOVERY_TEST_BUILD_FAILURE === '1') cp.spawnSync = (exe, args) => {
      if (exe !== process.execPath || args.length !== 1 || args[0] !== 'scripts/build.mjs') refuse();
      return { status: 9 };
    };
    net.connect = net.createConnection = net.createServer = refuse;
    http.request = http.get = https.request = https.get = refuse;
    globalThis.fetch = refuse;
    syncBuiltinESMExports();
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'playwright' || specifier === 'electron') refuse();
      return next(specifier, context);
    }});
  `);
});
after(async () => { await rm(temporary, { recursive: true, force: true }); });

function run(entry: string, args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [
    "--import", path.join(root, "scripts/ts-hook.mjs"), "--import", guard,
    path.join(root, entry), ...args,
  ], { cwd: temporary, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, GW_LIVE_SMOKE: "0", ...env } });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

test("scenario discovery matches execution definitions without acquiring capabilities", () => {
  const result = run("scripts/enhancements-live.ts", ["--list"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    formatVersion: 1,
    scenarios: Object.entries(SCENARIOS).map(([name, { tier, program, readiness }]) =>
      ({ name, tier, program, readiness })),
  });
  const described = run("scripts/enhancements-live.ts", ["--describe", "effect-observer"]);
  assert.equal(described.status, 0, described.stderr);
  const { tier, program, readiness } = SCENARIOS["effect-observer"]!;
  assert.deepEqual(JSON.parse(described.stdout).scenarios,
    [{ name: "effect-observer", tier, program, readiness }]);
});

test("unknown or mixed discovery arguments cannot fall through to a live run", () => {
  for (const args of [["--describe", "toString"], ["--describe"], ["--list", "--scenario", "boot"], ["--describe", "unknown"]]) {
    const result = run("scripts/enhancements-live.ts", args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /usage:/);
  }
});

test("doctor inspects an absent profile without building", () => {
  const result = run("src/tools/certification.ts", ["doctor", "--profile", path.join(temporary, "absent")]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).readyForCachedLive, false);
});

const emptyModule = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
test("supplied module inventory never claims synthetic or official provenance", async () => {
  const file = path.join(temporary, "Gw.jspi.wasm");
  await writeFile(file, emptyModule);
  const result = run("src/tools/certification.ts", ["inspect", file]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    formatVersion: 1, status: "ok", runtimeAuthority: false,
    artifact: { selection: "supplied-path", provenance: "unverified",
      sha256: createHash("sha256").update(emptyModule).digest("hex"), bytes: 8 },
    module: { imports: [], exports: [], memories: [], tables: [] },
  });
});

test("inspection refuses missing, malformed, oversized, and invalid argument inputs", async () => {
  const malformed = path.join(temporary, "malformed.wasm");
  await writeFile(malformed, "not wasm");
  const large = path.join(temporary, "large.wasm");
  // A sparse file exercises the allocation bound without retaining a large fixture.
  const { open } = await import("node:fs/promises");
  const file = await open(large, "w");
  await file.truncate(64 * 1024 * 1024 + 1);
  await file.close();
  for (const [filename, reason] of [[path.join(temporary, "missing"), "cannot-read"], [temporary, "cannot-read"], [malformed, "invalid-wasm"], [large, "input-too-large"]]) {
    const result = run("src/tools/certification.ts", ["inspect", filename!]);
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { formatVersion: 1, status: "refused", runtimeAuthority: false, reason });
  }
  assert.equal(run("src/tools/certification.ts", ["inspect", "--unknown"]).status, 2);
});

test("inventory distinguishes imported and defined memory and table limits", () => {
  const defined = Uint8Array.from([...emptyModule, 4,5,1,0x70,1,2,4, 5,4,1,1,1,3]);
  assert.deepEqual(inspectWasmBytes(defined), {
    imports: [], exports: [],
    tables: [{ index: 0, source: "module", element: "funcref", minimum: 2, maximum: 4, shared: false }],
    memories: [{ index: 0, source: "module", minimum: 1, maximum: 3, shared: false }],
  });
  const imported = Uint8Array.from([...emptyModule, 2,17,2,
    1,101,1,116,1,0x70,0,2, 1,101,1,109,2,1,1,3]);
  // Each entry uses the module/name from the import, not guessed export names.
  assert.deepEqual(inspectWasmBytes(imported), {
    imports: [{module:"e",name:"m",kind:"memory"},{module:"e",name:"t",kind:"table"}],
    exports: [],
    tables: [{index:0,source:"import",module:"e",name:"t",element:"funcref",minimum:2,maximum:null,shared:false}],
    memories: [{index:0,source:"import",module:"e",name:"m",minimum:1,maximum:3,shared:false}],
  });
});


test("live execution retains opt-in and cannot launch after a failed build", () => {
  const refused = run("scripts/enhancements-live.ts", ["--scenario", "boot"]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /requires GW_LIVE_SMOKE=1/);
  const failed = run("scripts/enhancements-live.ts", ["--scenario", "boot"], {
    GW_LIVE_SMOKE: "1", DISCOVERY_TEST_BUILD_FAILURE: "1",
  });
  assert.equal(failed.status, 9, failed.stderr);
  assert.match(failed.stderr, /build failed/);
});
