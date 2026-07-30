import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import type { PublishedClientManifest } from "../src/main/core/published-client.ts";
import type { AppSettingsPatch } from "../src/shared/contracts.ts";
// The canonical tables, not their emitted copies. `pnpm typecheck` runs before
// `pnpm build` in `pnpm verify`, so a static import of `build/` here would make
// checking depend on output that may not exist yet — the dependency Phase 0b
// removed from the tooling scripts for the same reason. The packaged app under
// test is built from these same sources.
import {
  ENHANCEMENT_BUILDS,
  enhancementLayoutWords,
} from "../src/main/core/enhancement-builds.ts";
import {
  COMPANION_CURSOR_ABI,
  COMPANION_CURSOR_BYTES,
  COMPANION_SNAPSHOT_ABI,
  COMPANION_SNAPSHOT_BYTES,
} from "../src/renderer/companion-snapshot.ts";
import { root } from "./electron/fixtures.mts";

/**
 * The host `Module` the renderer publishes for ArenaNet's generated glue. Only
 * what this file drives is named — `src/renderer/harness.ts` owns the object,
 * and the glue's own surface is ArenaNet's.
 */
interface HostModule {
  instantiateWasm(
    imports: WebAssembly.Imports,
    accept: (
      instance: WebAssembly.Instance,
      module: WebAssembly.Module,
    ) => void,
  ): unknown;
  onRuntimeInitialized(): void;
  socket?: { connect?: unknown };
}

/** The probe `installTargetReadout` leaves on the page for later assertions. */
interface TargetReadoutFixture {
  allocations: { pointer: number; size: number }[];
  freed: number[];
  hookSlot: WebAssembly.Global;
  publish(options?: {
    distance?: number;
    rangeBand?: number;
    target?: boolean;
  }): void;
  table: WebAssembly.Table;
}

/**
 * The packaged renderer's page. `Module` is a page global with no module to
 * import it from; everything the bridge exposes is on `window` and typed by
 * `src/renderer/gw-native.d.ts`.
 */
type PageGlobals = typeof globalThis & { Module?: HostModule };

/** The same page once `installTargetReadout` has published its probe. */
type ReadoutPageGlobals = PageGlobals & {
  __targetReadoutFixture: TargetReadoutFixture;
};

const packagedExecutable = path.join(
  root,
  `out/Guild Wars Reforged-darwin-${process.arch}/Guild Wars Reforged.app/Contents/MacOS/Guild Wars Reforged`,
);
assert.ok(
  existsSync(packagedExecutable),
  `packaged app is missing at ${packagedExecutable}; run pnpm package first`,
);

const OFFICIAL_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);
const OFFICIAL_SHA256 = createHash("sha256")
  .update(OFFICIAL_WASM)
  .digest("hex");
// `assert.fail` returns `never`, so this is the build itself rather than an
// optional every function below would have to re-narrow.
const ENHANCEMENT_BUILD =
  ENHANCEMENT_BUILDS[0] ?? assert.fail("the canonical Enhancement build table is empty");
const LAYOUT_WORDS = enhancementLayoutWords(ENHANCEMENT_BUILD.layout);
const SNAPSHOT_BYTES = Uint8Array.of(0);
const SNAPSHOT_HASH = createHash("md5")
  .update(SNAPSHOT_BYTES)
  .digest("hex");
const SYNTHETIC_GLUE = [
  "Module.instantiateWasm({ env: {} }, function () {",
  "  Module.onRuntimeInitialized();",
  "});",
].join("\n");

function uleb(value: number) {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

function customSectionModule(nameText: string, payload: number[] = []) {
  const name = [...new TextEncoder().encode(nameText)];
  const body = [...uleb(name.length), ...name, ...payload];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x00, ...uleb(body.length), ...body,
  ]);
}

function manifestMarkerModule() {
  // Runtime init gates only on the served module carrying this section. It
  // deliberately has no modeled payload: the off-selection proof must not
  // accidentally depend on the renderer accepting a synthetic ABI record.
  return customSectionModule("enhancement_manifest");
}

function installableManifestModule() {
  const manifest = [...new TextEncoder().encode(JSON.stringify({
    snapshotAbi: COMPANION_SNAPSHOT_ABI,
    snapshotBytes: COMPANION_SNAPSHOT_BYTES,
    cursorSnapshotAbi: COMPANION_CURSOR_ABI,
    cursorSnapshotBytes: COMPANION_CURSOR_BYTES,
    configBytes: LAYOUT_WORDS.length * Uint32Array.BYTES_PER_ELEMENT,
    buildId: ENHANCEMENT_BUILD.buildId,
    programId: ENHANCEMENT_BUILD.programId,
    tableSlot: ENHANCEMENT_BUILD.tableSlot,
    layoutWords: LAYOUT_WORDS,
  }))];
  return customSectionModule("enhancement_manifest", manifest);
}

function enhancementResource(url: string) {
  const pathname = new URL(url).pathname;
  return /^\/enhancement(?:-[a-z-]+)?\.(?:js|wasm)$/u.test(pathname);
}

async function reservePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return port;
}

async function connectCdp(port: number, child: ChildProcess, output: string[]) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(
    `packaged Chromium did not expose CDP: ${String(lastError)}\n`
      + output.join("").slice(-4_000),
  );
}

async function rendererPage(
  browser: Browser,
  child: ChildProcess,
  output: string[],
) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && child.exitCode === null) {
    for (const context of browser.contexts()) {
      const page = context.pages().find((candidate) =>
        candidate.url().startsWith("gw://app/"));
      if (page) {
        await page.waitForLoadState("domcontentloaded");
        return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `packaged renderer did not open\n${output.join("").slice(-4_000)}`,
  );
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

/** Where a launch's per-run state lives, for the `prepare` hook to seed. */
interface LaunchPaths {
  artifacts: string;
  userData: string;
}

interface LaunchOptions {
  cachedOnly?: boolean;
  prepare?: (paths: LaunchPaths) => Promise<void>;
}

async function launchPackaged(
  prefix: string,
  settings: AppSettingsPatch,
  {
    cachedOnly = false,
    prepare = async () => undefined,
  }: LaunchOptions = {},
) {
  const userData = await mkdtemp(path.join(tmpdir(), prefix));
  const artifacts = path.join(userData, "game", "artifacts");
  try {
    await mkdir(artifacts, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(userData, "settings.json"),
        // Packaged builds are update-capable and the check defaults on; a test
        // launch must never reach GitHub, so every profile opts out unless the
        // test says otherwise.
        JSON.stringify({ autoCheckUpdates: false, ...settings }),
        { mode: 0o600 },
      ),
      writeFile(path.join(artifacts, "Gw.jspi.wasm"), OFFICIAL_WASM),
    ]);
    await prepare({ artifacts, userData });
  } catch (error) {
    await rm(userData, { recursive: true, force: true });
    throw error;
  }

  const port = await reservePort();
  const output: string[] = [];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GW_OFFLINE_SHELL;
  delete env.GW_REQUIRE_CACHED_CLIENT;
  if (cachedOnly) env.GW_REQUIRE_CACHED_CLIENT = "1";
  else env.GW_OFFLINE_SHELL = "1";
  const child = spawn(
    packagedExecutable,
    [
      `--user-data-dir=${userData}`,
      "--gw-adhoc-test-keychain",
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
    ],
    {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (data) => output.push(String(data)));
  child.stderr.on("data", (data) => output.push(String(data)));

  let browser: Browser | undefined;
  try {
    browser = await connectCdp(port, child, output);
    const page = await rendererPage(browser, child, output);
    return { artifacts, browser, child, output, page, userData };
  } catch (error) {
    await stopProcess(child);
    await rm(userData, { recursive: true, force: true });
    throw error;
  }
}

type PackagedFixture = Awaited<ReturnType<typeof launchPackaged>>;

async function closePackaged(fixture: PackagedFixture) {
  await fixture.browser.close().catch(() => undefined);
  await stopProcess(fixture.child);
  await rm(fixture.userData, { recursive: true, force: true });
}

async function driveHarnessRuntime(page: Page) {
  await page.waitForFunction(() => {
    const { Module } = globalThis as PageGlobals;
    return (
      typeof Module?.instantiateWasm === "function"
      && typeof Module?.socket?.connect === "function"
    );
  });
  return page.evaluate(() =>
    new Promise<{ manifestSections: number; enhancementHookExports: string[] }>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("synthetic game module did not instantiate")),
          10_000,
        );
        const { Module } = globalThis as PageGlobals;
        if (!Module) throw new Error("the renderer published no Module");
        Module.instantiateWasm(
          { env: {} },
          (_instance, module) => {
            clearTimeout(timeout);
            resolve({
              manifestSections: WebAssembly.Module.customSections(
                module,
                "enhancement_manifest",
              ).length,
              enhancementHookExports: WebAssembly.Module.exports(module)
                .filter((entry) => entry.name.startsWith("enhancement_"))
                .map((entry) => entry.name),
            });
          },
        );
      },
    ),
  );
}

async function seedCachedClient({ artifacts, userData }: LaunchPaths) {
  const game = path.join(userData, "game");
  const chunks = path.join(game, "chunks");
  const compatibility = path.join(game, "compatibility", "stale", "0");
  const enhancement = path.join(game, "enhancements", "stale", "0");
  await Promise.all([
    mkdir(chunks, { recursive: true }),
    mkdir(compatibility, { recursive: true }),
    mkdir(enhancement, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(artifacts, "Gw.jspi.js"), SYNTHETIC_GLUE),
    writeFile(path.join(artifacts, "version.json"), "{}"),
    writeFile(
      path.join(artifacts, "manifest.json"),
      JSON.stringify({
        compressionMode: "none",
        chunkSize: SNAPSHOT_BYTES.byteLength,
        snapshot: "Gw.snapshot",
        size: SNAPSHOT_BYTES.byteLength,
        chunkHashes: [SNAPSHOT_HASH],
      }),
    ),
    writeFile(path.join(chunks, SNAPSHOT_HASH), SNAPSHOT_BYTES),
    writeFile(
      path.join(compatibility, "Gw.jspi.wasm"),
      "stale compatibility output",
    ),
    writeFile(path.join(enhancement, "Gw.jspi.wasm"), "stale Enhancement output"),
  ]);
}

async function assertPackagedOffSession() {
  const fixture = await launchPackaged(
    "gw-packaged-enhancement-off-",
    {
      compatibilityNoticeSeenFor: OFFICIAL_SHA256,
      dataStrategy: "quick",
      nativeCursor: false,
      targetReadout: false,
    },
    {
      cachedOnly: true,
      prepare: seedCachedClient,
    },
  );
  try {
    const resources: string[] = [];
    fixture.page.on("request", (request) => resources.push(request.url()));
    await fixture.page.waitForFunction(async () => {
      const progress = await window.gwNative.progress.current();
      if (progress.phase === "error") {
        throw new Error(`cached client failed: ${progress.errorCode}`);
      }
      return progress.phase === "ready";
    });
    await fixture.page.waitForFunction(
      () =>
        performance.getEntriesByName("gw.runtime.initialized").length > 0,
    );
    assert.deepEqual(
      await fixture.page.evaluate(() => window.gwNative.init),
      {
        enhancementAutomation: false,
        enhancementSelection: {
          nativeCursor: false,
          targetReadout: false,
        },
        templateFsTrace: false,
      },
    );

    const session = await fixture.page.evaluate(() =>
      window.gwNative.client.session());
    assert.equal(session.compatibility?.state, "uncertified");
    assert.equal(session.compatibility?.enhancementActive, false);
    assert.match(
      session.compatibility?.clientSha256 ?? "",
      /^[a-f0-9]{64}$/u,
    );

    // Typed as the manifest main seals rather than as `any`: the two fields
    // below are optional in that contract, and the assertions say outright
    // that a sealed manifest must carry them.
    const sealedManifest: PublishedClientManifest = JSON.parse(
      await readFile(path.join(fixture.artifacts, "manifest.json"), "utf8"),
    );
    assert.equal(sealedManifest.formatVersion, 1);
    assert.ok(
      sealedManifest.clientFingerprint,
      "the sealed manifest carries no client fingerprint",
    );
    assert.match(sealedManifest.clientFingerprint, /^[a-f0-9]{64}$/u);
    assert.deepEqual(
      sealedManifest.artifacts?.map((artifact) => artifact.name),
      ["Gw.jspi.js", "Gw.jspi.wasm", "version.json"],
    );
    await Promise.all([
      assert.rejects(
        stat(path.join(fixture.userData, "game", "compatibility")),
        { code: "ENOENT" },
      ),
      assert.rejects(
        stat(path.join(fixture.userData, "game", "enhancements")),
        { code: "ENOENT" },
      ),
    ]);

    const served = await driveHarnessRuntime(fixture.page);
    assert.deepEqual(served, {
      manifestSections: 0,
      enhancementHookExports: [],
    });
    assert.deepEqual(
      await fixture.page.evaluate(async () =>
        [
          ...new Uint8Array(
            await (await globalThis.fetch("Gw.jspi.wasm")).arrayBuffer(),
          ),
        ]),
      [...OFFICIAL_WASM],
    );
    // Packaged main has now migrated, verified and selected the unknown
    // official module, proving it did not serve either seeded derived output.
    // Replace only the test artifact with a manifest-bearing module, then run
    // the real harness instantiation again: now the module-side gate is open
    // and the all-false launch selection is the sole reason Enhancement stays dark.
    await writeFile(
      path.join(
        fixture.userData,
        "game",
        "artifacts",
        "Gw.jspi.wasm",
      ),
      manifestMarkerModule(),
    );
    assert.deepEqual(await driveHarnessRuntime(fixture.page), {
      manifestSections: 1,
      enhancementHookExports: [],
    });
    await fixture.page.evaluate(() => {
      const { Module } = globalThis as PageGlobals;
      if (!Module) throw new Error("the renderer published no Module");
      Module.onRuntimeInitialized();
      return new Promise<void>((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(() => resolve())));
    });

    const performanceResources = await fixture.page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name));
    const allResources = [...resources, ...performanceResources];
    assert.ok(
      allResources.some((url) => new URL(url).pathname === "/Gw.jspi.wasm"),
      "the runtime-init proof never fetched the served game module",
    );
    assert.deepEqual(
      [...new Set(allResources.filter(enhancementResource))],
      [],
      "an all-tools-off packaged runtime loaded Enhancement code or its kernel",
    );
    assert.deepEqual(
      await fixture.page.evaluate(() => ({
        installations: window.gwCompanionInstallations,
        runtime: window.gwCompanionRuntime,
        state: window.gwCompanionState,
      })),
      {
        installations: undefined,
        runtime: undefined,
        state: undefined,
      },
    );
  } finally {
    await closePackaged(fixture);
  }
}

async function installTargetReadout(page: Page, moduleBytes: Uint8Array) {
  return page.evaluate(async (bytes: number[]) => {
    const memory = new WebAssembly.Memory({ initial: 256 });
    const table = new WebAssembly.Table({
      initial: 1,
      maximum: 1,
      element: "anyfunc",
    });
    const hookSlot = new WebAssembly.Global(
      { value: "i32", mutable: true },
      0,
    );
    const allocations: { pointer: number; size: number }[] = [];
    const freed: number[] = [];
    let nextPointer = 0x1000;
    const malloc = (size: number) => {
      const pointer = nextPointer;
      nextPointer = (nextPointer + size + 7) & ~7;
      allocations.push({ pointer, size });
      return pointer;
    };
    const free = (pointer: number) => freed.push(pointer);
    const module = new WebAssembly.Module(Uint8Array.from(bytes));
    // Page-relative, so it is resolved by the packaged renderer against
    // gw://app/ rather than by the checker against this directory. The
    // annotation is what keeps the import typed: the module it loads is the
    // build of `src/renderer/enhancements.ts`.
    const specifier = "./enhancements.js";
    const { installEnhancements }: typeof import("../src/renderer/enhancements.ts") =
      await import(specifier);
    const runtime = await installEnhancements(
      {
        exports: {
          memory,
          __indirect_function_table: table,
          malloc,
          free,
          enhancement_tick_original: () => undefined,
          enhancement_hook_slot: hookSlot,
        },
      },
      module,
      { nativeCursor: false, targetReadout: true },
      false,
    );
    if (!runtime) throw new Error("target readout did not install");

    let sequence = 0;
    const publish = ({
      distance = 130.8,
      rangeBand = 1,
      target = true,
    }: { distance?: number; rangeBand?: number; target?: boolean } = {}) => {
      sequence += 2;
      const view = new DataView(
        memory.buffer,
        runtime.snapshotPointer,
        64,
      );
      view.setUint32(8, sequence - 1, true);
      view.setUint32(0, 0x4254_5747, true);
      view.setUint16(4, 1, true);
      view.setUint16(6, 64, true);
      view.setUint32(12, target ? 7 : 3, true);
      view.setUint32(16, sequence, true);
      view.setUint32(20, 133, true);
      view.setUint32(24, 0, true);
      view.setUint32(28, 7, true);
      view.setFloat32(32, 10, true);
      view.setFloat32(36, 20, true);
      view.setUint32(40, target ? 9 : 0, true);
      view.setUint32(44, target ? 0xdb : 0, true);
      view.setFloat32(48, target ? 110 : 0, true);
      view.setFloat32(52, target ? 20 : 0, true);
      view.setFloat32(56, target ? distance : 0, true);
      view.setUint32(60, target ? rangeBand : 0, true);
      view.setUint32(8, sequence, true);
    };
    (globalThis as ReadoutPageGlobals).__targetReadoutFixture = {
      allocations,
      freed,
      hookSlot,
      publish,
      table,
    };
    return {
      allocations: allocations.map(({ size }) => size),
      hook: hookSlot.value,
      installed: runtime.status,
      readout: runtime.readout,
    };
  }, [...moduleBytes]);
}

async function assertTargetReadoutLifecycle() {
  const fixture = await launchPackaged("gw-packaged-target-readout-", {
    nativeCursor: false,
    targetReadout: true,
  });
  try {
    const resources: string[] = [];
    fixture.page.on("request", (request) => resources.push(request.url()));
    await fixture.page.waitForFunction(() => {
      const { Module } = globalThis as PageGlobals;
      return typeof Module?.socket?.connect === "function";
    });
    assert.deepEqual(
      await fixture.page.evaluate(() => window.gwNative.init.enhancementSelection),
      { nativeCursor: false, targetReadout: true },
    );

    assert.deepEqual(
      await installTargetReadout(fixture.page, installableManifestModule()),
      {
        allocations: [64, 116],
        hook: 1,
        installed: "installed",
        readout: { visible: false, line: "" },
      },
    );
    assert.equal(
      await fixture.page.locator("#enhancement-target").count(),
      1,
      "installEnhancements did not mount the target readout",
    );

    await fixture.page.evaluate(() =>
      (globalThis as ReadoutPageGlobals).__targetReadoutFixture.publish());
    await fixture.page.locator("#enhancement-target").waitFor({ state: "visible" });
    assert.equal(
      await fixture.page.locator("#enhancement-target").innerText(),
      "TARGET\n131\nAdjacent",
    );

    await fixture.page.evaluate(() =>
      (globalThis as ReadoutPageGlobals).__targetReadoutFixture.publish({
        distance: 1_001.2,
        rangeBand: 5,
      }));
    await fixture.page.waitForFunction(() => {
      // `gwCompanionRuntime` is declared as an open record, so the rendered line
      // is narrowed rather than asserted into a shape this file invented.
      const readout = window.gwCompanionRuntime?.readout;
      return (
        typeof readout === "object"
        && readout !== null
        && "line" in readout
        && readout.line === "1001 Spellcast"
      );
    });
    assert.equal(
      await fixture.page.locator("#enhancement-target").innerText(),
      "TARGET\n1001\nSpellcast",
    );

    await fixture.page.evaluate(() =>
      (globalThis as ReadoutPageGlobals).__targetReadoutFixture.publish({
        target: false,
      }));
    await fixture.page.locator("#enhancement-target").waitFor({ state: "hidden" });

    const disposed = await fixture.page.evaluate(() => {
      globalThis.dispatchEvent(new globalThis.Event("pagehide"));
      const probe = (globalThis as ReadoutPageGlobals).__targetReadoutFixture;
      return {
        freed: [...probe.freed].sort((left, right) => left - right),
        hook: probe.hookSlot.value,
        runtime: window.gwCompanionRuntime,
        tableEmpty: probe.table.get(0) === null,
      };
    });
    assert.equal(
      await fixture.page.locator("#enhancement-target").count(),
      0,
      "pagehide did not dispose the target readout",
    );
    assert.deepEqual(disposed, {
      freed: [0x1000, 0x1040],
      hook: 0,
      runtime: null,
      tableEmpty: true,
    });
    assert.ok(
      resources.some(
        (url) => new URL(url).pathname === "/companion-kernel.wasm",
      ),
      "the installed control never fetched the packaged Enhancement kernel",
    );
    assert.ok(
      resources.some((url) => new URL(url).pathname === "/enhancements.js"),
      "the installed control never imported the packaged Enhancement runtime",
    );
  } finally {
    await closePackaged(fixture);
  }
}

await assertPackagedOffSession();
await assertTargetReadoutLifecycle();
console.log(
  "packaged Enhancement runtime proved all-tools-off isolation and target-readout lifecycle",
);
