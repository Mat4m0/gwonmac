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
import type { PublishedClientManifest } from "../../src/main/core/published-client.ts";
import {
  type AppSettingsPatch,
} from "../../src/shared/contracts.ts";
import {
  ENHANCEMENT_CONFIG_WORD_COUNT,
  ENHANCEMENT_TRANSFORM_ABI,
  enhancementHooksFor,
  type EnhancementCapabilities,
} from "../../src/shared/enhancement-contracts.ts";
import { stopChildProcess } from "./child-process.ts";
// The canonical tables, not their emitted copies. `pnpm typecheck` runs before
// `pnpm build` in `pnpm verify`, so a static import of `build/` here would make
// checking depend on output that may not exist yet — the dependency Phase 0b
// removed from the tooling scripts for the same reason. The packaged app under
// test is built from these same sources.
import {
  ENHANCEMENT_BUILDS,
  enhancementConfigWords,
} from "../../src/main/certification/enhancement-builds.ts";
import {
  COMPANION_CURSOR_BYTES,
  COMPANION_SNAPSHOT_BYTES,
  COMPANION_TOOLBOX_BYTES,
} from "../../src/renderer/companion-snapshot.ts";
import { root } from "../electron/fixtures.mts";
import {
  DISTRIBUTION_CHANNEL_CONFIG,
} from "../../src/shared/distribution-channel.ts";
import { resolvePackageMode } from "../../scripts/package-mode.ts";

/**
 * The host `Module` the renderer publishes for ArenaNet's generated glue. Only
 * what this file drives is named — `src/renderer/harness.ts` owns the object,
 * and the glue's own surface is ArenaNet's.
 */
export interface HostModule {
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
export interface TargetReadoutFixture {
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
export type PageGlobals = typeof globalThis & { Module?: HostModule };

/** The same page once `installTargetReadout` has published its probe. */
export type ReadoutPageGlobals = PageGlobals & {
  __targetReadoutFixture: TargetReadoutFixture;
};

export const packageMode = resolvePackageMode(process.env.GW_PACKAGE_INTENT);
export const productName =
  DISTRIBUTION_CHANNEL_CONFIG[packageMode.productChannel].productName;
export const packagedExecutable = path.join(
  root,
  `out/${productName}-darwin-${process.arch}/${productName}.app/Contents/MacOS/${productName}`,
);
assert.ok(
  existsSync(packagedExecutable),
  `packaged app is missing at ${packagedExecutable}; run pnpm package first`,
);

export const OFFICIAL_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);
export const OFFICIAL_SHA256 = createHash("sha256")
  .update(OFFICIAL_WASM)
  .digest("hex");
// `assert.fail` returns `never`, so this is the build itself rather than an
// optional every function below would have to re-narrow.
export const ENHANCEMENT_BUILD =
  ENHANCEMENT_BUILDS[0] ?? assert.fail("the canonical Enhancement build table is empty");
export const TARGET_ONLY: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: true,
  toolbox: false,
  commands: false,
});
export const TOOLBOX_PROGRAM_CAPABILITIES: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  toolbox: true,
  commands: false,
});
export const PRODUCT_TOOLS_CAPABILITIES: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: true,
  toolbox: true,
  commands: true,
});
export const CONFIG_BYTES =
  ENHANCEMENT_CONFIG_WORD_COUNT * Uint32Array.BYTES_PER_ELEMENT;
export const TOOLBOX_SNAPSHOT_POINTER = 0x11_010;
export const TOOLBOX_CONFIG_POINTER = TOOLBOX_SNAPSHOT_POINTER + COMPANION_SNAPSHOT_BYTES;
export const TOOLBOX_CURSOR_POINTER = (TOOLBOX_CONFIG_POINTER + CONFIG_BYTES + 7) & ~7;
export const TOOLBOX_STATE_POINTER =
  (TOOLBOX_CURSOR_POINTER + COMPANION_CURSOR_BYTES + 7) & ~7;
export const TOOLBOX_PARTY_POINTER = TOOLBOX_STATE_POINTER + COMPANION_TOOLBOX_BYTES;
export const DEVELOPER_RUNTIME_KEYS = Object.freeze([
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
export const PRODUCT_RUNTIME_KEYS = Object.freeze([
  ...DEVELOPER_RUNTIME_KEYS,
  "addHero",
  "cancelPending",
  "kickHero",
  "setHardMode",
  "setHeroAttributes",
  "setHeroBehaviour",
  "setHeroSecondary",
  "setHeroSkills",
  "setPlayerAttributes",
  "setPlayerSecondary",
  "setPlayerSkills",
].sort());
// The readout fixture drives the bundled installer as the target-observer
// program — the only path to the readout since the user setting retired — and
// that program alone carries the explicit benchmark hook control.
export const OBSERVER_RUNTIME_KEYS = Object.freeze(
  [...DEVELOPER_RUNTIME_KEYS, "setHookEnabledForBenchmark"].sort(),
);
export const SNAPSHOT_BYTES = Uint8Array.of(0);
export const SNAPSHOT_HASH = createHash("md5")
  .update(SNAPSHOT_BYTES)
  .digest("hex");
export const SYNTHETIC_GLUE = [
  "Module.instantiateWasm({ env: {} }, function () {",
  "  Module.onRuntimeInitialized();",
  "});",
].join("\n");

export function uleb(value: number) {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

export function customSectionModule(nameText: string, payload: number[] = []) {
  const name = [...new TextEncoder().encode(nameText)];
  const body = [...uleb(name.length), ...name, ...payload];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x00, ...uleb(body.length), ...body,
  ]);
}

export function manifestMarkerModule() {
  // Runtime init gates only on the served module carrying this section. It
  // deliberately has no modeled payload: the off-selection proof must not
  // accidentally depend on the renderer accepting a synthetic ABI record.
  return customSectionModule("enhancement_manifest");
}

export function installableManifestModule(
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

export function enhancementResource(url: string) {
  const pathname = new URL(url).pathname;
  return /^\/enhancement(?:-[a-z-]+)?\.(?:js|wasm)$/u.test(pathname);
}

export async function reservePort() {
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

export async function connectCdp(port: number, child: ChildProcess, output: string[]) {
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

export async function rendererPage(
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
export interface LaunchPaths {
  artifacts: string;
  userData: string;
}

export interface LaunchOptions {
  cachedOnly?: boolean;
  prepare?: (paths: LaunchPaths) => Promise<void>;
}

export async function launchPackaged(
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

export type PackagedFixture = Awaited<ReturnType<typeof launchPackaged>>;

export async function closePackaged(fixture: PackagedFixture) {
  await fixture.browser.close().catch(() => undefined);
  await stopChildProcess(fixture.child);
  await rm(fixture.userData, { recursive: true, force: true });
}

export async function driveHarnessRuntime(page: Page) {
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

export async function seedCachedClient({ artifacts, userData }: LaunchPaths) {
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

export async function assertPackagedOffSession() {
  const fixture = await launchPackaged(
    "gw-packaged-enhancement-off-",
    {
      compatibilityNoticeSeenFor: OFFICIAL_SHA256,
      dataStrategy: "quick",
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
        development: false,
        enhancementProgram: "none",
        enhancementSelection: {
          nativeCursor: true,
          tools: false,
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
    // and proves that module metadata still gates Core installation.
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
      [
        "gw://app/enhancement-cursor.js",
        "gw://app/enhancement-readout.js",
        "gw://app/enhancement-manifest.js",
        "gw://app/enhancement-runtime-policy.js",
      ],
      "required Core did not stop at the unproved module manifest",
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
