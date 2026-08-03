import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
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
import {
  ENHANCEMENT_CONFIG_WORD_COUNT,
  ENHANCEMENT_TRANSFORM_ABI,
  enhancementHooksFor,
  type AppSettingsPatch,
  type EnhancementCapabilities,
} from "../src/shared/contracts.ts";
import { stopChildProcess } from "./helpers/child-process.ts";
// The canonical tables, not their emitted copies. `pnpm typecheck` runs before
// `pnpm build` in `pnpm verify`, so a static import of `build/` here would make
// checking depend on output that may not exist yet — the dependency Phase 0b
// removed from the tooling scripts for the same reason. The packaged app under
// test is built from these same sources.
import {
  ENHANCEMENT_BUILDS,
  enhancementConfigWords,
} from "../src/main/certification/enhancement-builds.ts";
import {
  COMPANION_CURSOR_BYTES,
  COMPANION_TOOLBOX_BYTES,
} from "../src/renderer/companion-snapshot.ts";
import { root } from "./electron/fixtures.mts";
import {
  DISTRIBUTION_CHANNEL_CONFIG,
} from "../src/shared/distribution-channel.ts";
import { resolvePackageMode } from "../scripts/package-mode.ts";

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
  runtime: CompanionDeveloperRuntime;
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

const packageMode = resolvePackageMode(process.env.GW_PACKAGE_INTENT);
const productName =
  DISTRIBUTION_CHANNEL_CONFIG[packageMode.productChannel].productName;
const packagedExecutable = path.join(
  root,
  `out/${productName}-darwin-${process.arch}/${productName}.app/Contents/MacOS/${productName}`,
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
const TARGET_ONLY: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: true,
  toolbox: false,
});
const TOOLBOX_PROGRAM_CAPABILITIES: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  toolbox: true,
});
const CONFIG_BYTES =
  ENHANCEMENT_CONFIG_WORD_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const TOOLBOX_CONFIG_POINTER = 0x11_000;
const TOOLBOX_CURSOR_POINTER = (TOOLBOX_CONFIG_POINTER + CONFIG_BYTES + 7) & ~7;
const TOOLBOX_STATE_POINTER =
  (TOOLBOX_CURSOR_POINTER + COMPANION_CURSOR_BYTES + 7) & ~7;
const DEVELOPER_RUNTIME_KEYS = Object.freeze([
  "buildId",
  "companionAbi",
  "cursor",
  // The two hidden-transition gauges: how often the re-ask loop fired and how
  // long the last hidden transition lasted. Presentation counters only.
  "cursorHiddenGapMs",
  "cursorHiddenRetests",
  "cursorRefreshes",
  "hertz",
  "installation",
  "kernelSha256",
  "lastRenderUs",
  "programId",
  "readout",
  "rejectedSnapshots",
  "renderP95Us",
  "snapshotReads",
  "status",
  "toolbox",
  "wasmMemoryBytes",
]);
// The readout fixture drives the bundled installer as the target-observer
// program — the only path to the readout since the user setting retired — and
// that program alone carries the explicit benchmark hook control.
const OBSERVER_RUNTIME_KEYS = Object.freeze(
  [...DEVELOPER_RUNTIME_KEYS, "setHookEnabledForBenchmark"].sort(),
);
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

function installableManifestModule(
  capabilities: EnhancementCapabilities,
) {
  const hooks = enhancementHooksFor(capabilities);
  const manifest = [...new TextEncoder().encode(JSON.stringify({
    transformAbi: ENHANCEMENT_TRANSFORM_ABI,
    buildId: ENHANCEMENT_BUILD.buildId,
    programId: ENHANCEMENT_BUILD.programId,
    tableSlot: ENHANCEMENT_BUILD.tableSlot,
    capabilities,
    hooks: {
      tick: hooks.tick ? {
        functionIndex: ENHANCEMENT_BUILD.hookFunction,
        params: ENHANCEMENT_BUILD.hookParams,
        results: ENHANCEMENT_BUILD.hookResults,
      } : null,
      cursor: hooks.cursor ? {
        functionIndex: ENHANCEMENT_BUILD.cursorEvent.functionIndex,
        params: ENHANCEMENT_BUILD.cursorEvent.params,
        results: ENHANCEMENT_BUILD.cursorEvent.results,
        existingTableSlot: ENHANCEMENT_BUILD.cursorEvent.tableSlot,
      } : null,
      ui: hooks.ui ? {
        functionIndex: ENHANCEMENT_BUILD.uiDispatcher.functionIndex,
        params: ENHANCEMENT_BUILD.uiDispatcher.params,
        results: ENHANCEMENT_BUILD.uiDispatcher.results,
      } : null,
    },
    messages: hooks.ui ? {
      playerChat: ENHANCEMENT_BUILD.uiDispatcher.playerChatMessage,
      hideHeroPanel: ENHANCEMENT_BUILD.uiDispatcher.hideHeroPanelMessage,
      showHeroPanel: ENHANCEMENT_BUILD.uiDispatcher.showHeroPanelMessage,
      partyDirty: ENHANCEMENT_BUILD.uiDispatcher.partyDirtyMessages,
    } : null,
    configWords: enhancementConfigWords(ENHANCEMENT_BUILD, capabilities),
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
      "--gw-volatile-secrets",
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
    await stopChildProcess(child);
    await rm(userData, { recursive: true, force: true });
    throw error;
  }
}

type PackagedFixture = Awaited<ReturnType<typeof launchPackaged>>;

async function closePackaged(fixture: PackagedFixture) {
  await fixture.browser.close().catch(() => undefined);
  await stopChildProcess(fixture.child);
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
        enhancementProgram: "none",
        enhancementSelection: {
          nativeCursor: false,
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
        runtime: window.gwCompanionRuntime,
        state: window.gwCompanionState,
      })),
      {
        runtime: undefined,
        state: undefined,
      },
    );
  } finally {
    await closePackaged(fixture);
  }
}

async function installTargetReadout(page: Page, moduleBytes: Uint8Array) {
  return page.evaluate(async ({ bytes, tableSize }: {
    bytes: number[];
    tableSize: number;
  }) => {
    const memory = new WebAssembly.Memory({ initial: 256 });
    const table = new WebAssembly.Table({
      initial: tableSize,
      maximum: tableSize,
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
          enhancement_hook_slot: hookSlot,
        },
      },
      module,
      // The retired user setting cannot request the readout; its developer
      // program derives the same `target` capability profile.
      { nativeCursor: false },
      "target-observer",
    );
    if (!runtime) throw new Error("target readout did not install");

    let sequence = 0;
    const publish = ({
      distance = 130.8,
      rangeBand = 1,
      target = true,
    }: { distance?: number; rangeBand?: number; target?: boolean } = {}) => {
      sequence += 2;
      const snapshotPointer = allocations[1]?.pointer;
      if (snapshotPointer === undefined) {
        throw new Error("target readout snapshot allocation is missing");
      }
      const view = new DataView(memory.buffer, snapshotPointer, 64);
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
      runtime,
    };
    return {
      allocations: allocations.map(({ size }) => size),
      // The observer program publishes the developer runtime; teardown below
      // proves pagehide withdraws it again.
      globalRuntimeIsRuntime: window.gwCompanionRuntime === runtime,
      hook: hookSlot.value,
      installed: runtime.status,
      readout: runtime.readout,
      runtimeFrozen: Object.isFrozen(runtime),
      runtimeKeys: Object.keys(runtime).sort(),
    };
  }, {
    bytes: [...moduleBytes],
    tableSize: ENHANCEMENT_BUILD.tableSlot + 1,
  });
}

async function assertTargetReadoutLifecycle() {
  const fixture = await launchPackaged("gw-packaged-target-readout-", {
    nativeCursor: false,
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
      { nativeCursor: false },
    );

    assert.deepEqual(
      await installTargetReadout(
        fixture.page,
        installableManifestModule(TARGET_ONLY),
      ),
      {
        allocations: [
          65_536,
          64,
          CONFIG_BYTES,
        ],
        globalRuntimeIsRuntime: true,
        hook: ENHANCEMENT_BUILD.tableSlot + 1,
        installed: "installed",
        readout: { visible: false, line: "" },
        runtimeFrozen: true,
        runtimeKeys: OBSERVER_RUNTIME_KEYS,
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
    // The observer program publishes the companion state globally — that is
    // the harness surface the live runner reads. Teardown below proves the
    // publication is withdrawn with the installation.
    assert.deepEqual(
      await fixture.page.evaluate(() => ({
        status: window.gwCompanionState?.status,
        targetValid:
          window.gwCompanionState !== undefined
          && "targetValid" in window.gwCompanionState
          && window.gwCompanionState.targetValid,
      })),
      { status: "ready", targetValid: true },
      "the observer program did not publish its observation",
    );
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
      const readout = (globalThis as ReadoutPageGlobals)
        .__targetReadoutFixture.runtime.readout;
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
        state: window.gwCompanionState,
        tableEmpty: probe.table.get(probe.table.length - 1) === null,
      };
    });
    assert.equal(
      await fixture.page.locator("#enhancement-target").count(),
      0,
      "pagehide did not dispose the target readout",
    );
    assert.deepEqual(disposed, {
      freed: [0x1000, 0x11_000, 0x11_040],
      hook: 0,
      // Cleanup withdraws the published runtime by writing null over it.
      runtime: null,
      state: undefined,
      tableEmpty: true,
    });

    // The crash-triage timeline: installation and withdrawal are recorded
    // events beside wasm.abort, so an exported log can say whether the hook
    // was live. Poll, because the recorder flushes asynchronously.
    const telemetryDeadline = Date.now() + 10_000;
    let lifecycle: { name: string; fields: Record<string, unknown> }[] = [];
    while (Date.now() < telemetryDeadline) {
      const events: { name?: string; fields?: Record<string, unknown> }[] = [];
      for (const file of (await readdir(path.join(fixture.userData, "diagnostics"))
        .catch(() => [] as string[]))
        .filter((name) => name.endsWith(".jsonl"))) {
        const text = await readFile(
          path.join(fixture.userData, "diagnostics", file),
          "utf8",
        );
        for (const entry of text.split("\n")) {
          if (!entry) continue;
          try {
            events.push(JSON.parse(entry));
          } catch {
            continue;
          }
        }
      }
      lifecycle = events
        .filter((event) =>
          event.name === "enhancement.installed"
          || event.name === "enhancement.uninstalled")
        .map((event) => ({ name: event.name ?? "", fields: event.fields ?? {} }));
      if (lifecycle.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.deepEqual(
      lifecycle.map(({ name, fields }) => ({
        name,
        companionAbi: fields.companionAbi,
        capabilityProfile: fields.capabilityProfile,
        installation: fields.installation,
      })),
      [
        {
          name: "enhancement.installed",
          companionAbi: 6,
          capabilityProfile: "target",
          installation: 1,
        },
        {
          name: "enhancement.uninstalled",
          companionAbi: undefined,
          capabilityProfile: undefined,
          installation: 1,
        },
      ],
      "the packaged install lifecycle did not reach the diagnostics log",
    );
    // The request listener attaches after boot, and the harness now imports
    // the shared contract during boot for its heap watermark — a module the
    // ES-module cache then serves to the control without a second request.
    // The performance timeline sees every load since page start, so the
    // merged list is the instrument that can still prove the control's
    // dependency graph resolves to the canonical modules.
    const performanceResources = await fixture.page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name));
    const allResources = [...resources, ...performanceResources];
    assert.ok(
      allResources.some(
        (url) => new URL(url).pathname === "/companion-kernel.wasm",
      ),
      "the installed control never fetched the packaged Enhancement kernel",
    );
    assert.ok(
      allResources.some((url) => new URL(url).pathname === "/enhancements.js"),
      "the installed control never imported the packaged Enhancement runtime",
    );
    assert.ok(
      allResources.some(
        (url) => new URL(url).pathname === "/shared/contracts.js",
      ),
      "the canonical capability contract was never loaded",
    );
    assert.ok(
      allResources.some(
        (url) => new URL(url).pathname === "/shared/project-identity.js",
      ),
      "the canonical contract dependency graph was incomplete",
    );
    assert.equal(
      await fixture.page.evaluate(async () =>
        (await fetch("shared/diagnostics.js")).status),
      404,
      "the renderer protocol exposed an unapproved shared module",
    );
  } finally {
    await closePackaged(fixture);
  }
}

async function assertToolboxFoundationLifecycle() {
  const fixture = await launchPackaged("gw-packaged-toolbox-foundation-", {
    nativeCursor: false,
  });
  try {
    await fixture.page.waitForFunction(() => {
      const { Module } = globalThis as PageGlobals;
      return typeof Module?.socket?.connect === "function";
    });
    const result = await fixture.page.evaluate(async ({
      bytes,
      layout,
      messages,
      tableSize,
    }) => {
      const memory = new WebAssembly.Memory({ initial: 256 });
      const view = new DataView(memory.buffer);
      const table = new WebAssembly.Table({
        initial: tableSize,
        maximum: tableSize,
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

      // The fixture uses the exact certified addresses for game globals and
      // the canonical per-build offsets for every link beneath them. High,
      // isolated synthetic allocations keep this graph disjoint from the
      // companion's private low-memory block.
      const game = Object.freeze({
        contexts: 0x70_0000,
        game: 0x70_1000,
        character: 0x70_2000,
        party: 0x70_3000,
        partyInfo: 0x70_4000,
        heroBuffer: 0x70_5000,
      });
      view.setUint32(layout.contextRoot, game.contexts, true);
      view.setUint32(
        game.contexts + layout.gameContextSlot * Uint32Array.BYTES_PER_ELEMENT,
        game.game,
        true,
      );
      view.setUint32(
        game.game + layout.characterContext,
        game.character,
        true,
      );
      view.setUint32(game.character + layout.mapId, 133, true);
      view.setUint32(game.character + layout.isExplorable, 0, true);
      view.setUint32(game.character + layout.currentMapId, 133, true);
      view.setUint32(game.character + layout.currentInstanceType, 0, true);
      view.setUint32(game.character + layout.playerNumber, 42, true);
      view.setUint32(game.game + layout.partyContext, game.party, true);
      view.setUint32(game.party + layout.playerParty, game.partyInfo, true);
      const heroArray = game.partyInfo + layout.partyHeroes;
      view.setUint32(heroArray, game.heroBuffer, true);
      view.setUint32(heroArray + 4, 2, true);
      view.setUint32(heroArray + 8, 2, true);
      view.setUint32(
        game.heroBuffer + layout.heroAgentId,
        77,
        true,
      );
      view.setUint32(
        game.heroBuffer + layout.heroOwnerPlayerId,
        42,
        true,
      );
      view.setUint32(game.heroBuffer + layout.heroId, 1, true);
      const otherHero = game.heroBuffer + layout.heroMemberStride;
      view.setUint32(otherHero + layout.heroAgentId, 88, true);
      view.setUint32(otherHero + layout.heroOwnerPlayerId, 99, true);
      view.setUint32(otherHero + layout.heroId, 2, true);

      const transitions: string[] = [];
      let installedCallback: CallableFunction | null = null;
      const globalValue = Object.getOwnPropertyDescriptor(
        WebAssembly.Global.prototype,
        "value",
      );
      if (typeof globalValue?.get !== "function"
        || typeof globalValue.set !== "function") {
        throw new Error("WebAssembly.Global.value is not instrumentable");
      }
      const readHook = () => Number(globalValue.get?.call(hookSlot));
      const toolboxCount = () =>
        document.querySelectorAll("#toolbox-foundation").length;
      const targetCount = () =>
        document.querySelectorAll("#enhancement-target").length;
      const requireStage = (valid: boolean, reason: string) => {
        if (!valid) throw new Error(`Toolbox lifecycle order: ${reason}`);
      };
      const setTable = table.set.bind(table);
      table.set = ((index: number, value: CallableFunction | null) => {
        if (index === tableSize - 1 && value === null) {
          requireStage(
            installedCallback !== null
              && table.get(index) === installedCallback
              && readHook() === 0
              && toolboxCount() === 0
              && targetCount() === 0
              && window.gwCompanionRuntime != null,
            "clear did not own a disabled, disposed installation",
          );
          setTable(index, value);
          requireStage(table.get(index) === null, "owned callback was not cleared");
          transitions.push("table-cleared");
          return;
        }
        setTable(index, value);
        if (index === tableSize - 1) {
          installedCallback = value;
          requireStage(
            value !== null
              && table.get(index) === value
              && readHook() === 0
              && toolboxCount() === 1
              && targetCount() === 0
              && window.gwCompanionRuntime == null,
            "callback publication did not precede runtime and hook publication",
          );
          transitions.push("table-published");
        }
      }) as typeof table.set;
      Object.defineProperty(hookSlot, "value", {
        configurable: true,
        enumerable: true,
        get: () => globalValue.get?.call(hookSlot),
        set: (value: number) => {
          const previous = readHook();
          globalValue.set?.call(hookSlot, value);
          if (value !== previous) {
            const enabling = value !== 0;
            requireStage(
              table.get(tableSize - 1) === installedCallback
                && toolboxCount() === 1
                && targetCount() === 0
                && window.gwCompanionRuntime != null
                && (enabling
                  ? transitions.at(-1) === "table-published"
                  : transitions.at(-1) === "enabled"),
              enabling
                ? "hook enabled before installation publication"
                : "hook disabled after owned state was released",
            );
            transitions.push(enabling ? "enabled" : "disabled");
          }
        },
      });

      const module = new WebAssembly.Module(Uint8Array.from(bytes));
      const specifier = "./enhancements.js";
      const { installEnhancements }:
        typeof import("../src/renderer/enhancements.ts") =
          await import(specifier);
      const runtime = await installEnhancements(
        {
          exports: {
            memory,
            __indirect_function_table: table,
            malloc,
            free,
            enhancement_hook_slot: hookSlot,
          },
        },
        module,
        // A fixed developer program replaces the saved selection: Toolbox
        // must include cursor and exclude target observation for this launch.
        { nativeCursor: false },
        "toolbox-foundation",
      );
      if (!runtime) throw new Error("Toolbox foundation did not install");
      const callback = table.get(tableSize - 1);
      if (typeof callback !== "function") {
        throw new Error("Toolbox callback was not published");
      }
      callback(0, 123, 0, 0, 0, 0);
      callback(1, 1, 2, 3, 4, 5);
      callback(2, messages.playerChat, 0xdead_beef, 0x7fff_fffd, 0, 0);
      callback(2, messages.showHeroPanel, 1, 0, 0, 0);
      callback(0, 124, 0, 0, 0, 0);

      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 2_000;
        const observe = () => {
          const projected = window.gwCompanionRuntime?.toolbox;
          if (
            projected?.status === "ready"
            && projected.playerChatCount === 1
            && projected.cursorEventCount === 1
            && projected.heroAvailable === true
            && projected.panelState === 2
          ) {
            resolve();
            return;
          }
          if (performance.now() >= deadline) {
            reject(new Error("Toolbox projection did not become ready"));
            return;
          }
          requestAnimationFrame(observe);
        };
        requestAnimationFrame(observe);
      });

      const root = document.getElementById("toolbox-foundation");
      const canvas = document.getElementById("canvas");
      const before = {
        allocations,
        companionStatePublished: window.gwCompanionState !== undefined,
        cursor: runtime.cursor,
        cursorStyle:
          canvas instanceof HTMLCanvasElement ? canvas.style.cursor : null,
        globalRuntimeIsRuntime: window.gwCompanionRuntime === runtime,
        hook: readHook(),
        kernelSha256: runtime.kernelSha256,
        readout: runtime.readout,
        runtimeFrozen: Object.isFrozen(runtime),
        runtimeKeys: Object.keys(runtime).sort(),
        scalar: {
          buildId: runtime.buildId,
          companionAbi: runtime.companionAbi,
          hertz: runtime.hertz,
          installation: runtime.installation,
          programId: runtime.programId,
          rejectedSnapshots: runtime.rejectedSnapshots,
          snapshotReads: runtime.snapshotReads,
          status: runtime.status,
        },
        tableOwns: table.get(tableSize - 1) === installedCallback,
        targetCount: document.querySelectorAll("#enhancement-target").length,
        toolbox: runtime.toolbox,
        toolboxCount: document.querySelectorAll("#toolbox-foundation").length,
        toolboxText: root?.textContent ?? null,
      };

      dispatchEvent(new Event("pagehide"));
      const after = {
        cursorStyle:
          canvas instanceof HTMLCanvasElement ? canvas.style.cursor : null,
        freed,
        hook: readHook(),
        runtime: window.gwCompanionRuntime,
        tableEmpty: table.get(tableSize - 1) === null,
        targetCount: document.querySelectorAll("#enhancement-target").length,
        toolboxCount: document.querySelectorAll("#toolbox-foundation").length,
        transitions,
      };
      return { after, before };
    }, {
      bytes: [...installableManifestModule(TOOLBOX_PROGRAM_CAPABILITIES)],
      layout: ENHANCEMENT_BUILD.layout,
      messages: {
        playerChat: ENHANCEMENT_BUILD.uiDispatcher.playerChatMessage,
        showHeroPanel: ENHANCEMENT_BUILD.uiDispatcher.showHeroPanelMessage,
      },
      tableSize: ENHANCEMENT_BUILD.tableSlot + 1,
    });

    assert.deepEqual(result.before.allocations, [
      { pointer: 0x1000, size: 65_536 },
      {
        pointer: TOOLBOX_CONFIG_POINTER,
        size: CONFIG_BYTES,
      },
      { pointer: TOOLBOX_CURSOR_POINTER, size: COMPANION_CURSOR_BYTES },
      { pointer: TOOLBOX_STATE_POINTER, size: COMPANION_TOOLBOX_BYTES },
    ]);
    assert.equal(result.before.companionStatePublished, false);
    assert.equal(result.before.globalRuntimeIsRuntime, true);
    assert.equal(result.before.hook, ENHANCEMENT_BUILD.tableSlot + 1);
    assert.match(result.before.kernelSha256, /^[0-9a-f]{64}$/u);
    assert.equal(result.before.readout, null);
    assert.equal(result.before.runtimeFrozen, true);
    assert.deepEqual(result.before.runtimeKeys, DEVELOPER_RUNTIME_KEYS);
    assert.deepEqual(result.before.scalar, {
      buildId: ENHANCEMENT_BUILD.buildId,
      companionAbi: 6,
      hertz: 0,
      installation: 1,
      programId: ENHANCEMENT_BUILD.programId,
      rejectedSnapshots: 0,
      snapshotReads: 0,
      status: "installed",
    });
    assert.equal(result.before.tableOwns, true);
    assert.equal(result.before.targetCount, 0);
    assert.equal(result.before.toolboxCount, 1);
    assert.match(
      result.before.toolboxText ?? "",
      /Player chat events · 1/u,
    );
    assert.match(
      result.before.toolboxText ?? "",
      /First owned hero · 1 \(1 owned\)/u,
    );
    assert.match(
      result.before.toolboxText ?? "",
      /Hero panel observed · shown/u,
    );
    assert.deepEqual(result.before.toolbox, {
      cursorEventCount: 1,
      firstHeroAgentId: 77,
      firstHeroId: 1,
      heroAvailable: true,
      heroCount: 1,
      panelState: 2,
      playerChatCount: 1,
      sequence: 10,
      status: "ready",
    });
    assert.deepEqual(result.before.cursor, {
      cssLength: 0,
      generation: 0,
      hidden: false,
      pixelHash: 0,
      valid: false,
    });
    assert.equal(result.before.cursorStyle, "");

    assert.deepEqual(result.after.freed, [
      TOOLBOX_STATE_POINTER,
      TOOLBOX_CURSOR_POINTER,
      TOOLBOX_CONFIG_POINTER,
      0x1000,
    ]);
    assert.equal(result.after.hook, 0);
    assert.equal(result.after.runtime, null);
    assert.equal(result.after.tableEmpty, true);
    assert.equal(result.after.targetCount, 0);
    assert.equal(result.after.toolboxCount, 0);
    assert.equal(result.after.cursorStyle, "");
    assert.deepEqual(result.after.transitions, [
      "table-published",
      "enabled",
      "disabled",
      "table-cleared",
    ]);
  } finally {
    await closePackaged(fixture);
  }
}

async function assertRollbackAfterTablePublication() {
  const fixture = await launchPackaged("gw-packaged-foundation-rollback-", {
    nativeCursor: false,
  });
  try {
    await fixture.page.waitForFunction(() => {
      const { Module } = globalThis as PageGlobals;
      return typeof Module?.socket?.connect === "function";
    });
    const result = await fixture.page.evaluate(async ({ bytes, tableSize }: {
      bytes: number[];
      tableSize: number;
    }) => {
      const memory = new WebAssembly.Memory({ initial: 256 });
      const table = new WebAssembly.Table({
        initial: tableSize,
        maximum: tableSize,
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
      const specifier = "./enhancements.js";
      const { installEnhancements }:
        typeof import("../src/renderer/enhancements.ts") =
          await import(specifier);
      const replacementResponse = await fetch("companion-kernel.wasm");
      if (!replacementResponse.ok) {
        throw new Error("replacement kernel is unavailable");
      }
      const replacementModule = await WebAssembly.compile(
        await replacementResponse.arrayBuffer(),
      );
      const immutableI32 = (value: number) => new WebAssembly.Global(
        { value: "i32", mutable: false },
        value,
      );
      const replacementMemory = new WebAssembly.Memory({ initial: 4 });
      const replacementInstance = await WebAssembly.instantiate(
        replacementModule,
        {
          env: {
            memory: replacementMemory,
            __indirect_function_table: new WebAssembly.Table({
              initial: 0,
              maximum: 0,
              element: "anyfunc",
            }),
            __memory_base: immutableI32(65_536),
            __stack_pointer: new WebAssembly.Global(
              { value: "i32", mutable: true },
              131_072,
            ),
            __table_base: immutableI32(0),
          },
        },
      );
      const replacement = replacementInstance.exports.companion_dispatch;
      if (typeof replacement !== "function") {
        throw new Error("replacement kernel has no dispatch callback");
      }
      const setTable = table.set.bind(table);
      let replaced = false;
      table.set = ((index: number, value: CallableFunction | null) => {
        if (index === tableSize - 1 && value !== null && !replaced) {
          replaced = true;
          setTable(index, replacement);
          return;
        }
        setTable(index, value);
      }) as typeof table.set;
      const requestFrame = globalThis.requestAnimationFrame;
      let rejected = false;
      try {
        globalThis.requestAnimationFrame = () => {
          throw new Error("intentional post-table failure");
        };
        await installEnhancements(
          {
            exports: {
              memory,
              __indirect_function_table: table,
              malloc,
              free,
              enhancement_hook_slot: hookSlot,
            },
          },
          module,
          { nativeCursor: false },
          "toolbox-foundation",
        );
      } catch {
        rejected = true;
      } finally {
        globalThis.requestAnimationFrame = requestFrame;
      }
      return {
        allocations,
        freed,
        hook: hookSlot.value,
        rejected,
        runtime: window.gwCompanionRuntime,
        readoutCount: globalThis.document.querySelectorAll(
          "#enhancement-target",
        ).length,
        replaced,
        replacementPreserved: table.get(tableSize - 1) === replacement,
        tableEmpty: table.get(tableSize - 1) === null,
        toolboxCount: globalThis.document.querySelectorAll(
          "#toolbox-foundation",
        ).length,
      };
    }, {
      bytes: [...installableManifestModule(TOOLBOX_PROGRAM_CAPABILITIES)],
      tableSize: ENHANCEMENT_BUILD.tableSlot + 1,
    });
    assert.deepEqual(result, {
      allocations: [
        { pointer: 0x1000, size: 65_536 },
        {
          pointer: TOOLBOX_CONFIG_POINTER,
          size: CONFIG_BYTES,
        },
        { pointer: TOOLBOX_CURSOR_POINTER, size: COMPANION_CURSOR_BYTES },
        { pointer: TOOLBOX_STATE_POINTER, size: COMPANION_TOOLBOX_BYTES },
      ],
      freed: [
        TOOLBOX_STATE_POINTER,
        TOOLBOX_CURSOR_POINTER,
        TOOLBOX_CONFIG_POINTER,
        0x1000,
      ],
      hook: 0,
      rejected: true,
      runtime: undefined,
      readoutCount: 0,
      replaced: true,
      replacementPreserved: true,
      tableEmpty: false,
      toolboxCount: 0,
    });
  } finally {
    await closePackaged(fixture);
  }
}

await assertPackagedOffSession();
await assertTargetReadoutLifecycle();
await assertToolboxFoundationLifecycle();
await assertRollbackAfterTablePublication();
console.log(
  "packaged Enhancement runtime proved isolation, target and Toolbox lifecycles, and post-table rollback",
);
