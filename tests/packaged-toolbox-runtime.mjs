import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
import {
  TOOLBOX_BUILDS,
  toolboxLayoutWords,
} from "../build/main/core/toolbox-builds.js";
import {
  TOOLBOX_CURSOR_ABI,
  TOOLBOX_CURSOR_BYTES,
  TOOLBOX_SNAPSHOT_ABI,
  TOOLBOX_SNAPSHOT_BYTES,
} from "../build/renderer/toolbox-snapshot.js";
import { root } from "./electron/fixtures.mjs";

const packagedExecutable = path.join(
  root,
  `out/Guild Wars-darwin-${process.arch}/Guild Wars.app/Contents/MacOS/Guild Wars`,
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
const TOOLBOX_BUILD = TOOLBOX_BUILDS[0];
assert.ok(TOOLBOX_BUILD, "the canonical Toolbox build table is empty");
const LAYOUT_WORDS = toolboxLayoutWords(TOOLBOX_BUILD.layout);
const SNAPSHOT_BYTES = Uint8Array.of(0);
const SNAPSHOT_HASH = createHash("md5")
  .update(SNAPSHOT_BYTES)
  .digest("hex");
const SYNTHETIC_GLUE = [
  "Module.instantiateWasm({ env: {} }, function () {",
  "  Module.onRuntimeInitialized();",
  "});",
].join("\n");

function uleb(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

function customSectionModule(nameText, payload = []) {
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
  return customSectionModule("toolbox_manifest");
}

function installableManifestModule() {
  const manifest = [...new TextEncoder().encode(JSON.stringify({
    snapshotAbi: TOOLBOX_SNAPSHOT_ABI,
    snapshotBytes: TOOLBOX_SNAPSHOT_BYTES,
    cursorSnapshotAbi: TOOLBOX_CURSOR_ABI,
    cursorSnapshotBytes: TOOLBOX_CURSOR_BYTES,
    configBytes: LAYOUT_WORDS.length * Uint32Array.BYTES_PER_ELEMENT,
    buildId: TOOLBOX_BUILD.buildId,
    programId: TOOLBOX_BUILD.programId,
    tableSlot: TOOLBOX_BUILD.tableSlot,
    layoutWords: LAYOUT_WORDS,
  }))];
  return customSectionModule("toolbox_manifest", manifest);
}

function toolboxResource(url) {
  const pathname = new URL(url).pathname;
  return /^\/toolbox(?:-[a-z-]+)?\.(?:js|wasm)$/u.test(pathname);
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return address.port;
}

async function connectCdp(port, child, output) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  let lastError;
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

async function rendererPage(browser, child, output) {
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

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function launchPackaged(
  prefix,
  settings,
  {
    cachedOnly = false,
    prepare = async () => undefined,
  } = {},
) {
  const userData = await mkdtemp(path.join(tmpdir(), prefix));
  const artifacts = path.join(userData, "game", "artifacts");
  try {
    await mkdir(artifacts, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(userData, "settings.json"),
        JSON.stringify(settings),
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
  const output = [];
  const env = {
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
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
    ],
    {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (data) => output.push(data.toString()));
  child.stderr.on("data", (data) => output.push(data.toString()));

  let browser;
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

async function closePackaged(fixture) {
  await fixture.browser.close().catch(() => undefined);
  await stopProcess(fixture.child);
  await rm(fixture.userData, { recursive: true, force: true });
}

async function driveHarnessRuntime(page) {
  await page.waitForFunction(
    () =>
      typeof globalThis.Module?.instantiateWasm === "function"
      && typeof globalThis.Module?.socket?.connect === "function",
  );
  return page.evaluate(() =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("synthetic game module did not instantiate")),
        10_000,
      );
      globalThis.Module.instantiateWasm(
        { env: {} },
        (instance, module) => {
          clearTimeout(timeout);
          resolve({
            manifestSections: WebAssembly.Module.customSections(
              module,
              "toolbox_manifest",
            ).length,
            toolboxHookExports: WebAssembly.Module.exports(module)
              .filter((entry) => entry.name.startsWith("toolbox_"))
              .map((entry) => entry.name),
          });
        },
      );
    }),
  );
}

async function seedCachedClient({ artifacts, userData }) {
  const game = path.join(userData, "game");
  const chunks = path.join(game, "chunks");
  const compatibility = path.join(game, "compatibility", "stale", "0");
  const toolbox = path.join(game, "toolbox", "stale", "0");
  await Promise.all([
    mkdir(chunks, { recursive: true }),
    mkdir(compatibility, { recursive: true }),
    mkdir(toolbox, { recursive: true }),
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
    writeFile(path.join(toolbox, "Gw.jspi.wasm"), "stale Toolbox output"),
  ]);
}

async function assertPackagedOffSession() {
  const fixture = await launchPackaged(
    "gw-packaged-toolbox-off-",
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
    const resources = [];
    fixture.page.on("request", (request) => resources.push(request.url()));
    await fixture.page.waitForFunction(async () => {
      const progress = await globalThis.gwNative.progress.current();
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
      await fixture.page.evaluate(() => globalThis.gwNative.init),
      {
        toolboxAutomation: false,
        toolboxSelection: {
          nativeCursor: false,
          targetReadout: false,
        },
        templateFsTrace: false,
      },
    );

    const session = await fixture.page.evaluate(() =>
      globalThis.gwNative.client.session());
    assert.equal(session.compatibility?.state, "uncertified");
    assert.equal(session.compatibility?.toolboxActive, false);
    assert.match(
      session.compatibility?.clientSha256 ?? "",
      /^[a-f0-9]{64}$/u,
    );

    const sealedManifest = JSON.parse(
      await readFile(path.join(fixture.artifacts, "manifest.json"), "utf8"),
    );
    assert.equal(sealedManifest.formatVersion, 1);
    assert.match(sealedManifest.clientFingerprint, /^[a-f0-9]{64}$/u);
    assert.deepEqual(
      sealedManifest.artifacts.map((artifact) => artifact.name),
      ["Gw.jspi.js", "Gw.jspi.wasm", "version.json"],
    );
    await Promise.all([
      assert.rejects(
        stat(path.join(fixture.userData, "game", "compatibility")),
        { code: "ENOENT" },
      ),
      assert.rejects(
        stat(path.join(fixture.userData, "game", "toolbox")),
        { code: "ENOENT" },
      ),
    ]);

    const served = await driveHarnessRuntime(fixture.page);
    assert.deepEqual(served, {
      manifestSections: 0,
      toolboxHookExports: [],
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
    // and the all-false launch selection is the sole reason Toolbox stays dark.
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
      toolboxHookExports: [],
    });
    await fixture.page.evaluate(() => {
      globalThis.Module.onRuntimeInitialized();
      return new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve)));
    });

    const performanceResources = await fixture.page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name));
    const allResources = [...resources, ...performanceResources];
    assert.ok(
      allResources.some((url) => new URL(url).pathname === "/Gw.jspi.wasm"),
      "the runtime-init proof never fetched the served game module",
    );
    assert.deepEqual(
      [...new Set(allResources.filter(toolboxResource))],
      [],
      "an all-tools-off packaged runtime loaded Toolbox code or its kernel",
    );
    assert.deepEqual(
      await fixture.page.evaluate(() => ({
        installations: globalThis.gwToolboxInstallations,
        runtime: globalThis.gwToolboxRuntime,
        state: globalThis.gwToolboxState,
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

async function installTargetReadout(page, moduleBytes) {
  return page.evaluate(async (bytes) => {
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
    const allocations = [];
    const freed = [];
    let nextPointer = 0x1000;
    const malloc = (size) => {
      const pointer = nextPointer;
      nextPointer = (nextPointer + size + 7) & ~7;
      allocations.push({ pointer, size });
      return pointer;
    };
    const free = (pointer) => freed.push(pointer);
    const module = new WebAssembly.Module(Uint8Array.from(bytes));
    const { installToolbox } = await import("./toolbox.js");
    const runtime = await installToolbox(
      {
        exports: {
          memory,
          __indirect_function_table: table,
          malloc,
          free,
          toolbox_tick_original: () => undefined,
          toolbox_hook_slot: hookSlot,
        },
      },
      module,
      { nativeCursor: false, targetReadout: true },
      false,
    );
    if (!runtime) throw new Error("target readout did not install");

    let sequence = 0;
    const publish = ({ distance = 130.8, rangeBand = 1, target = true } = {}) => {
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
    globalThis.__targetReadoutFixture = {
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
    const resources = [];
    fixture.page.on("request", (request) => resources.push(request.url()));
    await fixture.page.waitForFunction(
      () => typeof globalThis.Module?.socket?.connect === "function",
    );
    assert.deepEqual(
      await fixture.page.evaluate(
        () => globalThis.gwNative.init.toolboxSelection,
      ),
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
      await fixture.page.locator("#toolbox-target").count(),
      1,
      "installToolbox did not mount the target readout",
    );

    await fixture.page.evaluate(() =>
      globalThis.__targetReadoutFixture.publish());
    await fixture.page.locator("#toolbox-target").waitFor({ state: "visible" });
    assert.equal(
      await fixture.page.locator("#toolbox-target").innerText(),
      "TARGET\n131\nAdjacent",
    );

    await fixture.page.evaluate(() =>
      globalThis.__targetReadoutFixture.publish({
        distance: 1_001.2,
        rangeBand: 5,
      }));
    await fixture.page.waitForFunction(
      () =>
        globalThis.gwToolboxRuntime?.readout?.line
        === "1001 Spellcast",
    );
    assert.equal(
      await fixture.page.locator("#toolbox-target").innerText(),
      "TARGET\n1001\nSpellcast",
    );

    await fixture.page.evaluate(() =>
      globalThis.__targetReadoutFixture.publish({ target: false }));
    await fixture.page.locator("#toolbox-target").waitFor({ state: "hidden" });

    const disposed = await fixture.page.evaluate(() => {
      globalThis.dispatchEvent(new globalThis.Event("pagehide"));
      const probe = globalThis.__targetReadoutFixture;
      return {
        freed: [...probe.freed].sort((left, right) => left - right),
        hook: probe.hookSlot.value,
        runtime: globalThis.gwToolboxRuntime,
        tableEmpty: probe.table.get(0) === null,
      };
    });
    assert.equal(
      await fixture.page.locator("#toolbox-target").count(),
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
        (url) => new URL(url).pathname === "/toolbox-kernel.wasm",
      ),
      "the installed control never fetched the packaged Toolbox kernel",
    );
    assert.ok(
      resources.some((url) => new URL(url).pathname === "/toolbox.js"),
      "the installed control never imported the packaged Toolbox runtime",
    );
  } finally {
    await closePackaged(fixture);
  }
}

await assertPackagedOffSession();
await assertTargetReadoutLifecycle();
console.log(
  "packaged Toolbox runtime proved all-tools-off isolation and target-readout lifecycle",
);
