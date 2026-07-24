import {
  readToolboxSnapshot,
  TOOLBOX_SNAPSHOT_ABI,
  TOOLBOX_SNAPSHOT_BYTES,
} from "./toolbox-snapshot.js";

const CONFIG_WORDS = 16;

function decodeManifest(module) {
  const sections = WebAssembly.Module.customSections(module, "toolbox_manifest");
  if (sections.length !== 1) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(sections[0]));
    if (
      value?.transformAbi !== 2
      || value?.snapshotAbi !== TOOLBOX_SNAPSHOT_ABI
      || value?.snapshotBytes !== TOOLBOX_SNAPSHOT_BYTES
      || value?.configBytes !== CONFIG_WORDS * 4
      || !Number.isInteger(value?.tableSlot)
      || !Array.isArray(value?.layoutWords)
      || value.layoutWords.length !== CONFIG_WORDS
      || value.layoutWords.some(
        (word) => !Number.isInteger(word) || word < 0 || word > 0xffff_ffff,
      )
    ) {
      return null;
    }
    return Object.freeze(value);
  } catch {
    return null;
  }
}

function text(id, value) {
  const element = document.getElementById(id);
  if (!element || element.textContent === value) return 0;
  element.textContent = value;
  return 1;
}

function hidden(element, value) {
  if (!element || element.hidden === value) return 0;
  element.hidden = value;
  return 1;
}

function recordLifecycle(state) {
  if (state.status === "ready") {
    window.gwAutomation?.set(
      state.instanceType === 1 ? "game.explorable" : "game.outpost",
    );
  } else if (state.reason === "loading") {
    window.gwAutomation?.set("game.loading");
  } else if (state.status === "unsupported") {
    window.gwAutomation?.set("toolbox.unsupported");
  }
}

export function renderToolboxState(state) {
  const root = document.getElementById("toolbox");
  const target = document.getElementById("toolbox-target");
  if (!root || !target) return 0;
  let updates = 0;
  if (root.dataset.status !== state.status) {
    root.dataset.status = state.status;
    updates += 1;
  }
  if (state.status !== "ready") {
    return updates + hidden(root, true);
  }

  updates += text("toolbox-map-id", String(state.mapId));
  updates += text("toolbox-instance", state.instanceName);
  updates += text("toolbox-player-id", `Agent ${state.playerId}`);
  updates += text("toolbox-player-x", state.playerX.toFixed(1));
  updates += text("toolbox-player-y", state.playerY.toFixed(1));
  if (root.dataset.mapId !== String(state.mapId)) {
    root.dataset.mapId = String(state.mapId);
    updates += 1;
  }
  if (root.dataset.agentId !== String(state.playerId)) {
    root.dataset.agentId = String(state.playerId);
    updates += 1;
  }

  updates += hidden(target, !state.targetValid);
  if (state.targetValid) {
    updates += text("toolbox-target-id", `Agent ${state.targetId}`);
    updates += text("toolbox-target-type", state.targetKind);
    updates += text("toolbox-target-x", state.targetX.toFixed(1));
    updates += text("toolbox-target-y", state.targetY.toFixed(1));
    updates += text("toolbox-target-distance", state.distance.toFixed(0));
    updates += text("toolbox-target-range", state.rangeName);
    if (target.dataset.range !== String(state.rangeBand)) {
      target.dataset.range = String(state.rangeBand);
      updates += 1;
    }
    if (root.dataset.targetId !== String(state.targetId)) {
      root.dataset.targetId = String(state.targetId);
      updates += 1;
    }
  } else if ("targetId" in root.dataset) {
    delete root.dataset.targetId;
    updates += 1;
  }
  updates += hidden(root, false);
  return updates;
}

function mountRenderer(runtime) {
  const root = document.getElementById("toolbox");
  if (!root || !document.getElementById("toolbox-target")) return () => {};
  let frame = 0;
  let lastSequence = -1;
  let cadenceAt = performance.now();
  let cadenceTick = 0;

  const render = () => {
    const started = performance.now();
    const state = readToolboxSnapshot(
      runtime.memory.buffer,
      runtime.snapshotPointer,
    );
    recordLifecycle(state);
    runtime.snapshotReads += 1;
    if (state.reason === "writing" || state.reason === "snapshot") {
      runtime.rejectedSnapshots += 1;
    }
    window.gwToolboxState = state;
    if (state.sequence === lastSequence) {
      frame = requestAnimationFrame(render);
      return;
    }
    lastSequence = state.sequence ?? lastSequence;
    runtime.domUpdates += renderToolboxState(state);

    const now = performance.now();
    if (state.status === "ready" && now - cadenceAt >= 1_000) {
      runtime.hertz =
        ((state.tickCount - cadenceTick) * 1_000) / (now - cadenceAt);
      cadenceAt = now;
      cadenceTick = state.tickCount;
    }
    runtime.lastRenderUs = (performance.now() - started) * 1_000;
    runtime.renderSamples.push(runtime.lastRenderUs);
    if (runtime.renderSamples.length > 240) runtime.renderSamples.shift();
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);
  return () => cancelAnimationFrame(frame);
}

async function install(instance, module) {
  const manifest = decodeManifest(module);
  const exports = instance?.exports;
  if (
    !manifest
    || !(exports?.memory instanceof WebAssembly.Memory)
    || !(exports?.__indirect_function_table instanceof WebAssembly.Table)
    || typeof exports?.malloc !== "function"
    || typeof exports?.free !== "function"
    || typeof exports?.toolbox_tick_original !== "function"
    || !(exports?.toolbox_hook_slot instanceof WebAssembly.Global)
  ) {
    window.gwToolboxState = Object.freeze({ status: "unsupported" });
    return null;
  }

  const table = exports.__indirect_function_table;
  if (table.get(manifest.tableSlot) !== null) {
    throw new Error(`Toolbox table slot ${manifest.tableSlot} is occupied`);
  }

  let snapshotPointer = 0;
  let configPointer = 0;
  let stopRenderer = () => {};
  try {
    snapshotPointer = Number(exports.malloc(TOOLBOX_SNAPSHOT_BYTES));
    configPointer = Number(exports.malloc(manifest.configBytes));
    if (!snapshotPointer || !configPointer) throw new Error("Toolbox allocation failed");
    const config = new Uint32Array(
      exports.memory.buffer,
      configPointer,
      manifest.layoutWords.length,
    );
    config.set(manifest.layoutWords);

    const kernelBytes = await (await fetch("toolbox-kernel.wasm")).arrayBuffer();
    const kernel = await WebAssembly.instantiate(kernelBytes, {
      env: { memory: exports.memory },
      game: { toolbox_tick_original: exports.toolbox_tick_original },
    });
    if (
      typeof kernel.instance.exports.toolbox_init !== "function"
      || typeof kernel.instance.exports.toolbox_tick !== "function"
      || kernel.instance.exports.toolbox_init(
        snapshotPointer,
        TOOLBOX_SNAPSHOT_BYTES,
        configPointer,
        manifest.configBytes,
      ) !== 1
    ) {
      throw new Error("Toolbox kernel rejected its ABI");
    }

    table.set(manifest.tableSlot, kernel.instance.exports.toolbox_tick);
    exports.toolbox_hook_slot.value = manifest.tableSlot + 1;
    const runtime = {
      status: "installed",
      buildId: manifest.buildId,
      programId: manifest.programId,
      memory: exports.memory,
      snapshotPointer,
      configPointer,
      tableSlot: manifest.tableSlot,
      hertz: 0,
      lastRenderUs: 0,
      renderSamples: [],
      snapshotReads: 0,
      rejectedSnapshots: 0,
      domUpdates: 0,
      installation: (window.gwToolboxInstallations ?? 0) + 1,
      setHookEnabledForBenchmark(enabled) {
        exports.toolbox_hook_slot.value = enabled
          ? manifest.tableSlot + 1
          : 0;
      },
    };
    window.gwToolboxInstallations = runtime.installation;
    window.gwToolboxRuntime = runtime;
    stopRenderer = mountRenderer(runtime);

    const teardown = () => {
      stopRenderer();
      exports.toolbox_hook_slot.value = 0;
      if (table.get(manifest.tableSlot) === kernel.instance.exports.toolbox_tick) {
        table.set(manifest.tableSlot, null);
      }
      exports.free(configPointer);
      exports.free(snapshotPointer);
      window.gwToolboxRuntime = null;
    };
    window.addEventListener("pagehide", teardown, { once: true });
    console.info(`[toolbox] installed for client build ${manifest.buildId}`);
    return runtime;
  } catch (error) {
    exports.toolbox_hook_slot.value = 0;
    if (configPointer) exports.free(configPointer);
    if (snapshotPointer) exports.free(snapshotPointer);
    window.gwToolboxState = Object.freeze({
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

if (typeof window !== "undefined") {
  window.gwToolbox = Object.freeze({ install });
  window.dispatchEvent(new Event("gw-toolbox-ready"));
  const fixture = new URL(window.location.href).searchParams.get(
    "toolbox-fixture",
  );
  if (fixture === "map" || fixture === "target") {
    const state = Object.freeze({
      status: "ready",
      sequence: 2,
      tickCount: 120,
      mapId: 133,
      instanceType: 0,
      instanceName: "Outpost",
      playerId: 12,
      playerX: -10_101,
      playerY: 32_600,
      targetValid: fixture === "target",
      targetId: fixture === "target" ? 1 : 0,
      targetType: fixture === "target" ? 0xdb : 0,
      targetKind: fixture === "target" ? "Living" : "None",
      targetX: fixture === "target" ? -9_595 : 0,
      targetY: fixture === "target" ? 35_380 : 0,
      distance: fixture === "target" ? 2_825.7 : 0,
      rangeBand: fixture === "target" ? 7 : 0,
      rangeName: fixture === "target" ? "Compass" : "None",
    });
    window.gwToolboxState = state;
    recordLifecycle(state);
    renderToolboxState(state);
  }
}
