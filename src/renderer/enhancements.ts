import type { EnhancementSelection } from "../shared/contracts.js";
import {
  ATTRIBUTES,
  PROFESSIONS,
  PROFESSION_NONE_ID,
} from "../shared/builds/heroes.js";
import type {
  TeamApplyPlan,
  TeamApplyResult,
} from "../shared/builds/team-apply.js";
import type {
  Attribute,
  AttributeRank,
} from "../shared/builds/library.js";
import { createCursorConsumer } from "./enhancement-cursor.js";
import { createTargetReadout } from "./enhancement-readout.js";
import {
  readCompanionSnapshot,
  readCompanionTeam,
  COMPANION_CURSOR_ABI,
  COMPANION_CURSOR_BYTES,
  COMPANION_TEAM_ABI,
  COMPANION_TEAM_BYTES,
  COMPANION_SNAPSHOT_ABI,
  COMPANION_SNAPSHOT_BYTES,
} from "./companion-snapshot.js";
import { inspectCompanionKernel } from "./companion-kernel-relocation.js";

const ENHANCEMENT_FEATURE_NATIVE_CURSOR = 1 << 0;
const ENHANCEMENT_FEATURE_TARGET_READOUT = 1 << 1;
const ENHANCEMENT_FEATURE_TEAM_MANAGEMENT = 1 << 2;
// The kernel imports Guild Wars' memory. Rust otherwise places its private
// stack at a fixed 1 MiB address inside that memory, where a sufficiently large
// frame overwrites live client state. Reserve one game-heap allocation and move
// the exported stack pointer there before calling any kernel function.
const COMPANION_STACK_BYTES = 64 * 1024;
const COMPANION_STACK_ALIGNMENT = 16;
const TEAM_PLAN_BYTES = 1296;
const TEAM_PLAN_HEADER_BYTES = 16;
const TEAM_PLAN_MEMBER_BYTES = 160;
const PLAYER_BEHAVIOR = 0xffff_ffff;
const BEHAVIOR = Object.freeze({
  fight: 0,
  guard: 1,
  avoid: 2,
});
const TEAM_MODE = Object.freeze({
  none: 0,
  normal: 1,
  hard: 2,
});

function writeTeamPlan(
  memory: WebAssembly.Memory,
  pointer: number,
  plan: TeamApplyPlan,
) {
  if (plan.members.length < 1 || plan.members.length > 8) {
    throw new Error("team plan must contain the player and at most seven heroes");
  }
  new Uint8Array(memory.buffer, pointer, TEAM_PLAN_BYTES).fill(0);
  const view = new DataView(memory.buffer);
  view.setUint32(pointer, plan.members.length, true);
  view.setUint32(pointer + 4, TEAM_MODE[plan.mode], true);
  const seen = new Set<number>();
  for (const [index, member] of plan.members.entries()) {
    const base =
      pointer + TEAM_PLAN_HEADER_BYTES + index * TEAM_PLAN_MEMBER_BYTES;
    const heroId = member.hero === null ? 0 : Number(member.hero);
    if (
      (index === 0 && heroId !== 0) ||
      (index > 0 &&
        (!Number.isInteger(heroId) ||
          heroId < 1 ||
          heroId > 39 ||
          seen.has(heroId)))
    ) {
      throw new Error("team plan contains an invalid hero assignment");
    }
    if (index > 0) seen.add(heroId);
    if (
      (index === 0 && member.behaviour !== null) ||
      (index > 0 && member.behaviour === null)
    ) {
      throw new Error("team plan contains an invalid behavior assignment");
    }
    const attributes = member.build
      ? (
          Object.entries(member.build.attributes) as Array<
            [Attribute, AttributeRank]
          >
        ).filter(([, rank]) => rank > 0)
      : [];
    if (attributes.length > 12) {
      throw new Error("team plan contains too many attributes");
    }
    const disabledSkills = member.disabled.reduce<number>(
      (mask, slot) => mask | (1 << slot),
      0,
    );
    view.setUint32(base, heroId, true);
    view.setUint32(base + 4, Number(member.build !== null), true);
    view.setUint32(
      base + 16,
      index === 0 ? PLAYER_BEHAVIOR : BEHAVIOR[member.behaviour!],
      true,
    );
    view.setUint32(base + 20, disabledSkills, true);
    view.setUint32(
      base + 28,
      index === 0 ? 0 : member.panel === true ? 2 : member.panel === false ? 1 : 0,
      true,
    );
    if (!member.build) continue;
    const [primary, secondary] = member.build.professions;
    view.setUint32(base + 8, PROFESSIONS[primary].id, true);
    view.setUint32(
      base + 12,
      secondary === null ? PROFESSION_NONE_ID : PROFESSIONS[secondary].id,
      true,
    );
    view.setUint32(base + 24, attributes.length, true);
    attributes.forEach(([attribute, rank], attributeIndex) => {
      view.setUint32(
        base + 32 + attributeIndex * 4,
        ATTRIBUTES[attribute].id,
        true,
      );
      view.setUint32(base + 80 + attributeIndex * 4, rank, true);
    });
    member.build.skills.forEach((skill, skillIndex) => {
      view.setUint32(base + 128 + skillIndex * 4, Number(skill ?? 0), true);
    });
  }
}

const TEAM_ERROR = Object.freeze({
  1: "Guild Wars is not ready.",
  2: "Team management is available only in a PvE outpost.",
  3: "A saved build has the wrong primary profession for this member.",
  4: "Guild Wars did not acknowledge the last team change.",
  5: "A team member disappeared while the build was being applied.",
  6: "A selected hero is not available on this account.",
  7: "This team is larger than the current outpost allows.",
} as const);

export async function submitTeamPlan(
  plan: TeamApplyPlan,
): Promise<TeamApplyResult> {
  const runtime = window.gwCompanionRuntime;
  const operation = runtime?.applyTeam;
  if (typeof operation !== "function") {
    throw new Error(
      "Team management is not enabled for this session. Enable it in Settings and restart.",
    );
  }
  const commandId = Number(Reflect.apply(operation, runtime, [plan]));
  if (!Number.isSafeInteger(commandId) || commandId < 1) {
    throw new Error("The team plan was rejected before Guild Wars was changed.");
  }
  for (let attempt = 0; attempt < 400; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const command = window.gwCompanionTeam?.command as
      | {
          id?: unknown;
          status?: unknown;
          completedSteps?: unknown;
          error?: unknown;
          warnings?: unknown;
        }
      | undefined;
    if (command?.id !== commandId) continue;
    if (command.status === 2 && Number.isInteger(command.completedSteps)) {
      return {
        commandId,
        completedChanges: Number(command.completedSteps),
        skillsSkipped:
          Number.isInteger(command.warnings) &&
          (Number(command.warnings) & 1) !== 0,
      };
    }
    if (command.status === 3) {
      const error = Number(command.error) as keyof typeof TEAM_ERROR;
      throw new Error(TEAM_ERROR[error] ?? "The team change failed.");
    }
  }
  throw new Error("The team command did not publish a final result.");
}

/**
 * The five values the installer needs out of the kernel's manifest section.
 * The section is JSON the decoder does not control, so it is read as unknown
 * fields and named a manifest only once every one of them has been checked.
 */
type EnhancementManifest = Readonly<{
  buildId: number;
  programId: number;
  tableSlot: number;
  layoutWords: readonly number[];
  configBytes: number;
}>;

function decodeManifest(
  module: WebAssembly.Module,
): EnhancementManifest | null {
  const sections = WebAssembly.Module.customSections(
    module,
    "enhancement_manifest",
  );
  if (sections.length !== 1) return null;
  try {
    const value: Record<string, unknown> | null = JSON.parse(
      new TextDecoder().decode(sections[0]),
    );
    if (value === null) return null;
    const {
      buildId,
      programId,
      tableSlot,
      layoutWords,
      configBytes,
    } = value;
    if (
      !Number.isSafeInteger(buildId) ||
      Number(buildId) <= 0 ||
      !Number.isSafeInteger(programId) ||
      Number(programId) <= 0 ||
      !Number.isSafeInteger(tableSlot) ||
      Number(tableSlot) < 0 ||
      !Array.isArray(layoutWords) ||
      layoutWords.length === 0 ||
      layoutWords.some(
        (word: unknown) =>
          !Number.isInteger(word) ||
          Number(word) < 0 ||
          Number(word) > 0xffff_ffff,
      ) ||
      configBytes !== layoutWords.length * Uint32Array.BYTES_PER_ELEMENT
    ) {
      return null;
    }
    return Object.freeze({
      buildId: Number(buildId),
      programId: Number(programId),
      tableSlot: Number(tableSlot),
      layoutWords: layoutWords.map(Number),
      configBytes: Number(configBytes),
    });
  } catch {
    return null;
  }
}

let hasPublishedPlayableMap = false;

function recordLifecycle(state: CompanionState) {
  if (state.status === "ready") {
    hasPublishedPlayableMap = true;
    window.gwAutomation?.set(
      state.instanceType === 1 ? "game.explorable" : "game.outpost",
    );
  } else if (state.reason === "loading") {
    // The kernel has no map both on the login frontend and during a real map
    // transition. It becomes "game.loading" only after this renderer has
    // actually published a playable map; before that the Emscripten lifecycle
    // marker is the authoritative description. Without this distinction the
    // automatic-login runner sees the populated login form as a map load and
    // correctly refuses to send the Enter key that the form needs.
    if (hasPublishedPlayableMap) window.gwAutomation?.set("game.loading");
  } else if (state.status === "unsupported") {
    window.gwAutomation?.set("enhancement.unsupported");
  }
}

/** The per-frame counters and gauges the observer keeps on the runtime. */
type SnapshotObserverTarget = {
  memory: WebAssembly.Memory;
  snapshotPointer: number;
  teamPointer: number;
  snapshotReads: number;
  rejectedSnapshots: number;
  hertz: number;
  lastRenderUs: number;
  renderSamples: number[];
};

function observeSnapshots(
  runtime: SnapshotObserverTarget,
  cursor: ReturnType<typeof createCursorConsumer> | null,
  readout: ReturnType<typeof createTargetReadout> | null,
  observeState: boolean,
) {
  let frame = 0;
  let cadenceAt = performance.now();
  let cadenceTick = 0;
  const observe = () => {
    if (observeState) {
      const started = performance.now();
      const state = readCompanionSnapshot(
        runtime.memory.buffer,
        runtime.snapshotPointer,
      );
      recordLifecycle(state);
      runtime.snapshotReads += 1;
      if (
        ("reason" in state && state.reason === "writing") ||
        ("reason" in state && state.reason === "snapshot")
      ) {
        runtime.rejectedSnapshots += 1;
      }
      window.gwCompanionState = state;
      if (runtime.teamPointer !== 0) {
        window.gwCompanionTeam = readCompanionTeam(
          runtime.memory.buffer,
          runtime.teamPointer,
        );
      }
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
      readout?.update(state);
    }
    // Outside the measured window: lastRenderUs stays the snapshot read cost.
    cursor?.poll();
    frame = requestAnimationFrame(observe);
  };
  frame = requestAnimationFrame(observe);
  return () => cancelAnimationFrame(frame);
}

export async function installEnhancements(
  instance: WebAssembly.Instance,
  module: WebAssembly.Module,
  selection: EnhancementSelection,
  automation = false,
) {
  // Automation may force the core observation snapshot for live development
  // scenarios. It does not turn on either player-facing surface, and packaged
  // builds cannot set it. The shipped tools remain independently selected.
  const teamManagement = selection.teamManagement || automation;
  const observeState = selection.targetReadout || teamManagement;
  const featureFlags =
    (selection.nativeCursor ? ENHANCEMENT_FEATURE_NATIVE_CURSOR : 0) |
    (observeState ? ENHANCEMENT_FEATURE_TARGET_READOUT : 0) |
    (teamManagement ? ENHANCEMENT_FEATURE_TEAM_MANAGEMENT : 0);
  if (featureFlags === 0) return null;

  const manifest = decodeManifest(module);
  const exports = instance?.exports;
  if (
    !manifest ||
    !(exports?.memory instanceof WebAssembly.Memory) ||
    !(exports?.__indirect_function_table instanceof WebAssembly.Table) ||
    typeof exports?.malloc !== "function" ||
    typeof exports?.free !== "function" ||
    typeof exports?.enhancement_tick_original !== "function" ||
    typeof exports?.enhancement_hero_add !== "function" ||
    typeof exports?.enhancement_hero_kick !== "function" ||
    typeof exports?.enhancement_difficulty !== "function" ||
    typeof exports?.enhancement_secondary_profession !== "function" ||
    typeof exports?.enhancement_attributes !== "function" ||
    typeof exports?.enhancement_skillbar !== "function" ||
    typeof exports?.enhancement_hero_behavior !== "function" ||
    typeof exports?.enhancement_hero_skill_toggle !== "function" ||
    typeof exports?.enhancement_hero_panel !== "function" ||
    !(exports?.enhancement_hook_slot instanceof WebAssembly.Global)
  ) {
    window.gwCompanionState = Object.freeze({ status: "unsupported" });
    recordLifecycle(window.gwCompanionState);
    return null;
  }

  const table = exports.__indirect_function_table;
  const hookSlot = exports.enhancement_hook_slot;
  // The guard above proves `free` is callable, but WebAssembly exports are typed
  // as the bare `Function`, so the kernel's ABI has to be named here or the five
  // call sites below stop checking what they pass.
  const free = exports.free as (pointer: number) => void;
  const malloc = exports.malloc as (bytes: number) => number;
  const memory = exports.memory;
  if (table.get(manifest.tableSlot) !== null) {
    throw new Error(`Enhancement table slot ${manifest.tableSlot} is occupied`);
  }

  let snapshotPointer = 0;
  let configPointer = 0;
  let cursorPointer = 0;
  let teamPointer = 0;
  let stackAllocation = 0;
  let dataAllocation = 0;
  let kernelStatePointer = 0;
  let stopObserver = () => {};
  let disposeCursor = () => {};
  let disposeReadout = () => {};
  try {
    if (observeState) {
      snapshotPointer = Number(exports.malloc(COMPANION_SNAPSHOT_BYTES));
    }
    configPointer = Number(exports.malloc(manifest.configBytes));
    if (selection.nativeCursor) {
      cursorPointer = Number(exports.malloc(COMPANION_CURSOR_BYTES));
    }
    if (teamManagement) {
      teamPointer = Number(exports.malloc(COMPANION_TEAM_BYTES));
    }
    if (
      !configPointer ||
      (observeState && !snapshotPointer) ||
      (selection.nativeCursor && !cursorPointer) ||
      (teamManagement && !teamPointer)
    ) {
      throw new Error("Companion allocation failed");
    }
    new Uint32Array(
      memory.buffer,
      configPointer,
      manifest.layoutWords.length,
    ).set(manifest.layoutWords);

    const response = await fetch("companion-kernel.wasm");
    if (!response.ok) throw new Error("Companion kernel is unavailable");
    const relocatableKernel =
      inspectCompanionKernel(await response.arrayBuffer());
    dataAllocation = Number(malloc(relocatableKernel.allocationBytes));
    if (!dataAllocation) throw new Error("Companion data allocation failed");
    const dataAddress =
      Math.ceil(dataAllocation / COMPANION_STACK_ALIGNMENT)
      * COMPANION_STACK_ALIGNMENT;
    const relocatedKernel = relocatableKernel.relocate(dataAddress);
    const kernel = await WebAssembly.instantiate(
      relocatedKernel.buffer as ArrayBuffer,
      {
        env: {
          memory,
          enhancement_kernel_state: () => kernelStatePointer,
        },
        game: {
          enhancement_tick_original: exports.enhancement_tick_original,
          enhancement_hero_add: exports.enhancement_hero_add,
          enhancement_hero_kick: exports.enhancement_hero_kick,
          enhancement_difficulty: exports.enhancement_difficulty,
          enhancement_secondary_profession:
            exports.enhancement_secondary_profession,
          enhancement_attributes: exports.enhancement_attributes,
          enhancement_skillbar: exports.enhancement_skillbar,
          enhancement_hero_behavior: exports.enhancement_hero_behavior,
          enhancement_hero_skill_toggle: exports.enhancement_hero_skill_toggle,
          enhancement_hero_panel: exports.enhancement_hero_panel,
        },
      },
    );
    const stackPointer = kernel.instance.exports.__stack_pointer;
    stackAllocation = Number(
      malloc(COMPANION_STACK_BYTES + COMPANION_STACK_ALIGNMENT - 1),
    );
    if (
      !(stackPointer instanceof WebAssembly.Global) ||
      !stackAllocation
    ) {
      throw new Error("Companion stack allocation failed");
    }
    const stackTop =
      Math.floor(
        (
          stackAllocation
          + COMPANION_STACK_BYTES
          + COMPANION_STACK_ALIGNMENT
          - 1
        ) / COMPANION_STACK_ALIGNMENT,
      ) * COMPANION_STACK_ALIGNMENT;
    stackPointer.value = stackTop;
    const expectedContracts = Object.freeze({
      companion_snapshot_contract:
        (COMPANION_SNAPSHOT_BYTES << 16) | COMPANION_SNAPSHOT_ABI,
      companion_team_contract:
        (COMPANION_TEAM_BYTES << 16) | COMPANION_TEAM_ABI,
      companion_cursor_contract:
        (COMPANION_CURSOR_BYTES << 16) | COMPANION_CURSOR_ABI,
    });
    for (const [name, expected] of Object.entries(expectedContracts)) {
      const exported = kernel.instance.exports[name];
      if (
        typeof exported !== "function" ||
        Number(exported()) !== expected
      ) {
        throw new Error(`Companion kernel ${name} is incompatible`);
      }
    }
    const stateSize = kernel.instance.exports.companion_state_size;
    const stateBytes =
      typeof stateSize === "function" ? Number(stateSize()) : 0;
    if (
      !Number.isSafeInteger(stateBytes) ||
      stateBytes < 1 ||
      stateBytes > COMPANION_STACK_BYTES
    ) {
      throw new Error("Companion state size is invalid");
    }
    kernelStatePointer = Number(malloc(stateBytes));
    if (!kernelStatePointer) {
      throw new Error("Companion state allocation failed");
    }
    const kernelInit = kernel.instance.exports.companion_init;
    const applyTeam = kernel.instance.exports.companion_apply_team;
    if (
      typeof kernelInit !== "function" ||
      kernelInit.length !== 9 ||
      typeof kernel.instance.exports.companion_tick !== "function" ||
      typeof applyTeam !== "function" ||
      applyTeam.length !== 2 ||
      kernelInit(
        snapshotPointer,
        observeState ? COMPANION_SNAPSHOT_BYTES : 0,
        configPointer,
        manifest.configBytes,
        cursorPointer,
        selection.nativeCursor ? COMPANION_CURSOR_BYTES : 0,
        teamPointer,
        teamManagement ? COMPANION_TEAM_BYTES : 0,
        featureFlags,
      ) !== 1
    ) {
      throw new Error("Companion kernel rejected its ABI");
    }

    let cursor: ReturnType<typeof createCursorConsumer> | null = null;
    if (selection.nativeCursor) {
      const element = document.getElementById("canvas");
      if (!element) throw new Error("Enhancement cursor target is missing");
      cursor = createCursorConsumer({
        element,
        memory,
        cursorPointer,
        // The empty string hands the canvas back to the stylesheet theme.
        fallback: "",
      });
      disposeCursor = cursor.dispose;
    }
    const readout = selection.targetReadout
      ? createTargetReadout(document.body)
      : null;
    if (readout) disposeReadout = readout.dispose;

    table.set(manifest.tableSlot, kernel.instance.exports.companion_tick);
    const runtime = {
      status: "installed",
      buildId: manifest.buildId,
      programId: manifest.programId,
      memory,
      snapshotPointer,
      teamPointer,
      configPointer,
      tableSlot: manifest.tableSlot,
      hertz: 0,
      lastRenderUs: 0,
      renderSamples: [],
      snapshotReads: 0,
      rejectedSnapshots: 0,
      // Presentation state only: no pixels and no pointer leave this module.
      get cursor() {
        return cursor?.state ?? null;
      },
      // The rendered line, so a live run can read the feature without a
      // screenshot. Text only: the readout owns its own element.
      get readout() {
        return readout?.state ?? null;
      },
      installation: (window.gwCompanionInstallations ?? 0) + 1,
      setHookEnabledForBenchmark(enabled: boolean) {
        hookSlot.value = enabled ? manifest.tableSlot + 1 : 0;
      },
      ...(teamManagement
        ? {
            applyTeam(plan: TeamApplyPlan) {
              const planPointer = Number(malloc(TEAM_PLAN_BYTES));
              if (!planPointer) {
                throw new Error("team plan allocation failed");
              }
              try {
                writeTeamPlan(memory, planPointer, plan);
                const commandId = Number(applyTeam(planPointer, TEAM_PLAN_BYTES));
                if (!Number.isSafeInteger(commandId) || commandId < 1) {
                  throw new Error("team command was rejected");
                }
                return commandId;
              } finally {
                free(planPointer);
              }
            },
          }
        : {}),
    };
    window.gwCompanionInstallations = runtime.installation;
    window.gwCompanionRuntime = runtime;
    stopObserver = observeSnapshots(runtime, cursor, readout, observeState);
    hookSlot.value = manifest.tableSlot + 1;

    const teardown = () => {
      hookSlot.value = 0;
      stopObserver();
      disposeCursor();
      disposeReadout();
      if (
        table.get(manifest.tableSlot) === kernel.instance.exports.companion_tick
      ) {
        table.set(manifest.tableSlot, null);
      }
      if (cursorPointer) free(cursorPointer);
      if (teamPointer) free(teamPointer);
      free(kernelStatePointer);
      free(stackAllocation);
      free(dataAllocation);
      free(configPointer);
      if (snapshotPointer) free(snapshotPointer);
      window.gwCompanionRuntime = null;
    };
    window.addEventListener("pagehide", teardown, { once: true });
    console.info(
      `[enhancement] installed for client build ${manifest.buildId}`,
    );
    return runtime;
  } catch (error) {
    hookSlot.value = 0;
    stopObserver();
    disposeCursor();
    disposeReadout();
    if (cursorPointer) free(cursorPointer);
    if (teamPointer) free(teamPointer);
    if (kernelStatePointer) free(kernelStatePointer);
    if (stackAllocation) free(stackAllocation);
    if (dataAllocation) free(dataAllocation);
    if (configPointer) free(configPointer);
    if (snapshotPointer) free(snapshotPointer);
    window.gwCompanionState = Object.freeze({
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
