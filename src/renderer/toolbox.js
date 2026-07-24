const MAGIC = 0x42545747;
const SNAPSHOT_ABI = 1;
const SNAPSHOT_BYTES = 64;
const CONFIG_FIELDS = Object.freeze([
  "contextRoot",
  "agentArray",
  "targetAgentId",
  "gameContextSlot",
  "characterContext",
  "mapId",
  "isExplorable",
  "currentMapId",
  "currentInstanceType",
  "playerNumber",
  "agentId",
  "agentX",
  "agentY",
  "agentType",
  "agentPlayerNumber",
  "agentModelType",
]);
const INSTANCE_NAMES = Object.freeze(["Outpost", "Explorable", "Loading"]);
const RANGE_NAMES = Object.freeze([
  "None",
  "Adjacent",
  "Nearby",
  "Area",
  "Earshot",
  "Spellcast",
  "Spirit",
  "Compass",
  "Beyond compass",
]);

const FLAGS = Object.freeze({
  ready: 1 << 0,
  player: 1 << 1,
  target: 1 << 2,
  loading: 1 << 3,
});

function decodeManifest(module) {
  const sections = WebAssembly.Module.customSections(module, "toolbox_manifest");
  if (sections.length !== 1) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(sections[0]));
    if (
      value?.transformAbi !== 1
      || value?.snapshotAbi !== SNAPSHOT_ABI
      || value?.snapshotBytes !== SNAPSHOT_BYTES
      || value?.configBytes !== CONFIG_FIELDS.length * 4
      || !Number.isInteger(value?.tableSlot)
      || !value?.layout
      || CONFIG_FIELDS.some((field) => !Number.isInteger(value.layout[field]))
    ) {
      return null;
    }
    return Object.freeze(value);
  } catch {
    return null;
  }
}

function stableFloat(value) {
  return Number.isFinite(value) ? value : 0;
}

export function readToolboxSnapshot(buffer, pointer) {
  if (
    !(buffer instanceof ArrayBuffer)
    || !Number.isInteger(pointer)
    || pointer < 0
    || pointer + SNAPSHOT_BYTES > buffer.byteLength
  ) {
    return Object.freeze({ status: "waiting", reason: "memory" });
  }
  const view = new DataView(buffer, pointer, SNAPSHOT_BYTES);
  const firstSequence = view.getUint32(8, true);
  if ((firstSequence & 1) !== 0) {
    return Object.freeze({ status: "waiting", reason: "writing" });
  }
  const magic = view.getUint32(0, true);
  const abi = view.getUint16(4, true);
  const byteLength = view.getUint16(6, true);
  const flags = view.getUint32(12, true);
  const state = {
    sequence: firstSequence,
    tickCount: view.getUint32(16, true),
    mapId: view.getUint32(20, true),
    instanceType: view.getUint32(24, true),
    playerId: view.getUint32(28, true),
    playerX: stableFloat(view.getFloat32(32, true)),
    playerY: stableFloat(view.getFloat32(36, true)),
    targetId: view.getUint32(40, true),
    targetType: view.getUint32(44, true),
    targetX: stableFloat(view.getFloat32(48, true)),
    targetY: stableFloat(view.getFloat32(52, true)),
    distance: stableFloat(view.getFloat32(56, true)),
    rangeBand: view.getUint32(60, true),
  };
  const secondSequence = view.getUint32(8, true);
  if (
    magic !== MAGIC
    || abi !== SNAPSHOT_ABI
    || byteLength !== SNAPSHOT_BYTES
    || firstSequence !== secondSequence
    || (secondSequence & 1) !== 0
  ) {
    return Object.freeze({ status: "waiting", reason: "snapshot" });
  }
  if ((flags & FLAGS.loading) !== 0) {
    return Object.freeze({
      status: "waiting",
      reason: "loading",
      sequence: secondSequence,
      tickCount: state.tickCount,
    });
  }
  if ((flags & (FLAGS.ready | FLAGS.player)) !== (FLAGS.ready | FLAGS.player)) {
    return Object.freeze({
      status: "waiting",
      reason: "game",
      sequence: secondSequence,
      tickCount: state.tickCount,
    });
  }
  const targetValid = (flags & FLAGS.target) !== 0;
  return Object.freeze({
    status: "ready",
    ...state,
    instanceName: INSTANCE_NAMES[state.instanceType] ?? "Unknown",
    targetValid,
    targetKind: targetValid ? agentKind(state.targetType) : "None",
    rangeName: RANGE_NAMES[state.rangeBand] ?? "Unknown",
  });
}

function agentKind(type) {
  if ((type & 0x400) !== 0) return "Item";
  if ((type & 0x200) !== 0) return "Gadget";
  if ((type & 0xdb) !== 0) return "Living";
  return "Unknown";
}

function text(id, value) {
  const element = document.getElementById(id);
  if (element && element.textContent !== value) element.textContent = value;
}

function mountRenderer(runtime) {
  const root = document.getElementById("toolbox");
  const target = document.getElementById("toolbox-target");
  if (!root || !target) return () => {};
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
    window.gwToolboxState = state;
    root.dataset.status = state.status;
    if (state.sequence === lastSequence) {
      frame = requestAnimationFrame(render);
      return;
    }
    lastSequence = state.sequence ?? lastSequence;
    if (state.status !== "ready") {
      root.hidden = true;
      frame = requestAnimationFrame(render);
      return;
    }

    text("toolbox-map-id", String(state.mapId));
    text("toolbox-instance", state.instanceName);
    text("toolbox-player-id", `Agent ${state.playerId}`);
    text("toolbox-player-x", state.playerX.toFixed(1));
    text("toolbox-player-y", state.playerY.toFixed(1));
    root.dataset.mapId = String(state.mapId);
    root.dataset.agentId = String(state.playerId);

    target.hidden = !state.targetValid;
    if (state.targetValid) {
      text("toolbox-target-id", `Agent ${state.targetId}`);
      text("toolbox-target-type", state.targetKind);
      text("toolbox-target-x", state.targetX.toFixed(1));
      text("toolbox-target-y", state.targetY.toFixed(1));
      text("toolbox-target-distance", state.distance.toFixed(0));
      text("toolbox-target-range", state.rangeName);
      target.dataset.range = String(state.rangeBand);
      root.dataset.targetId = String(state.targetId);
    } else {
      delete root.dataset.targetId;
    }

    const now = performance.now();
    if (now - cadenceAt >= 1_000) {
      runtime.hertz =
        ((state.tickCount - cadenceTick) * 1_000) / (now - cadenceAt);
      cadenceAt = now;
      cadenceTick = state.tickCount;
    }
    runtime.lastRenderUs = (performance.now() - started) * 1_000;
    root.hidden = false;
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
    snapshotPointer = Number(exports.malloc(SNAPSHOT_BYTES));
    configPointer = Number(exports.malloc(CONFIG_FIELDS.length * 4));
    if (!snapshotPointer || !configPointer) throw new Error("Toolbox allocation failed");
    const config = new Uint32Array(
      exports.memory.buffer,
      configPointer,
      CONFIG_FIELDS.length,
    );
    CONFIG_FIELDS.forEach((field, index) => {
      config[index] = manifest.layout[field];
    });

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
        SNAPSHOT_BYTES,
        configPointer,
        CONFIG_FIELDS.length * 4,
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
    };
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
}
