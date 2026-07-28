import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  readCompanionCursorHeader,
  readCompanionCursorPixels,
  readCompanionTeam,
  readCompanionSnapshot,
  COMPANION_CURSOR_ABI,
  COMPANION_CURSOR_BYTES,
  COMPANION_TEAM_ABI,
  COMPANION_TEAM_BYTES,
} from "../../src/renderer/companion-snapshot.ts";

// Every read returns a discriminated union: `reason` belongs to the members
// that rejected the region, the decoded fields to the members that accepted
// it. Narrowing through the helpers below keeps each assertion pointed at the
// member it is about — a read that lands on the wrong one now fails by name
// instead of quietly comparing `undefined`.
type SnapshotRead = ReturnType<typeof readCompanionSnapshot>;
type CursorHeaderRead = ReturnType<typeof readCompanionCursorHeader>;
type CursorPixelsRead = ReturnType<typeof readCompanionCursorPixels>;
type TeamRead = ReturnType<typeof readCompanionTeam>;

function decoded(read: SnapshotRead) {
  if (read.status !== "ready") {
    throw new Error(`expected a decoded snapshot, got ${JSON.stringify(read)}`);
  }
  return read;
}

function rejected(read: SnapshotRead) {
  if (read.status === "ready") {
    throw new Error("expected a rejected snapshot, got a decoded one");
  }
  return read.reason;
}

function decodedTeam(read: TeamRead) {
  if (read.status !== "ready") {
    throw new Error(`expected a decoded team, got ${JSON.stringify(read)}`);
  }
  return read;
}

function teamReason(read: TeamRead) {
  if (read.status === "ready") {
    throw new Error("expected a rejected team, got a decoded one");
  }
  return read.reason;
}

function readyCursor(read: CursorHeaderRead) {
  if (read.status !== "ready") {
    throw new Error(`expected a published cursor, got ${JSON.stringify(read)}`);
  }
  return read;
}

// "invalid" is not "waiting": it carries the cleared geometry the renderer is
// expected to keep reading, so it narrows separately from the members that are
// nothing but a reason.
function invalidCursor(read: CursorHeaderRead) {
  if (read.status !== "invalid") {
    throw new Error(
      `expected an invalidated cursor, got ${JSON.stringify(read)}`,
    );
  }
  return read;
}

function cursorReason(read: CursorHeaderRead) {
  if (read.status === "ready") {
    throw new Error("expected a rejected cursor header, got a published one");
  }
  return read.reason;
}

function publishedPixels(read: CursorPixelsRead) {
  if (read === null) throw new Error("the kernel published no cursor bitmap");
  return read;
}

const MAGIC = 0x42545747;
const FEATURE_NATIVE_CURSOR = 1 << 0;
const FEATURE_TARGET_READOUT = 1 << 1;
const FEATURE_TEAM_MANAGEMENT = 1 << 2;
const ALL_FEATURES =
  FEATURE_NATIVE_CURSOR | FEATURE_TARGET_READOUT | FEATURE_TEAM_MANAGEMENT;

interface SnapshotOverrides {
  sequence?: number;
  flags?: number;
  tickCount?: number;
  mapId?: number;
  instanceType?: number;
  playerId?: number;
  playerX?: number;
  playerY?: number;
  targetId?: number;
  targetType?: number;
  targetX?: number;
  targetY?: number;
  distance?: number;
  rangeBand?: number;
}

function snapshot(overrides: SnapshotOverrides = {}) {
  const buffer = new ArrayBuffer(64);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 64, true);
  view.setUint32(8, overrides.sequence ?? 2, true);
  const flags = overrides.flags ?? 7;
  const hasPlayer = (flags & 2) !== 0;
  const hasTarget = (flags & 4) !== 0;
  view.setUint32(12, flags, true);
  view.setUint32(16, overrides.tickCount ?? 40, true);
  view.setUint32(20, overrides.mapId ?? (hasPlayer ? 133 : 0), true);
  view.setUint32(24, overrides.instanceType ?? 0, true);
  view.setUint32(28, overrides.playerId ?? (hasPlayer ? 7 : 0), true);
  view.setFloat32(32, overrides.playerX ?? (hasPlayer ? -9827.3 : 0), true);
  view.setFloat32(36, overrides.playerY ?? (hasPlayer ? 34130.2 : 0), true);
  view.setUint32(40, overrides.targetId ?? (hasTarget ? 9 : 0), true);
  view.setUint32(44, overrides.targetType ?? (hasTarget ? 0xdb : 0), true);
  view.setFloat32(48, overrides.targetX ?? (hasTarget ? -9700 : 0), true);
  view.setFloat32(52, overrides.targetY ?? (hasTarget ? 34100 : 0), true);
  view.setFloat32(56, overrides.distance ?? (hasTarget ? 130.8 : 0), true);
  view.setUint32(60, overrides.rangeBand ?? (hasTarget ? 1 : 0), true);
  return buffer;
}

type TeamMemberFixture = Readonly<{
  agentId: number;
  heroId: number;
  primary?: number;
  secondary?: number;
  level?: number;
  behavior?: number;
  disabledSkills?: number;
  attributes?: readonly (readonly [id: number, rank: number])[];
  skills?: readonly number[];
}>;

function teamRegion(
  members: readonly TeamMemberFixture[] = [
    { agentId: 7, heroId: 0 },
    { agentId: 100, heroId: 1, behavior: 1 },
  ],
  overrides: {
    sequence?: number;
    flags?: number;
    memberCount?: number;
    reserved?: number;
    command?: Readonly<{
      id: number;
      status: number;
      phase: number;
      completedSteps: number;
      error: number;
      warnings?: number;
    }>;
  } = {},
) {
  const buffer = new ArrayBuffer(COMPANION_TEAM_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, 0x4d545747, true);
  view.setUint16(4, COMPANION_TEAM_ABI, true);
  view.setUint16(6, COMPANION_TEAM_BYTES, true);
  view.setUint32(8, overrides.sequence ?? 2, true);
  view.setUint32(12, overrides.flags ?? 1, true);
  view.setUint32(16, 40, true);
  view.setUint32(20, overrides.memberCount ?? members.length, true);
  const command = overrides.command ?? {
    id: 0,
    status: 0,
    phase: 0,
    completedSteps: 0,
    error: 0,
  };
  view.setUint32(24, command.id, true);
  view.setUint32(28, command.status, true);
  view.setUint32(32, command.phase, true);
  view.setUint32(36, command.completedSteps, true);
  view.setUint32(40, command.error, true);
  view.setUint32(44, command.warnings ?? 0, true);
  members.forEach((member, index) => {
    const base = 48 + index * 160;
    const attributes = member.attributes ?? [[17, 12]];
    const skills = member.skills ?? [1, 2, 3, 4, 5, 6, 7, 8];
    view.setUint32(base, member.agentId, true);
    view.setUint32(base + 4, member.heroId, true);
    view.setUint32(base + 8, member.primary ?? 1, true);
    view.setUint32(base + 12, member.secondary ?? 3, true);
    view.setUint32(
      base + 16,
      member.behavior ?? (index === 0 ? 0xffff_ffff : 1),
      true,
    );
    view.setUint32(base + 20, member.disabledSkills ?? 0, true);
    view.setUint32(base + 24, attributes.length, true);
    view.setUint32(base + 28, overrides.reserved ?? member.level ?? 20, true);
    attributes.forEach(([id, rank], attribute) => {
      view.setUint32(base + 32 + attribute * 4, id, true);
      view.setUint32(base + 80 + attribute * 4, rank, true);
    });
    skills.forEach((skill, slot) => {
      view.setUint32(base + 128 + slot * 4, skill, true);
    });
  });
  return buffer;
}

const CURSOR_MAGIC = 0x43545747;
const CURSOR_VALID = 1 << 0;
const CURSOR_HIDDEN = 1 << 1;
const CURSOR_UNSUPPORTED = 1 << 2;
const CURSOR_EDGE = 32;
const CURSOR_WORDS = CURSOR_EDGE * CURSOR_EDGE;
const CURSOR_PIXEL_BYTES = CURSOR_WORDS * 4;
// Field offsets of the cursor region, version 1.
const CURSOR = Object.freeze({
  magic: 0,
  abi: 4,
  byteLength: 6,
  sequence: 8,
  flags: 12,
  generation: 16,
  width: 20,
  height: 24,
  hotspotX: 28,
  hotspotY: 32,
  pixelHash: 36,
  reserved: 40,
  pixels: 64,
});

interface CursorOverrides {
  magic?: number;
  abi?: number;
  byteLength?: number;
  sequence?: number;
  flags?: number;
  generation?: number;
  width?: number;
  height?: number;
  hotspotX?: number;
  hotspotY?: number;
  pixelHash?: number;
  reservedWord?: number;
  reservedIndex?: number;
}

function cursorRegion(overrides: CursorOverrides = {}) {
  const buffer = new ArrayBuffer(COMPANION_CURSOR_BYTES);
  const view = new DataView(buffer);
  view.setUint32(CURSOR.magic, overrides.magic ?? CURSOR_MAGIC, true);
  view.setUint16(CURSOR.abi, overrides.abi ?? COMPANION_CURSOR_ABI, true);
  view.setUint16(
    CURSOR.byteLength,
    overrides.byteLength ?? COMPANION_CURSOR_BYTES,
    true,
  );
  view.setUint32(CURSOR.sequence, overrides.sequence ?? 2, true);
  view.setUint32(CURSOR.flags, overrides.flags ?? CURSOR_VALID, true);
  view.setUint32(CURSOR.generation, overrides.generation ?? 1, true);
  view.setUint32(CURSOR.width, overrides.width ?? CURSOR_EDGE, true);
  view.setUint32(CURSOR.height, overrides.height ?? CURSOR_EDGE, true);
  view.setUint32(CURSOR.hotspotX, overrides.hotspotX ?? 3, true);
  view.setUint32(CURSOR.hotspotY, overrides.hotspotY ?? 4, true);
  view.setUint32(CURSOR.pixelHash, overrides.pixelHash ?? 0x1357_9bdf, true);
  if (overrides.reservedWord !== undefined) {
    view.setUint32(
      CURSOR.reserved + 4 * (overrides.reservedIndex ?? 0),
      overrides.reservedWord,
      true,
    );
  }
  for (let index = 0; index < CURSOR_WORDS; index += 1) {
    view.setUint32(CURSOR.pixels + index * 4, 0xff20_4060, true);
  }
  return buffer;
}

// FNV-1a over the source BGRA words, computed independently of the kernel.
function fnv1a(words: Uint32Array) {
  let hash = 0x811c_9dc5;
  for (const word of words) hash = Math.imul(hash ^ word, 0x0100_0193);
  return hash >>> 0;
}

// BGRA -> RGBA: keep alpha and green, swap red and blue.
function expectedRgba(words: Uint32Array) {
  const bytes = new Uint8ClampedArray(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((word, index) => {
    const rgba =
      (word & 0xff00_ff00) | ((word >>> 16) & 0xff) | ((word & 0xff) << 16);
    view.setUint32(index * 4, rgba >>> 0, true);
  });
  return bytes;
}

const ADDRESSES = Object.freeze({
  snapshot: 0x1000,
  teamSnapshot: 0x1040,
  config: 0x1600,
  contextRoot: 0x2000,
  contexts: 0x2100,
  game: 0x2200,
  character: 0x2300,
  agentArray: 0x2400,
  agentBuffer: 0x2500,
  player: 0x2600,
  target: 0x2800,
  manualTargetId: 0x2a00,
  automaticTargetId: 0x2a04,
  partyContext: 0x2b00,
  partyInfo: 0x2c00,
  heroBuffer: 0x2d00,
  playerPartyBuffer: 0x2f00,
  world: 0x9000,
  attributeBuffer: 0xa000,
  heroFlagBuffer: 0xb000,
  professionBuffer: 0xb100,
  skillbarBuffer: 0xb200,
  cursor: 0x4000,
  colorBuffer: 0x6000,
  activeArt: 0x8000,
  softwareModel: 0x8004,
  showCount: 0x8008,
  areaInfo: 0xd000,
  heroInfoBuffer: 0x30000,
  art: 0x8100,
  handle: 0x8200,
  textureView: 0x8300,
  texture: 0x8400,
});
const CONFIG_WORDS = 74;
const CONFIG_BYTES = CONFIG_WORDS * 4;
const TEXTURE_KEY = 0x6772_7478;

interface KernelOverrides {
  features?: number;
  snapshotPointer?: number;
  snapshotSize?: number;
  configPointer?: number;
  configSize?: number;
  cursorPointer?: number;
  cursorSize?: number;
  teamPointer?: number;
  teamSize?: number;
}

/**
 * A `.wasm` binary carries its signatures nowhere TypeScript can read them, so
 * `WebAssembly.Exports` is `Record<string, ExportValue>` and this is the one
 * dynamic boundary in the file. The `typeof` checks prove the two exports are
 * callable; the arities come from `src/companion-kernel/lib.rs`, and every
 * call below is checked against these declarations rather than against
 * `Function`.
 */
type KernelInit = (
  snapshotPointer: number,
  snapshotSize: number,
  configPointer: number,
  configSize: number,
  cursorPointer: number,
  cursorSize: number,
  teamPointer: number,
  teamSize: number,
  features: number,
) => number;
type KernelTick = (context: number) => void;
type ApplyTeam = (plan: number, planSize: number) => number;
type DesiredTestMember = Readonly<{
  heroId: number;
  primary?: number;
  secondary?: number;
  attributes?: readonly (readonly [id: number, rank: number])[];
  skills?: readonly number[];
  behavior?: number;
  disabledSkills?: number;
  panel?: number;
}>;

function kernelExports(exports: WebAssembly.Exports) {
  const init = exports["companion_init"];
  const tick = exports["companion_tick"];
  const applyTeam = exports["companion_apply_team"];
  const stackPointer = exports["__stack_pointer"];
  if (
    typeof init !== "function" ||
    typeof tick !== "function" ||
    typeof applyTeam !== "function" ||
    !(stackPointer instanceof WebAssembly.Global)
  ) {
    throw new Error(
      "companion-kernel.wasm did not export its required command ABI",
    );
  }
  return {
    init: init as KernelInit,
    tick: tick as KernelTick,
    applyTeam: applyTeam as ApplyTeam,
    stackPointer,
  };
}

async function createKernel() {
  const bytes = await readFile("build/renderer/companion-kernel.wasm");
  const memory = new WebAssembly.Memory({ initial: 256 });
  const calls = {
    original: 0,
    additions: [] as number[],
    removals: [] as number[],
    difficulties: [] as number[],
    professions: [] as Array<readonly [agentId: number, profession: number]>,
    attributes: [] as Array<
      Readonly<{
        agentId: number;
        ids: readonly number[];
        ranks: readonly number[];
      }>
    >,
    skillbars: [] as Array<
      Readonly<{ agentId: number; skills: readonly number[] }>
    >,
    behaviors: [] as Array<readonly [agentId: number, behavior: number]>,
    toggles: [] as Array<readonly [agentId: number, slot: number]>,
    panels: [] as Array<readonly [heroId: number, visible: number]>,
  };
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      memory,
      enhancement_kernel_state: () => 0x00e0_0000,
    },
    game: {
      enhancement_tick_original: () => {
        calls.original += 1;
      },
      enhancement_hero_add: (heroId: number) => {
        calls.additions.push(heroId);
      },
      enhancement_hero_kick: (heroId: number) => {
        calls.removals.push(heroId);
      },
      enhancement_difficulty: (hardMode: number) => {
        calls.difficulties.push(hardMode);
      },
      enhancement_secondary_profession: (
        agentId: number,
        profession: number,
      ) => {
        calls.professions.push([agentId, profession]);
      },
      enhancement_attributes: (
        agentId: number,
        count: number,
        ids: number,
        ranks: number,
      ) => {
        calls.attributes.push({
          agentId,
          ids: [...new Uint32Array(memory.buffer, ids, count)],
          ranks: [...new Uint32Array(memory.buffer, ranks, count)],
        });
      },
      enhancement_skillbar: (
        agentId: number,
        count: number,
        skills: number,
      ) => {
        calls.skillbars.push({
          agentId,
          skills: [...new Uint32Array(memory.buffer, skills, count)],
        });
      },
      enhancement_hero_behavior: (agentId: number, behavior: number) => {
        calls.behaviors.push([agentId, behavior]);
      },
      enhancement_hero_skill_toggle: (agentId: number, slot: number) => {
        calls.toggles.push([agentId, slot]);
      },
      enhancement_hero_panel: (heroId: number, visible: number) => {
        calls.panels.push([heroId, visible]);
      },
    },
  });
  const exports = kernelExports(instance.exports);
  exports.stackPointer.value = 0x00f0_0000;
  const view = new DataView(memory.buffer);
  const config = new Uint32Array(memory.buffer, ADDRESSES.config, CONFIG_WORDS);
  config.set([
    ADDRESSES.contextRoot,
    ADDRESSES.agentArray,
    ADDRESSES.manualTargetId,
    ADDRESSES.automaticTargetId,
    6,
    0x44,
    0x198,
    0x19c,
    0x234,
    0x23c,
    ADDRESSES.areaInfo,
    0x2ac,
    0x4c,
    0x54,
    0x24,
    0x18,
    0x00,
    0x04,
    0x08,
    0x2c,
    0x00ac,
    0x43c,
    0x00,
    0x04,
    0x14,
    0x00,
    0x04,
    0x0584,
    0x24,
    0x00,
    0x04,
    0x0c,
    0x06bc,
    0x14,
    0x00,
    0x04,
    0x08,
    0x06f0,
    0xbc,
    0x00,
    0x04,
    0x14,
    0x0c,
    0xa4,
    0x2c,
    0x74,
    0x78,
    0x9c,
    0xf4,
    0xf6,
    ADDRESSES.activeArt,
    ADDRESSES.softwareModel,
    ADDRESSES.showCount,
    ADDRESSES.colorBuffer,
    0x00,
    0x0c,
    0x08,
    0x00,
    0x08,
    0x0c,
    0x14,
    0x18,
    0x04,
    0x0c,
    0x14,
    0x34,
    0x14,
    0x0594,
    0x9c,
    0x00,
    0x08,
    0x0c,
    0x10,
    0x110,
  ]);
  const applyTeam = (
    members: readonly DesiredTestMember[],
    mode = 0,
  ) => {
    const plan = 0xc000;
    const bytes = 1296;
    new Uint8Array(memory.buffer, plan, bytes).fill(0);
    view.setUint32(plan, members.length, true);
    view.setUint32(plan + 4, mode, true);
    members.forEach((member, memberIndex) => {
      const base = plan + 16 + memberIndex * 160;
      const attributes = member.attributes ?? [];
      const skills = member.skills ?? [];
      const applyBuild = member.primary !== undefined;
      view.setUint32(base, member.heroId, true);
      view.setUint32(base + 4, Number(applyBuild), true);
      view.setUint32(base + 8, member.primary ?? 0, true);
      view.setUint32(base + 12, member.secondary ?? 0, true);
      view.setUint32(
        base + 16,
        memberIndex === 0 ? 0xffff_ffff : (member.behavior ?? 1),
        true,
      );
      view.setUint32(base + 20, member.disabledSkills ?? 0, true);
      view.setUint32(base + 24, attributes.length, true);
      view.setUint32(base + 28, member.panel ?? 0, true);
      attributes.forEach(([id, rank], attributeIndex) => {
        view.setUint32(base + 32 + attributeIndex * 4, id, true);
        view.setUint32(base + 80 + attributeIndex * 4, rank, true);
      });
      skills.forEach((skill, skillIndex) => {
        view.setUint32(base + 128 + skillIndex * 4, skill, true);
      });
    });
    return exports.applyTeam(plan, bytes);
  };
  return {
    instance,
    memory,
    view,
    config,
    calls,
    init: (overrides: KernelOverrides = {}) => {
      const features = overrides.features ?? ALL_FEATURES;
      return exports.init(
        overrides.snapshotPointer ??
          ((features & FEATURE_TARGET_READOUT) !== 0 ? ADDRESSES.snapshot : 0),
        overrides.snapshotSize ??
          ((features & FEATURE_TARGET_READOUT) !== 0 ? 64 : 0),
        overrides.configPointer ?? ADDRESSES.config,
        overrides.configSize ?? CONFIG_BYTES,
        overrides.cursorPointer ??
          ((features & FEATURE_NATIVE_CURSOR) !== 0 ? ADDRESSES.cursor : 0),
        overrides.cursorSize ??
          ((features & FEATURE_NATIVE_CURSOR) !== 0
            ? COMPANION_CURSOR_BYTES
            : 0),
        overrides.teamPointer ??
          ((features & FEATURE_TEAM_MANAGEMENT) !== 0
            ? ADDRESSES.teamSnapshot
            : 0),
        overrides.teamSize ??
          ((features & FEATURE_TEAM_MANAGEMENT) !== 0
            ? COMPANION_TEAM_BYTES
            : 0),
        features,
      );
    },
    tick: () => exports.tick(123),
    applyTeam,
    applyTeamWithHeroBuild: (
      heroId: number,
      primary: number,
      secondary: number,
      attributes: readonly (readonly [id: number, rank: number])[],
      skills: readonly number[],
      behavior = 1,
      disabledSkills = 1,
    ) => {
      return applyTeam([
        { heroId: 0 },
        {
          heroId,
          primary,
          secondary,
          attributes,
          skills,
          behavior,
          disabledSkills,
        },
      ]);
    },
    field: (offset: number) => view.getUint32(ADDRESSES.cursor + offset, true),
    header: () => readCompanionCursorHeader(memory.buffer, ADDRESSES.cursor),
    published: () => readCompanionCursorPixels(memory.buffer, ADDRESSES.cursor),
    team: () => readCompanionTeam(memory.buffer, ADDRESSES.teamSnapshot),
    payload: () => {
      const bytes = new Uint8ClampedArray(CURSOR_PIXEL_BYTES);
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = view.getUint8(ADDRESSES.cursor + CURSOR.pixels + index);
      }
      return bytes;
    },
  };
}

function settleCommand(
  kernel: Awaited<ReturnType<typeof createKernel>>,
): void {
  for (let tick = 0; tick < 300; tick += 1) kernel.tick();
}

function gameWriteCount(kernel: Awaited<ReturnType<typeof createKernel>>) {
  return (
    kernel.calls.additions.length +
    kernel.calls.removals.length +
    kernel.calls.difficulties.length +
    kernel.calls.professions.length +
    kernel.calls.attributes.length +
    kernel.calls.skillbars.length +
    kernel.calls.behaviors.length +
    kernel.calls.toggles.length +
    kernel.calls.panels.length
  );
}

function installGameGraph(view: DataView) {
  view.setUint32(ADDRESSES.contextRoot, ADDRESSES.contexts, true);
  view.setUint32(ADDRESSES.contexts + 24, ADDRESSES.game, true);
  view.setUint32(ADDRESSES.game + 0x44, ADDRESSES.character, true);
  view.setUint32(ADDRESSES.game + 0x4c, ADDRESSES.partyContext, true);
  view.setUint32(ADDRESSES.game + 0x2c, ADDRESSES.world, true);
  view.setUint32(ADDRESSES.partyContext + 0x54, ADDRESSES.partyInfo, true);
  view.setUint32(ADDRESSES.partyInfo + 0x04, ADDRESSES.playerPartyBuffer, true);
  view.setUint32(ADDRESSES.partyInfo + 0x08, 1, true);
  view.setUint32(ADDRESSES.partyInfo + 0x0c, 1, true);
  view.setUint32(ADDRESSES.partyInfo + 0x24, ADDRESSES.heroBuffer, true);
  view.setUint32(ADDRESSES.partyInfo + 0x28, 4, true);
  view.setUint32(ADDRESSES.partyInfo + 0x2c, 2, true);
  // One hero owned by this player and one owned by another player. The party
  // snapshot must publish only the former.
  view.setUint32(ADDRESSES.heroBuffer + 0x00, 11, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x04, 42, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x08, 1, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x14, 20, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x18 + 0x00, 12, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x18 + 0x04, 77, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x18 + 0x08, 2, true);
  view.setUint32(ADDRESSES.heroBuffer + 0x18 + 0x14, 20, true);

  // Build-state arrays for the controlled player (AgentID 7) and their one
  // owned hero (AgentID 11, HeroID 1). The foreign party hero is deliberately
  // absent because the team snapshot publishes only this player's roster.
  view.setUint32(ADDRESSES.world + 0x00ac, ADDRESSES.attributeBuffer, true);
  view.setUint32(ADDRESSES.world + 0x00b0, 2, true);
  view.setUint32(ADDRESSES.world + 0x00b4, 2, true);
  view.setUint32(ADDRESSES.attributeBuffer, 7, true);
  view.setUint32(ADDRESSES.attributeBuffer + 0x04, 17, true);
  view.setUint32(ADDRESSES.attributeBuffer + 0x08, 12, true);
  const heroAttributes = ADDRESSES.attributeBuffer + 0x43c;
  view.setUint32(heroAttributes, 11, true);
  view.setUint32(heroAttributes + 0x04, 17, true);
  view.setUint32(heroAttributes + 0x08, 10, true);
  view.setUint32(heroAttributes + 0x18, 21, true);
  view.setUint32(heroAttributes + 0x1c, 8, true);

  view.setUint32(ADDRESSES.world + 0x0584, ADDRESSES.heroFlagBuffer, true);
  view.setUint32(ADDRESSES.world + 0x0588, 1, true);
  view.setUint32(ADDRESSES.world + 0x058c, 1, true);
  view.setUint32(ADDRESSES.heroFlagBuffer, 1, true);
  view.setUint32(ADDRESSES.heroFlagBuffer + 0x04, 11, true);
  view.setUint32(ADDRESSES.heroFlagBuffer + 0x0c, 1, true);

  const availableHeroIds = [
    ...Array.from({ length: 27 }, (_, index) => index + 1),
    36,
    37,
    38,
    39,
  ];
  view.setUint32(ADDRESSES.world + 0x0594, ADDRESSES.heroInfoBuffer, true);
  view.setUint32(ADDRESSES.world + 0x0598, availableHeroIds.length, true);
  view.setUint32(ADDRESSES.world + 0x059c, availableHeroIds.length, true);
  availableHeroIds.forEach((heroId, index) => {
    const record = ADDRESSES.heroInfoBuffer + index * 0x9c;
    view.setUint32(record, heroId, true);
    view.setUint32(record + 0x08, 20, true);
    view.setUint32(record + 0x0c, 1, true);
    view.setUint32(record + 0x10, 3, true);
  });

  view.setUint32(ADDRESSES.world + 0x06bc, ADDRESSES.professionBuffer, true);
  view.setUint32(ADDRESSES.world + 0x06c0, 2, true);
  view.setUint32(ADDRESSES.world + 0x06c4, 2, true);
  view.setUint32(ADDRESSES.professionBuffer, 7, true);
  view.setUint32(ADDRESSES.professionBuffer + 0x04, 1, true);
  view.setUint32(ADDRESSES.professionBuffer + 0x08, 3, true);
  view.setUint32(ADDRESSES.professionBuffer + 0x14, 11, true);
  view.setUint32(ADDRESSES.professionBuffer + 0x18, 1, true);
  view.setUint32(ADDRESSES.professionBuffer + 0x1c, 6, true);

  view.setUint32(ADDRESSES.world + 0x06f0, ADDRESSES.skillbarBuffer, true);
  view.setUint32(ADDRESSES.world + 0x06f4, 2, true);
  view.setUint32(ADDRESSES.world + 0x06f8, 2, true);
  for (const [member, agentId] of [7, 11].entries()) {
    const skillbar = ADDRESSES.skillbarBuffer + member * 0xbc;
    view.setUint32(skillbar, agentId, true);
    for (let slot = 0; slot < 8; slot += 1) {
      view.setUint32(
        skillbar + 0x10 + slot * 0x14,
        member * 100 + slot + 1,
        true,
      );
    }
    view.setUint32(skillbar + 0xa4, member, true);
  }
  view.setUint32(ADDRESSES.character + 0x198, 133, true);
  view.setUint32(ADDRESSES.character + 0x19c, 0, true);
  view.setUint32(ADDRESSES.character + 0x234, 133, true);
  view.setUint32(ADDRESSES.character + 0x23c, 0, true);
  view.setUint32(ADDRESSES.character + 0x2ac, 42, true);
  view.setUint32(ADDRESSES.agentArray, ADDRESSES.agentBuffer, true);
  view.setUint32(ADDRESSES.agentArray + 4, 16, true);
  view.setUint32(ADDRESSES.agentArray + 8, 10, true);
  view.setUint32(ADDRESSES.agentBuffer + 7 * 4, ADDRESSES.player, true);
  view.setUint32(ADDRESSES.agentBuffer + 9 * 4, ADDRESSES.target, true);
  view.setUint32(ADDRESSES.player + 0x2c, 7, true);
  view.setFloat32(ADDRESSES.player + 0x74, 10, true);
  view.setFloat32(ADDRESSES.player + 0x78, 20, true);
  view.setUint32(ADDRESSES.player + 0x9c, 0xdb, true);
  view.setUint16(ADDRESSES.player + 0xf4, 42, true);
  view.setUint16(ADDRESSES.player + 0xf6, 0x3000, true);
  view.setUint8(ADDRESSES.player + 0x110, 20);
  view.setUint32(ADDRESSES.target + 0x2c, 9, true);
  view.setFloat32(ADDRESSES.target + 0x74, 110, true);
  view.setFloat32(ADDRESSES.target + 0x78, 20, true);
  view.setUint32(ADDRESSES.target + 0x9c, 0xdb, true);
  view.setUint8(ADDRESSES.target + 0x110, 20);
  view.setUint32(ADDRESSES.manualTargetId, 9, true);
  for (const mapId of [4, 81, 133, 188, 449]) {
    view.setUint32(ADDRESSES.areaInfo + mapId * 124 + 0x1c, 8, true);
  }
}

// s_activeArt -> art -> handle -> view -> GrTex2d, exactly the chain the
// kernel walks to prove the colour buffer really came from a 32x32 texture.
function installCursorGraph(
  view: DataView,
  { hotspotX = 0, hotspotY = 0 }: { hotspotX?: number; hotspotY?: number } = {},
) {
  view.setUint32(ADDRESSES.activeArt, ADDRESSES.art, true);
  view.setUint32(ADDRESSES.softwareModel, 0, true);
  view.setInt32(ADDRESSES.showCount, 0, true);
  view.setUint32(ADDRESSES.art + 0x00, hotspotX, true);
  view.setUint32(ADDRESSES.art + 0x04, hotspotY, true);
  view.setUint32(ADDRESSES.art + 0x0c, ADDRESSES.handle, true);
  view.setUint32(ADDRESSES.handle + 0x00, ADDRESSES.textureView, true);
  view.setUint32(ADDRESSES.handle + 0x08, TEXTURE_KEY, true);
  view.setUint32(ADDRESSES.textureView + 0x08, ADDRESSES.texture, true);
  view.setUint32(ADDRESSES.texture + 0x0c, 10, true);
  view.setUint32(ADDRESSES.texture + 0x14, CURSOR_EDGE, true);
  view.setUint32(ADDRESSES.texture + 0x18, CURSOR_EDGE, true);
}

// Fills the game's fixed BGRA readback buffer. Word 0 is pinned so one exact
// pixel proves the byte order; the rest varies with the seed.
function paintCursor(view: DataView, seed: number) {
  const words = new Uint32Array(CURSOR_WORDS);
  for (let index = 0; index < CURSOR_WORDS; index += 1) {
    words[index] =
      index % 4 === 3
        ? 0
        : (0xff00_0000 | ((seed * 7919 + index * 31) & 0xff_ffff)) >>> 0;
  }
  words[0] = 0xff11_2233;
  words.forEach((word, index) => {
    view.setUint32(ADDRESSES.colorBuffer + index * 4, word, true);
  });
  return words;
}

describe("Companion snapshot ABI", () => {
  it("decodes stable player and target state", () => {
    const state = decoded(readCompanionSnapshot(snapshot(), 0));
    assert.equal(state.status, "ready");
    assert.equal(state.mapId, 133);
    assert.equal(state.instanceName, "Outpost");
    assert.equal(state.playerId, 7);
    assert.equal(state.targetId, 9);
    assert.equal(state.targetKind, "Living");
    assert.equal(state.rangeName, "Adjacent");
  });

  it("rejects torn, incompatible, loading, and absent-target snapshots", () => {
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ sequence: 3 }), 0)),
      "writing",
    );
    const corrupt = snapshot();
    new DataView(corrupt).setUint16(4, 2, true);
    assert.equal(rejected(readCompanionSnapshot(corrupt, 0)), "snapshot");
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ flags: 8 }), 0)),
      "loading",
    );
    const noTarget = decoded(readCompanionSnapshot(snapshot({ flags: 3 }), 0));
    assert.equal(noTarget.status, "ready");
    assert.equal(noTarget.targetValid, false);
  });

  it("rejects unknown flags, invalid identities, bands, and non-finite values", () => {
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ flags: 0x10 }), 0)),
      "snapshot",
    );
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ playerId: 0 }), 0)),
      "corrupt",
    );
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ rangeBand: 9 }), 0)),
      "corrupt",
    );
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ distance: Number.NaN }), 0)),
      "corrupt",
    );
  });
});

describe("Companion team ABI", () => {
  it("publishes the complete player and hero build state", () => {
    const team = decodedTeam(
      readCompanionTeam(
        teamRegion([
          {
            agentId: 7,
            heroId: 0,
            attributes: [
              [17, 12],
              [21, 8],
            ],
          },
          {
            agentId: 100,
            heroId: 1,
            behavior: 2,
            disabledSkills: 0x81,
            skills: [101, 102, 103, 104, 105, 106, 107, 108],
          },
        ]),
        0,
      ),
    );
    assert.equal(team.player.agentId, 7);
    assert.deepEqual(team.player.attributes, [
      { id: 17, rank: 12 },
      { id: 21, rank: 8 },
    ]);
    assert.deepEqual(team.heroIds, [1]);
    assert.deepEqual(team.heroAgentIds, [100]);
    assert.equal(team.heroes[0]?.behavior, 2);
    assert.equal(team.heroes[0]?.disabledSkills, 0x81);
    assert.deepEqual(
      team.heroes[0]?.skills,
      [101, 102, 103, 104, 105, 106, 107, 108],
    );
  });

  it("rejects torn, partial, duplicate, and invalid member state", () => {
    assert.equal(
      teamReason(readCompanionTeam(teamRegion(undefined, { sequence: 3 }), 0)),
      "writing",
    );
    assert.equal(
      teamReason(readCompanionTeam(teamRegion([{ agentId: 7, heroId: 1 }]), 0)),
      "corrupt",
    );
    assert.equal(
      teamReason(
        readCompanionTeam(
          teamRegion([
            { agentId: 7, heroId: 0 },
            { agentId: 7, heroId: 1 },
          ]),
          0,
        ),
      ),
      "corrupt",
    );
    assert.equal(
      teamReason(
        readCompanionTeam(
          teamRegion([
            { agentId: 7, heroId: 0 },
            { agentId: 100, heroId: 1 },
            { agentId: 101, heroId: 1 },
          ]),
          0,
        ),
      ),
      "corrupt",
    );
    assert.equal(
      teamReason(
        readCompanionTeam(teamRegion(undefined, { memberCount: 9 }), 0),
      ),
      "team",
    );
    assert.equal(
      teamReason(readCompanionTeam(teamRegion(undefined, { reserved: 21 }), 0)),
      "corrupt",
    );
    assert.equal(
      teamReason(readCompanionTeam(teamRegion([], { flags: 0 }), 0)),
      "game",
    );
    assert.equal(
      teamReason(
        readCompanionTeam(
          teamRegion(undefined, {
            command: {
              id: 1,
              status: 2,
              phase: 14,
              completedSteps: 4,
              error: 0,
            },
          }),
          0,
        ),
      ),
      "team",
    );
  });

  it("publishes one internally consistent command progress record", () => {
    const team = decodedTeam(
      readCompanionTeam(
        teamRegion(undefined, {
          command: {
            id: 7,
            status: 1,
            phase: 4,
            completedSteps: 1,
            error: 0,
          },
        }),
        0,
      ),
    );
    assert.deepEqual(team.command, {
      id: 7,
      status: 1,
      phase: 4,
      completedSteps: 1,
      error: 0,
      warnings: 0,
    });
  });
});

describe("Companion cursor region ABI", () => {
  it("decodes a published cursor and its RGBA payload", () => {
    const region = cursorRegion();
    const header = readyCursor(readCompanionCursorHeader(region, 0));
    assert.equal(header.status, "ready");
    assert.equal(header.generation, 1);
    assert.equal(header.flags, CURSOR_VALID);
    assert.equal(header.hotspotX, 3);
    assert.equal(header.hotspotY, 4);
    assert.equal(header.pixelHash, 0x1357_9bdf);
    assert.equal(header.hidden, false);

    const full = publishedPixels(readCompanionCursorPixels(region, 0));
    assert.equal(full.status, "ready");
    assert.equal(full.pixels.length, CURSOR_PIXEL_BYTES);
    assert.deepEqual([...full.pixels.slice(0, 4)], [0x60, 0x40, 0x20, 0xff]);
    // The copy is private: mutating the region must not reach it.
    new DataView(region).setUint32(CURSOR.pixels, 0, true);
    assert.equal(full.pixels[0], 0x60);
  });

  it("reports hidden and non-cursor states without inventing geometry", () => {
    const hidden = readyCursor(
      readCompanionCursorHeader(
        cursorRegion({ flags: CURSOR_VALID | CURSOR_HIDDEN }),
        0,
      ),
    );
    assert.equal(hidden.status, "ready");
    assert.equal(hidden.hidden, true);

    const cleared = invalidCursor(
      readCompanionCursorHeader(cursorRegion({ flags: 0 }), 0),
    );
    assert.equal(cleared.status, "invalid");
    assert.equal(cleared.reason, "cursor");
    assert.deepEqual(
      [cleared.hotspotX, cleared.hotspotY, cleared.pixelHash],
      [0, 0, 0],
    );
    assert.equal(
      readCompanionCursorPixels(cursorRegion({ flags: 0 }), 0),
      null,
    );

    const unsupported = invalidCursor(
      readCompanionCursorHeader(cursorRegion({ flags: CURSOR_UNSUPPORTED }), 0),
    );
    assert.equal(unsupported.status, "invalid");
    assert.equal(unsupported.reason, "unsupported");
  });

  it("rejects a torn, foreign, or malformed cursor region", () => {
    const reason = (overrides: CursorOverrides) =>
      cursorReason(readCompanionCursorHeader(cursorRegion(overrides), 0));
    assert.equal(reason({ magic: MAGIC }), "cursor");
    assert.equal(reason({ abi: 2 }), "cursor");
    assert.equal(reason({ byteLength: 64 }), "cursor");
    assert.equal(reason({ sequence: 3 }), "writing");
    assert.equal(reason({ flags: 0x8 }), "cursor");
    assert.equal(reason({ reservedWord: 1, reservedIndex: 5 }), "cursor");
    assert.equal(reason({ width: 64 }), "corrupt");
    assert.equal(reason({ height: 16 }), "corrupt");
    assert.equal(reason({ hotspotX: CURSOR_EDGE }), "corrupt");
    assert.equal(reason({ hotspotY: 99 }), "corrupt");
    assert.equal(reason({ generation: 0 }), "corrupt");
    // Hidden is meaningless without a cursor; unsupported must stand alone.
    assert.equal(reason({ flags: CURSOR_HIDDEN }), "corrupt");
    assert.equal(
      reason({ flags: CURSOR_HIDDEN | CURSOR_UNSUPPORTED }),
      "corrupt",
    );
    assert.equal(
      reason({ flags: CURSOR_VALID | CURSOR_UNSUPPORTED }),
      "corrupt",
    );
    assert.equal(
      reason({ flags: CURSOR_VALID | CURSOR_HIDDEN | CURSOR_UNSUPPORTED }),
      "corrupt",
    );
    assert.equal(
      readCompanionCursorPixels(cursorRegion({ sequence: 3 }), 0),
      null,
    );

    assert.equal(
      cursorReason(readCompanionCursorHeader(new ArrayBuffer(64), 0)),
      "memory",
    );
    assert.equal(
      cursorReason(readCompanionCursorHeader(cursorRegion(), 4)),
      "memory",
    );
    assert.equal(readCompanionCursorPixels(cursorRegion(), -4), null);
  });
});

describe("Companion kernel", () => {
  it("calls the original once and publishes a checked snapshot", async () => {
    const kernel = await createKernel();
    const { view, config, instance } = kernel;
    installGameGraph(view);

    assert.equal(kernel.init({ snapshotPointer: 0xffff_fffc }), 0);
    assert.equal(kernel.init({ snapshotSize: 63 }), 0);
    assert.equal(kernel.init({ configSize: CONFIG_BYTES - 4 }), 0);
    assert.equal(kernel.init(), 1);
    kernel.tick();
    assert.equal(kernel.calls.original, 1);
    const state = decoded(
      readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot),
    );
    assert.equal(state.status, "ready");
    assert.equal(state.tickCount, 1);
    assert.equal(state.playerId, 7);
    assert.equal(state.targetId, 9);
    assert.ok(Math.abs(state.distance - 100) < 0.1);
    assert.equal(state.rangeName, "Adjacent");
    const initialTeam = decodedTeam(kernel.team());
    assert.deepEqual(initialTeam.heroIds, [1]);
    assert.equal(initialTeam.player.primary, 1);
    assert.deepEqual(initialTeam.player.attributes, [{ id: 17, rank: 12 }]);
    assert.deepEqual(initialTeam.heroes[0]?.attributes, [
      { id: 17, rank: 10 },
      { id: 21, rank: 8 },
    ]);
    assert.equal(initialTeam.heroes[0]?.secondary, 6);
    assert.equal(initialTeam.heroes[0]?.behavior, 1);
    assert.equal(initialTeam.heroes[0]?.disabledSkills, 1);
    assert.deepEqual(
      initialTeam.heroes[0]?.skills,
      [101, 102, 103, 104, 105, 106, 107, 108],
    );

    // Each mapped write is acknowledged from game-owned state, not from the
    // command call. Mutating the fixture's four WorldContext arrays must move
    // the next canonical team snapshot together.
    view.setUint32(ADDRESSES.professionBuffer + 0x1c, 9, true);
    view.setUint32(ADDRESSES.heroFlagBuffer + 0x0c, 2, true);
    view.setUint32(ADDRESSES.skillbarBuffer + 0xbc + 0x10, 999, true);
    view.setUint32(ADDRESSES.skillbarBuffer + 0xbc + 0xa4, 5, true);
    view.setUint32(ADDRESSES.attributeBuffer + 0x43c + 0x08, 11, true);
    kernel.tick();
    const changedTeam = decodedTeam(kernel.team());
    assert.notEqual(changedTeam.sequence, initialTeam.sequence);
    assert.equal(changedTeam.heroes[0]?.secondary, 9);
    assert.equal(changedTeam.heroes[0]?.behavior, 2);
    assert.equal(changedTeam.heroes[0]?.disabledSkills, 5);
    assert.equal(changedTeam.heroes[0]?.skills[0], 999);
    assert.deepEqual(changedTeam.heroes[0]?.attributes, [
      { id: 17, rank: 11 },
      { id: 21, rank: 8 },
    ]);

    // Removing the final hero must move the canonical roster snapshot.
    view.setUint32(ADDRESSES.partyInfo + 0x2c, 0, true);
    kernel.tick();
    assert.deepEqual(decodedTeam(kernel.team()).heroIds, []);

    const boundaries: [distance: number, band: number][] = [
      [166, 1],
      [166.25, 2],
      [252.25, 3],
      [322.25, 4],
      [1_012.25, 5],
      [1_248.25, 6],
      [2_500.25, 7],
      [5_000.25, 8],
    ];
    for (const [distance, band] of boundaries) {
      view.setFloat32(ADDRESSES.target + 0x74, 10 + distance, true);
      kernel.tick();
      assert.equal(
        decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
          .rangeBand,
        band,
      );
    }

    view.setUint32(ADDRESSES.manualTargetId, 0, true);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .targetValid,
      false,
    );

    view.setUint32(ADDRESSES.automaticTargetId, 9, true);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .targetId,
      9,
    );

    view.setUint32(ADDRESSES.character + 0x23c, 2, true);
    kernel.tick();
    const loading = readCompanionSnapshot(
      kernel.memory.buffer,
      ADDRESSES.snapshot,
    );
    assert.equal(rejected(loading), "loading");
    assert.equal("playerId" in loading, false);
    assert.equal("targetId" in loading, false);

    view.setUint32(ADDRESSES.character + 0x23c, 0, true);
    view.setFloat32(ADDRESSES.player + 0x74, Number.NaN, true);
    kernel.tick();
    assert.equal(
      rejected(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot)),
      "game",
    );

    config[0] = 0xffff_fffc;
    assert.equal(kernel.init(), 1);
    kernel.tick();
    assert.equal(
      rejected(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot)),
      "game",
    );
    assert.equal(kernel.calls.original, boundaries.length + 8);
    assert.equal(typeof instance.exports.companion_tick, "function");
  });

  it("collects only the explicitly enabled tools", async () => {
    const cursorOnly = await createKernel();
    installGameGraph(cursorOnly.view);
    installCursorGraph(cursorOnly.view);
    paintCursor(cursorOnly.view, 1);
    assert.equal(cursorOnly.init({ features: FEATURE_NATIVE_CURSOR }), 1);
    assert.equal(cursorOnly.view.getUint32(ADDRESSES.snapshot, true), 0);
    cursorOnly.tick();
    assert.equal(publishedPixels(cursorOnly.published()).status, "ready");
    assert.equal(cursorOnly.view.getUint32(ADDRESSES.snapshot, true), 0);

    const readoutOnly = await createKernel();
    installGameGraph(readoutOnly.view);
    installCursorGraph(readoutOnly.view);
    paintCursor(readoutOnly.view, 2);
    assert.equal(readoutOnly.init({ features: FEATURE_TARGET_READOUT }), 1);
    assert.equal(readoutOnly.field(CURSOR.magic), 0);
    readoutOnly.tick();
    const state = decoded(
      readCompanionSnapshot(readoutOnly.memory.buffer, ADDRESSES.snapshot),
    );
    assert.equal(state.status, "ready");
    assert.equal(state.tickCount, 1);
    assert.equal(readoutOnly.field(CURSOR.magic), 0);

    const teamOnly = await createKernel();
    installGameGraph(teamOnly.view);
    assert.equal(teamOnly.init({ features: FEATURE_TEAM_MANAGEMENT }), 1);
    assert.equal(teamOnly.view.getUint32(ADDRESSES.snapshot, true), 0);
    teamOnly.tick();
    assert.deepEqual(decodedTeam(teamOnly.team()).heroIds, [1]);

    assert.equal(cursorOnly.calls.original, 1);
    assert.equal(readoutOnly.calls.original, 1);
    assert.equal(teamOnly.calls.original, 1);
  });

  it("reconciles the owned hero set before touching member builds", async () => {
    const remove = await createKernel();
    installGameGraph(remove.view);
    remove.view.setUint32(ADDRESSES.character + 0x198, 81, true);
    remove.view.setUint32(ADDRESSES.character + 0x234, 81, true);
    assert.equal(remove.init(), 1);
    assert.equal(remove.applyTeam([{ heroId: 0 }]), 1);

    remove.tick();
    assert.deepEqual(remove.calls.removals, [1]);
    assert.deepEqual(remove.calls.additions, []);
    assert.equal(decodedTeam(remove.team()).command.phase, 2);
    assert.equal(remove.calls.professions.length, 0);

    remove.view.setUint32(ADDRESSES.heroBuffer + 0x04, 77, true);
    remove.tick();
    settleCommand(remove);
    assert.deepEqual(decodedTeam(remove.team()).command, {
      id: 1,
      status: 2,
      phase: 19,
      completedSteps: 1,
      error: 0,
      warnings: 0,
    });
    assert.deepEqual(remove.calls.removals, [1]);

    const add = await createKernel();
    installGameGraph(add.view);
    add.view.setUint32(ADDRESSES.character + 0x198, 81, true);
    add.view.setUint32(ADDRESSES.character + 0x234, 81, true);
    add.view.setUint32(ADDRESSES.heroBuffer + 0x04, 77, true);
    assert.equal(add.init(), 1);
    assert.equal(
      add.applyTeam([
        { heroId: 0 },
        { heroId: 1, behavior: 1, disabledSkills: 1 },
      ]),
      1,
    );

    add.tick();
    assert.deepEqual(add.calls.additions, [1]);
    assert.deepEqual(add.calls.removals, []);
    assert.equal(decodedTeam(add.team()).command.phase, 4);
    assert.equal(add.calls.behaviors.length, 0);

    add.view.setUint32(ADDRESSES.heroBuffer + 0x04, 42, true);
    add.tick();
    settleCommand(add);
    assert.deepEqual(decodedTeam(add.team()).command, {
      id: 1,
      status: 2,
      phase: 19,
      completedSteps: 1,
      error: 0,
      warnings: 0,
    });
    assert.deepEqual(add.calls.additions, [1]);
    assert.deepEqual(add.calls.panels, []);
    assert.equal(add.calls.professions.length, 0);
  });

  it("waits for authoritative difficulty readback and applies panel visibility once", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    kernel.view.setUint32(ADDRESSES.character + 0x198, 81, true);
    kernel.view.setUint32(ADDRESSES.character + 0x234, 81, true);
    assert.equal(kernel.init(), 1);
    assert.equal(
      kernel.applyTeam(
        [
          { heroId: 0 },
          {
            heroId: 1,
            behavior: 1,
            disabledSkills: 1,
            panel: 2,
          },
        ],
        2,
      ),
      1,
    );

    kernel.tick();
    assert.deepEqual(kernel.calls.difficulties, [1]);
    assert.equal(decodedTeam(kernel.team()).command.phase, 6);
    assert.equal(decodedTeam(kernel.team()).hardMode, false);
    assert.deepEqual(kernel.calls.panels, []);

    kernel.tick();
    assert.deepEqual(kernel.calls.difficulties, [1]);
    assert.equal(decodedTeam(kernel.team()).command.phase, 6);

    kernel.view.setUint32(ADDRESSES.partyContext + 0x14, 0x10, true);
    kernel.tick();
    assert.deepEqual(kernel.calls.panels, [[1, 1]]);
    settleCommand(kernel);
    assert.deepEqual(decodedTeam(kernel.team()).command, {
      id: 1,
      status: 2,
      phase: 19,
      completedSteps: 2,
      error: 0,
      warnings: 0,
    });
    assert.equal(decodedTeam(kernel.team()).hardMode, true);
  });

  it("reconciles one owned hero only after each authoritative acknowledgement", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    kernel.view.setUint32(ADDRESSES.character + 0x198, 81, true);
    kernel.view.setUint32(ADDRESSES.character + 0x234, 81, true);
    assert.equal(kernel.init(), 1);

    const desiredAttributes = [
      [17, 9],
      [21, 7],
    ] as const;
    const desiredSkills = [108, 107, 106, 105, 104, 103, 102, 101];
    const commandId = kernel.applyTeamWithHeroBuild(
      1,
      1,
      9,
      desiredAttributes,
      desiredSkills,
      2,
      4,
    );
    assert.equal(commandId, 1);

    kernel.tick();
    assert.deepEqual(kernel.calls.professions, [[11, 9]]);
    assert.equal(decodedTeam(kernel.team()).command.phase, 8);
    assert.equal(decodedTeam(kernel.team()).command.completedSteps, 0);
    assert.equal(kernel.calls.attributes.length, 0);

    kernel.view.setUint32(ADDRESSES.professionBuffer + 0x1c, 9, true);
    kernel.tick();
    assert.deepEqual(kernel.calls.attributes, [
      {
        agentId: 11,
        ids: [17, 21],
        ranks: [9, 7],
      },
    ]);
    assert.equal(decodedTeam(kernel.team()).command.phase, 10);
    assert.equal(decodedTeam(kernel.team()).command.completedSteps, 1);
    assert.equal(kernel.calls.skillbars.length, 0);

    const heroAttributes = ADDRESSES.attributeBuffer + 0x43c;
    kernel.view.setUint32(heroAttributes + 0x08, 9, true);
    kernel.view.setUint32(heroAttributes + 0x1c, 7, true);
    for (let tick = 0; tick < 29; tick += 1) kernel.tick();
    assert.equal(kernel.calls.skillbars.length, 0);
    kernel.tick();
    assert.deepEqual(kernel.calls.skillbars, [
      { agentId: 11, skills: desiredSkills },
    ]);
    assert.equal(decodedTeam(kernel.team()).command.phase, 12);
    assert.equal(decodedTeam(kernel.team()).command.completedSteps, 2);

    const heroSkillbar = ADDRESSES.skillbarBuffer + 0xbc;
    desiredSkills.forEach((skill, slot) => {
      kernel.view.setUint32(heroSkillbar + 0x10 + slot * 0x14, skill, true);
    });
    for (let tick = 0; tick < 29; tick += 1) kernel.tick();
    assert.deepEqual(kernel.calls.behaviors, []);
    kernel.tick();
    assert.deepEqual(kernel.calls.behaviors, [[11, 2]]);
    assert.equal(decodedTeam(kernel.team()).command.phase, 14);
    assert.equal(decodedTeam(kernel.team()).command.completedSteps, 3);

    kernel.view.setUint32(ADDRESSES.heroFlagBuffer + 0x0c, 2, true);
    kernel.tick();
    assert.deepEqual(kernel.calls.toggles, [[11, 0]]);
    assert.equal(decodedTeam(kernel.team()).command.phase, 16);
    assert.equal(decodedTeam(kernel.team()).command.completedSteps, 4);

    kernel.view.setUint32(heroSkillbar + 0xa4, 0, true);
    kernel.tick();
    assert.deepEqual(kernel.calls.toggles, [
      [11, 0],
      [11, 2],
    ]);
    assert.equal(decodedTeam(kernel.team()).command.phase, 16);
    assert.equal(decodedTeam(kernel.team()).command.completedSteps, 5);

    kernel.view.setUint32(heroSkillbar + 0xa4, 4, true);
    kernel.tick();
    settleCommand(kernel);
    assert.deepEqual(decodedTeam(kernel.team()).command, {
      id: commandId,
      status: 2,
      phase: 19,
      completedSteps: 6,
      error: 0,
      warnings: 0,
    });
    assert.equal(kernel.calls.professions.length, 1);
    assert.equal(kernel.calls.attributes.length, 1);
    assert.equal(kernel.calls.skillbars.length, 1);
    assert.equal(kernel.calls.behaviors.length, 1);
    assert.equal(kernel.calls.toggles.length, 2);
    assert.deepEqual(kernel.calls.panels, []);
  });

  it("accepts a stable skill bar with unavailable skills omitted and reports one warning", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    kernel.view.setUint32(ADDRESSES.character + 0x198, 449, true);
    kernel.view.setUint32(ADDRESSES.character + 0x234, 449, true);
    assert.equal(kernel.init(), 1);

    const desiredSkills = [201, 202, 203, 204, 205, 206, 207, 208];
    assert.equal(
      kernel.applyTeamWithHeroBuild(
        1,
        1,
        6,
        [
          [17, 10],
          [21, 8],
        ],
        desiredSkills,
      ),
      1,
    );
    kernel.tick();
    assert.deepEqual(kernel.calls.skillbars, [
      { agentId: 11, skills: desiredSkills },
    ]);

    const heroSkillbar = ADDRESSES.skillbarBuffer + 0xbc;
    desiredSkills.forEach((skill, slot) => {
      kernel.view.setUint32(
        heroSkillbar + 0x10 + slot * 0x14,
        slot === 1 || slot === 6 ? 0 : skill,
        true,
      );
    });
    for (let tick = 0; tick < 29; tick += 1) kernel.tick();
    assert.equal(decodedTeam(kernel.team()).command.status, 1);
    kernel.tick();
    settleCommand(kernel);

    assert.deepEqual(decodedTeam(kernel.team()).command, {
      id: 1,
      status: 2,
      phase: 19,
      completedSteps: 1,
      error: 0,
      warnings: 1,
    });
    assert.equal(kernel.calls.skillbars.length, 1);
  });

  it("does not accept a transient local attribute echo as server acknowledgement", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    kernel.view.setUint32(ADDRESSES.character + 0x198, 449, true);
    kernel.view.setUint32(ADDRESSES.character + 0x234, 449, true);
    assert.equal(kernel.init(), 1);
    assert.equal(
      kernel.applyTeamWithHeroBuild(
        1,
        1,
        6,
        [
          [17, 9],
          [21, 9],
        ],
        [201, 202, 203, 204, 205, 206, 207, 208],
      ),
      1,
    );
    kernel.tick();
    assert.equal(kernel.calls.attributes.length, 1);

    const heroAttributes = ADDRESSES.attributeBuffer + 0x43c;
    kernel.view.setUint32(heroAttributes + 0x08, 9, true);
    kernel.view.setUint32(heroAttributes + 0x1c, 9, true);
    for (let tick = 0; tick < 10; tick += 1) kernel.tick();
    kernel.view.setUint32(heroAttributes + 0x08, 10, true);
    kernel.view.setUint32(heroAttributes + 0x1c, 8, true);
    for (let tick = 0; tick < 290; tick += 1) kernel.tick();

    assert.deepEqual(decodedTeam(kernel.team()).command, {
      id: 1,
      status: 3,
      phase: 10,
      completedSteps: 0,
      error: 4,
      warnings: 0,
    });
    assert.equal(kernel.calls.attributes.length, 1);
    assert.equal(kernel.calls.skillbars.length, 0);
  });

  it("skips matching fields without issuing game calls", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    kernel.view.setUint32(ADDRESSES.character + 0x198, 449, true);
    kernel.view.setUint32(ADDRESSES.character + 0x234, 449, true);
    assert.equal(kernel.init(), 1);
    assert.equal(
      kernel.applyTeamWithHeroBuild(
        1,
        1,
        6,
        [
          [17, 10],
          [21, 8],
        ],
        [101, 102, 103, 104, 105, 106, 107, 108],
      ),
      1,
    );
    kernel.tick();
    settleCommand(kernel);
    assert.deepEqual(decodedTeam(kernel.team()).command, {
      id: 1,
      status: 2,
      phase: 19,
      completedSteps: 0,
      error: 0,
      warnings: 0,
    });
    assert.equal(kernel.calls.professions.length, 0);
    assert.equal(kernel.calls.attributes.length, 0);
    assert.equal(kernel.calls.skillbars.length, 0);
    assert.equal(kernel.calls.behaviors.length, 0);
    assert.equal(kernel.calls.toggles.length, 0);
    assert.deepEqual(kernel.calls.panels, []);
  });

  it("rejects malformed or concurrent desired builds before a game call", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    kernel.view.setUint32(ADDRESSES.character + 0x198, 449, true);
    kernel.view.setUint32(ADDRESSES.character + 0x234, 449, true);
    assert.equal(kernel.init(), 1);
    const skills = [101, 102, 103, 104, 105, 106, 107, 108];
    assert.equal(kernel.applyTeamWithHeroBuild(0, 1, 6, [[17, 10]], skills), 0);
    assert.equal(kernel.applyTeamWithHeroBuild(1, 1, 1, [[17, 10]], skills), 0);
    assert.equal(
      kernel.applyTeamWithHeroBuild(
        1,
        1,
        6,
        [
          [17, 10],
          [17, 8],
        ],
        skills,
      ),
      0,
    );
    assert.equal(kernel.applyTeamWithHeroBuild(1, 1, 6, [[17, 10]], skills, 3, 1), 0);
    assert.equal(
      kernel.applyTeamWithHeroBuild(1, 1, 6, [[17, 10]], skills, 1, 0x100),
      0,
    );
    assert.equal(kernel.applyTeamWithHeroBuild(1, 1, 6, [[17, 13]], skills), 0);
    assert.equal(
      kernel.applyTeamWithHeroBuild(
        1,
        1,
        6,
        [[17, 10]],
        [101, 101, 103, 104, 105, 106, 107, 108],
      ),
      0,
    );
    assert.equal(kernel.applyTeamWithHeroBuild(1, 1, 9, [[17, 10]], skills), 1);
    assert.equal(kernel.applyTeamWithHeroBuild(1, 1, 6, [[17, 10]], skills), 0);
    assert.equal(kernel.calls.professions.length, 0);
    assert.equal(kernel.calls.attributes.length, 0);
    assert.equal(kernel.calls.skillbars.length, 0);
  });

  it("preflights hero availability and party capacity but lets Guild Wars decide low-level builds", async () => {
    const unavailable = await createKernel();
    installGameGraph(unavailable.view);
    // The authoritative outpost hero_info array now contains only HeroIDs
    // 1-5. HeroID 6 is known to the product catalogue but unavailable here.
    unavailable.view.setUint32(ADDRESSES.world + 0x059c, 5, true);
    assert.equal(unavailable.init(), 1);
    assert.equal(
      unavailable.applyTeam([
        { heroId: 0 },
        { heroId: 6, behavior: 1 },
      ]),
      1,
    );
    unavailable.tick();
    assert.equal(decodedTeam(unavailable.team()).command.error, 6);
    assert.equal(gameWriteCount(unavailable), 0);

    const lowLevel = await createKernel();
    installGameGraph(lowLevel.view);
    lowLevel.view.setUint32(ADDRESSES.heroBuffer + 0x14, 4, true);
    lowLevel.view.setUint32(ADDRESSES.heroInfoBuffer + 0x08, 4, true);
    assert.equal(lowLevel.init(), 1);
    assert.equal(
      lowLevel.applyTeamWithHeroBuild(
        1,
        1,
        6,
        [[17, 12], [21, 8]],
        [101, 102, 103, 104, 105, 106, 107, 108],
      ),
      1,
    );
    lowLevel.tick();
    assert.equal(decodedTeam(lowLevel.team()).command.error, 0);
    assert.equal(decodedTeam(lowLevel.team()).command.status, 1);
    assert.equal(gameWriteCount(lowLevel), 1);
    assert.equal(lowLevel.calls.attributes.length, 1);

    const overCapacity = await createKernel();
    installGameGraph(overCapacity.view);
    overCapacity.view.setUint32(
      ADDRESSES.areaInfo + 133 * 124 + 0x1c,
      2,
      true,
    );
    assert.equal(overCapacity.init(), 1);
    assert.equal(
      overCapacity.applyTeam([
        { heroId: 0 },
        { heroId: 1, behavior: 1 },
      ]),
      1,
    );
    overCapacity.tick();
    assert.equal(decodedTeam(overCapacity.team()).command.error, 7);
    assert.equal(gameWriteCount(overCapacity), 0);
  });

  it("fails closed in PvP, guild halls, and after hero removal", async () => {
    const unsafeMap = await createKernel();
    installGameGraph(unsafeMap.view);
    unsafeMap.view.setUint32(ADDRESSES.character + 0x198, 188, true);
    unsafeMap.view.setUint32(ADDRESSES.character + 0x234, 188, true);
    unsafeMap.view.setUint32(
      ADDRESSES.areaInfo + 188 * 124 + 0x10,
      0x040c_0003,
      true,
    );
    assert.equal(unsafeMap.init(), 1);
    assert.equal(
      unsafeMap.applyTeamWithHeroBuild(
        1,
        1,
        9,
        [[17, 10]],
        [101, 102, 103, 104, 105, 106, 107, 108],
      ),
      1,
    );
    unsafeMap.tick();
    assert.equal(decodedTeam(unsafeMap.team()).command.error, 2);
    assert.equal(unsafeMap.calls.professions.length, 0);

    const guildHall = await createKernel();
    installGameGraph(guildHall.view);
    guildHall.view.setUint32(ADDRESSES.character + 0x198, 4, true);
    guildHall.view.setUint32(ADDRESSES.character + 0x234, 4, true);
    guildHall.view.setUint32(
      ADDRESSES.areaInfo + 4 * 124 + 0x10,
      0x0080_0000,
      true,
    );
    assert.equal(guildHall.init(), 1);
    assert.equal(
      guildHall.applyTeamWithHeroBuild(
        1,
        1,
        9,
        [[17, 10]],
        [101, 102, 103, 104, 105, 106, 107, 108],
      ),
      1,
    );
    guildHall.tick();
    assert.equal(decodedTeam(guildHall.team()).command.error, 2);
    assert.equal(guildHall.calls.professions.length, 0);

    const removed = await createKernel();
    installGameGraph(removed.view);
    removed.view.setUint32(ADDRESSES.character + 0x198, 449, true);
    removed.view.setUint32(ADDRESSES.character + 0x234, 449, true);
    assert.equal(removed.init(), 1);
    assert.equal(
      removed.applyTeamWithHeroBuild(
        1,
        1,
        9,
        [[17, 10]],
        [101, 102, 103, 104, 105, 106, 107, 108],
      ),
      1,
    );
    removed.tick();
    assert.equal(removed.calls.professions.length, 1);
    removed.view.setUint32(ADDRESSES.partyInfo + 0x2c, 0, true);
    removed.tick();
    assert.equal(decodedTeam(removed.team()).command.error, 5);
    assert.equal(removed.calls.professions.length, 1);
  });

  it("times out without retrying an unacknowledged write", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    kernel.view.setUint32(ADDRESSES.character + 0x198, 449, true);
    kernel.view.setUint32(ADDRESSES.character + 0x234, 449, true);
    assert.equal(kernel.init(), 1);
    assert.equal(
      kernel.applyTeamWithHeroBuild(
        1,
        1,
        9,
        [[17, 10]],
        [101, 102, 103, 104, 105, 106, 107, 108],
      ),
      1,
    );
    for (let tick = 0; tick <= 300; tick += 1) kernel.tick();
    assert.equal(decodedTeam(kernel.team()).command.error, 4);
    assert.equal(kernel.calls.professions.length, 1);
  });

  it("does not retry unacknowledged behavior or skill toggles", async () => {
    const behavior = await createKernel();
    installGameGraph(behavior.view);
    behavior.view.setUint32(ADDRESSES.character + 0x198, 449, true);
    behavior.view.setUint32(ADDRESSES.character + 0x234, 449, true);
    assert.equal(behavior.init(), 1);
    assert.equal(
      behavior.applyTeamWithHeroBuild(
        1,
        1,
        6,
        [
          [17, 10],
          [21, 8],
        ],
        [101, 102, 103, 104, 105, 106, 107, 108],
        2,
        1,
      ),
      1,
    );
    behavior.tick();
    for (let tick = 0; tick < 300; tick += 1) behavior.tick();
    assert.equal(decodedTeam(behavior.team()).command.error, 4);
    assert.deepEqual(behavior.calls.behaviors, [[11, 2]]);

    const toggle = await createKernel();
    installGameGraph(toggle.view);
    toggle.view.setUint32(ADDRESSES.character + 0x198, 449, true);
    toggle.view.setUint32(ADDRESSES.character + 0x234, 449, true);
    assert.equal(toggle.init(), 1);
    assert.equal(
      toggle.applyTeamWithHeroBuild(
        1,
        1,
        6,
        [
          [17, 10],
          [21, 8],
        ],
        [101, 102, 103, 104, 105, 106, 107, 108],
        1,
        0,
      ),
      1,
    );
    toggle.tick();
    for (let tick = 0; tick < 300; tick += 1) toggle.tick();
    assert.equal(decodedTeam(toggle.team()).command.error, 4);
    assert.deepEqual(toggle.calls.toggles, [[11, 0]]);
  });

  it("rejects empty, unknown, missing, or unselected feature regions", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.init({ features: 0 }), 0);
    assert.equal(kernel.init({ features: 1 << 3 }), 0);
    assert.equal(
      kernel.init({
        features: FEATURE_NATIVE_CURSOR,
        cursorPointer: 0,
        cursorSize: 0,
      }),
      0,
    );
    assert.equal(
      kernel.init({
        features: FEATURE_TEAM_MANAGEMENT,
        teamPointer: 0,
        teamSize: 0,
      }),
      0,
    );
    assert.equal(
      kernel.init({
        features: FEATURE_TARGET_READOUT,
        snapshotPointer: 0,
        snapshotSize: 0,
      }),
      0,
    );
    assert.equal(
      kernel.init({
        features: FEATURE_NATIVE_CURSOR,
        snapshotPointer: ADDRESSES.snapshot,
        snapshotSize: 64,
      }),
      0,
    );
    assert.equal(
      kernel.init({
        features: FEATURE_TARGET_READOUT,
        cursorPointer: ADDRESSES.cursor,
        cursorSize: COMPANION_CURSOR_BYTES,
      }),
      0,
    );

    kernel.tick();
    assert.equal(kernel.calls.original, 1);
    assert.equal(kernel.view.getUint32(ADDRESSES.snapshot, true), 0);
    assert.equal(kernel.view.getUint32(ADDRESSES.teamSnapshot, true), 0);
    assert.equal(kernel.field(CURSOR.magic), 0);
  });

  it("rejects a cursor region of the wrong size, alignment, or extent", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.init({ cursorSize: COMPANION_CURSOR_BYTES - 1 }), 0);
    assert.equal(kernel.init({ cursorSize: COMPANION_CURSOR_BYTES + 1 }), 0);
    assert.equal(kernel.init({ cursorSize: 64 }), 0);
    assert.equal(kernel.init({ cursorPointer: ADDRESSES.cursor + 1 }), 0);
    assert.equal(kernel.init({ cursorPointer: ADDRESSES.cursor + 2 }), 0);
    // 16 MiB of memory: this region is aligned but runs past the end.
    assert.equal(kernel.init({ cursorPointer: 0xff_f000 }), 0);
    assert.equal(kernel.init({ cursorPointer: 0xffff_f000 }), 0);
    // A rejected init must leave the kernel dormant.
    kernel.tick();
    assert.equal(kernel.calls.original, 1);
    assert.equal(kernel.field(CURSOR.magic), 0);
    assert.equal(kernel.init(), 1);
  });

  it("publishes a validated 32x32 cursor once per distinct cursor", async () => {
    const kernel = await createKernel();
    const { view } = kernel;
    installCursorGraph(view, { hotspotX: 5, hotspotY: 7 });
    const first = paintCursor(view, 1);
    assert.equal(kernel.init(), 1);

    // The region comes from the game's allocator, so init clears it.
    const cleared = invalidCursor(kernel.header());
    assert.equal(cleared.status, "invalid");
    assert.equal(cleared.reason, "cursor");
    assert.equal(kernel.field(CURSOR.generation), 0);
    assert.deepEqual(
      [...kernel.payload().slice(0, 8)],
      [0, 0, 0, 0, 0, 0, 0, 0],
    );

    kernel.tick();
    const ready = publishedPixels(kernel.published());
    assert.equal(ready.status, "ready");
    assert.equal(ready.generation, 1);
    assert.equal(ready.flags, CURSOR_VALID);
    assert.equal(ready.hidden, false);
    assert.equal(ready.hotspotX, 5);
    assert.equal(ready.hotspotY, 7);
    assert.equal(ready.pixelHash, fnv1a(first));
    assert.equal(kernel.field(CURSOR.magic), CURSOR_MAGIC);
    assert.equal(
      view.getUint16(ADDRESSES.cursor + CURSOR.abi, true),
      COMPANION_CURSOR_ABI,
    );
    assert.equal(
      view.getUint16(ADDRESSES.cursor + CURSOR.byteLength, true),
      COMPANION_CURSOR_BYTES,
    );
    assert.equal(kernel.field(CURSOR.width), CURSOR_EDGE);
    assert.equal(kernel.field(CURSOR.height), CURSOR_EDGE);
    // BGRA 0xff112233 -> R 0x11, G 0x22, B 0x33, A 0xff.
    assert.deepEqual([...ready.pixels.slice(0, 4)], [0x11, 0x22, 0x33, 0xff]);
    assert.deepEqual(ready.pixels, expectedRgba(first));

    const sequence = kernel.field(CURSOR.sequence);
    assert.equal(sequence % 2, 0);
    for (let index = 0; index < 12; index += 1) kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 1);
    assert.equal(kernel.field(CURSOR.sequence), sequence);

    const second = paintCursor(view, 2);
    kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 2);
    assert.equal(kernel.field(CURSOR.pixelHash), fnv1a(second));
    assert.deepEqual(
      publishedPixels(kernel.published()).pixels,
      expectedRgba(second),
    );
    kernel.tick();
    kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 2);

    // Identical pixels, moved hotspot: the pixel hash cannot see this, so the
    // published identity must carry the hotspot too.
    view.setUint32(ADDRESSES.art + 0x04, 9, true);
    kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 3);
    assert.equal(kernel.field(CURSOR.pixelHash), fnv1a(second));
    assert.equal(readyCursor(kernel.header()).hotspotY, 9);

    // Show/hide moves the flags only: the bitmap is unchanged, so generation
    // holds and the renderer's CSS cache stays warm.
    view.setInt32(ADDRESSES.showCount, -1, true);
    kernel.tick();
    const gone = readyCursor(kernel.header());
    assert.equal(gone.status, "ready");
    assert.equal(gone.flags, CURSOR_VALID | CURSOR_HIDDEN);
    assert.equal(gone.hidden, true);
    assert.equal(gone.generation, 3);
    assert.deepEqual(kernel.payload(), expectedRgba(second));
    view.setInt32(ADDRESSES.showCount, 0, true);
    kernel.tick();
    assert.equal(readyCursor(kernel.header()).flags, CURSOR_VALID);
    assert.equal(kernel.field(CURSOR.generation), 3);
    assert.deepEqual(kernel.payload(), expectedRgba(second));

    assert.equal(kernel.calls.original, 19);
  });

  it("never publishes an uncommitted colour buffer as a cursor", async () => {
    const kernel = await createKernel();
    installCursorGraph(kernel.view);
    assert.equal(kernel.init(), 1);
    const sequence = kernel.field(CURSOR.sequence);
    for (let index = 0; index < 5; index += 1) kernel.tick();
    const header = invalidCursor(kernel.header());
    assert.equal(header.status, "invalid");
    assert.equal(header.flags, 0);
    assert.equal(kernel.field(CURSOR.generation), 0);
    assert.equal(kernel.field(CURSOR.sequence), sequence);
    assert.equal(kernel.published(), null);

    paintCursor(kernel.view, 4);
    kernel.tick();
    assert.equal(kernel.header().status, "ready");
    assert.equal(kernel.field(CURSOR.generation), 1);
  });

  it("keeps the last good pixels while the software cursor is live", async () => {
    const kernel = await createKernel();
    const { view } = kernel;
    installCursorGraph(view);
    const good = paintCursor(view, 5);
    assert.equal(kernel.init(), 1);
    kernel.tick();
    assert.equal(readyCursor(kernel.header()).generation, 1);

    view.setUint32(ADDRESSES.softwareModel, 1, true);
    const replacement = paintCursor(view, 6);
    for (let index = 0; index < 3; index += 1) kernel.tick();
    const unsupported = invalidCursor(kernel.header());
    assert.equal(unsupported.status, "invalid");
    assert.equal(unsupported.reason, "unsupported");
    assert.equal(unsupported.flags, CURSOR_UNSUPPORTED);
    assert.equal(kernel.field(CURSOR.generation), 1);
    assert.deepEqual(kernel.payload(), expectedRgba(good));

    view.setUint32(ADDRESSES.softwareModel, 0, true);
    kernel.tick();
    const recovered = publishedPixels(kernel.published());
    assert.equal(recovered.status, "ready");
    assert.equal(recovered.generation, 2);
    assert.deepEqual(recovered.pixels, expectedRgba(replacement));
  });

  it("clears validity for every rejected art, handle, or texture", async () => {
    const kernel = await createKernel();
    const { view } = kernel;
    installCursorGraph(view);
    const words = paintCursor(view, 7);
    assert.equal(kernel.init(), 1);
    kernel.tick();
    assert.equal(readyCursor(kernel.header()).generation, 1);

    const rejections: [name: string, breakGraph: () => void][] = [
      ["texture type", () => view.setUint32(ADDRESSES.texture + 0x0c, 9, true)],
      [
        "texture width",
        () => view.setUint32(ADDRESSES.texture + 0x14, 64, true),
      ],
      [
        "texture height",
        () => view.setUint32(ADDRESSES.texture + 0x18, 16, true),
      ],
      [
        "access key",
        () => view.setUint32(ADDRESSES.handle + 0x08, TEXTURE_KEY + 1, true),
      ],
      ["null art", () => view.setUint32(ADDRESSES.activeArt, 0, true)],
      [
        "misaligned art",
        () => view.setUint32(ADDRESSES.activeArt, ADDRESSES.art + 1, true),
      ],
      [
        "hotspot x",
        () => view.setUint32(ADDRESSES.art + 0x00, CURSOR_EDGE, true),
      ],
      [
        "hotspot y",
        () => view.setUint32(ADDRESSES.art + 0x04, 0xffff_ffff, true),
      ],
    ];
    let generation = 1;
    for (const [name, breakGraph] of rejections) {
      breakGraph();
      kernel.tick();
      const broken = invalidCursor(kernel.header());
      assert.equal(broken.status, "invalid", name);
      assert.equal(broken.reason, "cursor", name);
      assert.equal(broken.flags, 0, name);
      assert.equal(kernel.published(), null, name);
      // Header-only: the renderer keeps rendering the last good bitmap.
      assert.equal(kernel.field(CURSOR.generation), generation, name);
      assert.deepEqual(kernel.payload(), expectedRgba(words), name);

      installCursorGraph(view);
      kernel.tick();
      generation += 1;
      assert.equal(kernel.header().status, "ready", name);
      assert.equal(kernel.field(CURSOR.generation), generation, name);
    }
  });
});
