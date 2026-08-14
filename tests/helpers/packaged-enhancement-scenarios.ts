import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import {
  COMPANION_CURSOR_BYTES,
  COMPANION_PARTY_BYTES,
  COMPANION_TOOLBOX_BYTES,
} from "../../src/renderer/companion-snapshot.ts";
import { TEAM_COMMAND_PAYLOAD_BYTES } from "../../src/renderer/enhancement-team-commands.ts";
import { COMPANION_ABI } from "../../src/shared/companion-abi.ts";
import {
  closePackaged,
  CONFIG_BYTES,
  ENHANCEMENT_BUILD,
  installableManifestModule,
  launchPackaged,
  OBSERVER_RUNTIME_KEYS,
  type PageGlobals,
  PRODUCT_RUNTIME_KEYS,
  TARGET_OFF_PRODUCT_CAPABILITIES,
  type ReadoutPageGlobals,
  TARGET_ONLY,
  TOOLBOX_PROGRAM_CAPABILITIES,
  TOOLBOX_SNAPSHOT_POINTER,
} from "./packaged-enhancement-fixture.ts";

async function installTargetReadout(page: Page, moduleBytes: Uint8Array) {
  return page.evaluate(async ({ bytes, tableSize, capabilities }: {
    bytes: number[];
    tableSize: number;
    capabilities: typeof TARGET_ONLY;
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
    const specifier = "./certified-companion-installation.js";
    const { installCertifiedCompanion }:
      typeof import("../../src/renderer/certified-companion-installation.ts") =
      await import(specifier);
    globalThis.dispatchEvent(new Event("pagehide"));
    const runtime = await installCertifiedCompanion(
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
      capabilities,
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
      view.setUint16(4, 2, true);
      view.setUint16(6, 64, true);
      view.setUint32(12, target ? 7 : 3, true);
      view.setUint32(16, sequence, true);
      view.setUint32(20, 133, true);
      view.setUint32(24, 1 << 8, true);
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
    capabilities: TARGET_ONLY,
  });
}

export async function assertTargetReadoutLifecycle() {
  const fixture = await launchPackaged("gw-packaged-target-readout-", {
    gwonmacTools: true,
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
      { nativeCursor: true, tools: true },
    );

    assert.deepEqual(
      await installTargetReadout(
        fixture.page,
        installableManifestModule(TARGET_ONLY),
      ),
      {
        allocations: [
          65_551,
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
      freed: [0x1000, 0x11_010, 0x11_050],
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
          companionAbi: COMPANION_ABI.kernel,
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
    assert.ok(
      resources.some(
        (url) => new URL(url).pathname === "/companion-kernel.wasm",
      ),
      "the installed control never fetched the packaged Enhancement kernel",
    );
    assert.ok(
      resources.some((url) =>
        new URL(url).pathname === "/certified-companion-installation.js"),
      "the installed control never imported the packaged companion installer",
    );
    assert.ok(
      resources.some((url) => new URL(url).pathname === "/shared/contracts.js"),
      "the installed control never loaded the canonical capability contract",
    );
    assert.ok(
      resources.some(
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

export async function assertToolboxFoundationLifecycle() {
  const fixture = await launchPackaged("gw-packaged-toolbox-foundation-", {});
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
      capabilities,
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
        agentBuffer: 0x71_0000,
        player: 0x71_1000,
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
      const area = layout.areaInfo + 133 * layout.areaInfoStride;
      view.setUint32(area + 0x00, 1, true);
      view.setUint32(area + 0x04, 0, true);
      view.setUint32(area + 0x08, 0, true);
      view.setUint32(area + 0x0c, 13, true);
      view.setUint32(area + layout.areaInfoFlags, 0, true);
      view.setUint32(layout.agentArray, game.agentBuffer, true);
      view.setUint32(layout.agentArray + 4, 64, true);
      view.setUint32(layout.agentArray + 8, 64, true);
      view.setUint32(game.agentBuffer + 42 * 4, game.player, true);
      view.setUint32(game.player + layout.agentId, 42, true);
      view.setUint16(game.player + layout.agentPlayerNumber, 42, true);
      view.setUint16(game.player + layout.agentModelType, 0x3000, true);
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
              && window.gwCompanionRuntime == null,
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
              && toolboxCount() === 0
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
                && (enabling ? toolboxCount() === 0 : toolboxCount() <= 1)
                && targetCount() === 0
                && window.gwCompanionRuntime == null
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
      const specifier = "./certified-companion-installation.js";
      const { installCertifiedCompanion }:
        typeof import("../../src/renderer/certified-companion-installation.ts") =
          await import(specifier);
      globalThis.dispatchEvent(new Event("pagehide"));
      window.gwToolsSettings = () => Object.freeze({
        enabled: true,
        teamManagement: true,
        targetReadout: false,
      });
      const runtime = await installCertifiedCompanion(
        {
          exports: {
            memory,
            __indirect_function_table: table,
            malloc,
            free,
            enhancement_hook_slot: hookSlot,
            enhancement_command: () => 1,
            enhancement_profession_trace: () => 30,
          },
        },
        module,
        capabilities,
        "none",
      );
      if (!runtime) throw new Error("Toolbox foundation did not install");
      const callback = table.get(tableSize - 1);
      if (typeof callback !== "function") {
        throw new Error("Toolbox callback was not published");
      }
      callback(0, 123, 0, 0, 0, 0);
      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 2_000;
        const observe = () => {
          if (document.querySelectorAll("#toolbox-foundation").length === 1) {
            resolve();
          } else if (performance.now() >= deadline) {
            reject(new Error(
              `PvE policy did not enable the Toolbox: ${JSON.stringify({
                rejectedSnapshots: runtime.rejectedSnapshots,
                snapshotReads: runtime.snapshotReads,
                toolbox: runtime.toolbox,
              })}`,
            ));
          } else {
            requestAnimationFrame(observe);
          }
        };
        requestAnimationFrame(observe);
      });
      callback(1, 1, 2, 3, 4, 5);
      callback(2, messages.playerChat, 0xdead_beef, 0x7fff_fffd, 0, 0);
      callback(0, 124, 0, 0, 0, 0);

      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 2_000;
        const observe = () => {
          const projected = runtime.toolbox;
          if (
            projected?.status === "ready"
            && projected.playerChatCount === 1
            && projected.cursorEventCount === 1
            && projected.heroAvailable === true
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
      bytes: [...installableManifestModule(TARGET_OFF_PRODUCT_CAPABILITIES)],
      capabilities: TARGET_OFF_PRODUCT_CAPABILITIES,
      layout: {
        ...ENHANCEMENT_BUILD.observationBase!.layout,
        ...ENHANCEMENT_BUILD.cursorEvent!.layout,
        ...ENHANCEMENT_BUILD.partyObservation!.layout,
      },
      messages: {
        playerChat: ENHANCEMENT_BUILD.partyObservation!.playerChatMessage,
        showHeroPanel: ENHANCEMENT_BUILD.partyObservation!.showHeroPanelMessage,
      },
      tableSize: ENHANCEMENT_BUILD.tableSlot + 1,
    });

    const configPointer = TOOLBOX_SNAPSHOT_POINTER;
    const cursorPointer = (configPointer + CONFIG_BYTES + 7) & ~7;
    const statePointer = (cursorPointer + COMPANION_CURSOR_BYTES + 7) & ~7;
    const partyPointer = statePointer + COMPANION_TOOLBOX_BYTES;
    const commandPointer = partyPointer + COMPANION_PARTY_BYTES;
    assert.deepEqual(result.before.allocations, [
      { pointer: 0x1000, size: 65_551 },
      {
        pointer: configPointer,
        size: CONFIG_BYTES,
      },
      {
        pointer: cursorPointer,
        size: COMPANION_CURSOR_BYTES,
      },
      {
        pointer: statePointer,
        size: COMPANION_TOOLBOX_BYTES,
      },
      {
        pointer: partyPointer,
        size: COMPANION_PARTY_BYTES,
      },
      {
        pointer: commandPointer,
        size: TEAM_COMMAND_PAYLOAD_BYTES,
      },
    ]);
    assert.equal(result.before.companionStatePublished, false);
    assert.equal(result.before.globalRuntimeIsRuntime, false);
    assert.equal(result.before.hook, ENHANCEMENT_BUILD.tableSlot + 1);
    assert.match(result.before.kernelSha256, /^[0-9a-f]{64}$/u);
    assert.equal(result.before.readout, null);
    assert.equal(result.before.runtimeFrozen, true);
    assert.deepEqual(result.before.runtimeKeys, PRODUCT_RUNTIME_KEYS);
    const { snapshotReads, ...scalar } = result.before.scalar;
    assert.equal(snapshotReads, 0);
    assert.deepEqual(scalar, {
      buildId: ENHANCEMENT_BUILD.buildId,
      companionAbi: COMPANION_ABI.kernel,
      hertz: 0,
      installation: 1,
      programId: ENHANCEMENT_BUILD.programId,
      rejectedSnapshots: 0,
      status: "installed",
    });
    assert.equal(result.before.tableOwns, true);
    assert.equal(result.before.targetCount, 0);
    assert.equal(result.before.toolboxCount, 1);
    // The projection is the assertion. Three regexes used to read the same
    // numbers back off the overlay's own readout rows, which the overlay no
    // longer draws — a tool draws its own window now. Nothing is lost: the
    // deepEqual below already pins every value those regexes sampled, and it
    // pins them at the boundary the kernel actually publishes.
    const projection = result.before.toolbox;
    assert.ok(projection);
    const { party, ...toolbox } = projection;
    assert.deepEqual(toolbox, {
      cursorEventCount: 1,
      firstHeroAgentId: 77,
      firstHeroId: 1,
      heroAvailable: true,
      heroCount: 1,
      partyObserved: true,
      playerChatCount: 1,
      sequence: 8,
      status: "ready",
    });
    assert.equal(party?.status, "ready");
    assert.equal(party?.rosterObserved, true);
    assert.equal(party?.inOutpost, true);
    assert.equal(party?.playRegion, "pve");
    assert.equal(party?.hardMode, false);
    assert.equal(party?.slotCount, 1);
    assert.deepEqual(party?.slots?.[1], {
      index: 1,
      occupied: true,
      hero: 1,
      agentId: 77,
      level: null,
      professions: null,
      behaviour: null,
      skills: null,
      disabled: null,
      attributes: null,
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
      statePointer,
      partyPointer,
      commandPointer,
      cursorPointer,
      configPointer,
      0x1000,
    ]);
    assert.equal(result.after.hook, 0);
    assert.equal(result.after.runtime, undefined);
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

export async function assertRollbackAfterTablePublication() {
  const fixture = await launchPackaged("gw-packaged-foundation-rollback-", {});
  try {
    await fixture.page.waitForFunction(() => {
      const { Module } = globalThis as PageGlobals;
      return typeof Module?.socket?.connect === "function";
    });
    const result = await fixture.page.evaluate(async ({ bytes, tableSize, capabilities }: {
      bytes: number[];
      tableSize: number;
      capabilities: typeof TOOLBOX_PROGRAM_CAPABILITIES;
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
      const specifier = "./certified-companion-installation.js";
      const { installCertifiedCompanion }:
        typeof import("../../src/renderer/certified-companion-installation.ts") =
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
        globalThis.dispatchEvent(new Event("pagehide"));
        window.gwToolsSettings = () => Object.freeze({
          enabled: true,
          teamManagement: true,
          targetReadout: false,
        });
        globalThis.requestAnimationFrame = () => {
          throw new Error("intentional post-table failure");
        };
        await installCertifiedCompanion(
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
          capabilities,
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
      bytes: [...installableManifestModule({
        ...TOOLBOX_PROGRAM_CAPABILITIES,
        nativeCursor: false,
      })],
      capabilities: { ...TOOLBOX_PROGRAM_CAPABILITIES, nativeCursor: false },
      tableSize: ENHANCEMENT_BUILD.tableSlot + 1,
    });
    const rollbackConfigPointer = 0x11_010;
    const rollbackToolboxPointer =
      (rollbackConfigPointer + CONFIG_BYTES + 7) & ~7;
    const rollbackPartyPointer =
      rollbackToolboxPointer + COMPANION_TOOLBOX_BYTES;
    assert.deepEqual(result, {
      allocations: [
        { pointer: 0x1000, size: 65_551 },
        {
          pointer: rollbackConfigPointer,
          size: CONFIG_BYTES,
        },
        { pointer: rollbackToolboxPointer, size: COMPANION_TOOLBOX_BYTES },
        { pointer: rollbackPartyPointer, size: COMPANION_PARTY_BYTES },
      ],
      freed: [
        rollbackToolboxPointer,
        rollbackPartyPointer,
        rollbackConfigPointer,
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
