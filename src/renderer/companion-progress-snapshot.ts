/**
 * Strict decoder for the companion's bounded progress publication.
 *
 * The static AreaInfo rows are decoded once per installation and reused; the
 * per-character bitsets are decoded on every accepted publication. A torn,
 * malformed or non-PvE publication withdraws progress instead of showing
 * an empty record.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";
import type { AreaRow, GameProgressState, ProgressBits } from "../shared/game-progress.js";
import { createCompanionRegionInstallation } from "./companion-region-installation.js";
import { CONTINUOUS_COMPANION_FRESHNESS } from "./companion-sequence-feed.js";

const ABI = COMPANION_ABI.progress;
const MAGIC = 0x5047_5747;
const FLAGS = Object.freeze({
  ready: 1, loading: 2, missions: 4, vanquishes: 8, titles: 16, areas: 32,
});
const KNOWN_FLAGS = Object.values(FLAGS).reduce((all, flag) => all | flag, 0);
const WORDS = COMPANION_ABI.travelUnlockWords;
const MISSIONS_AT = 32;
const VANQUISHED_AT = MISSIONS_AT + ABI.missionSets * WORDS * 4;
const TITLES_AT = VANQUISHED_AT + WORDS * 4;
const AREAS_AT = TITLES_AT + ABI.titles * 8;
const ROW_READ = 1 << 31;
const ROW_THUMBNAIL = 1 << 30;

const waiting = (reason: "loading" | "unavailable" | "snapshot") =>
  Object.freeze({ status: "waiting", reason } as const);

function bits(view: DataView, at: number): ProgressBits {
  return Object.freeze(Array.from({ length: WORDS }, (_, index) => view.getUint32(at + index * 4, true)));
}

function areaRows(view: DataView, count: number): readonly AreaRow[] {
  const rows: AreaRow[] = [];
  for (let mapId = 0; mapId < count; mapId += 1) {
    const at = AREAS_AT + mapId * ABI.areaWords * 4;
    const packed = view.getUint32(at, true);
    if ((packed & ROW_READ) === 0) continue;
    rows.push(Object.freeze({
      mapId,
      campaign: packed & 0xff,
      continent: (packed >>> 8) & 0xff,
      region: (packed >>> 16) & 0xff,
      type: (packed >>> 24) & 0x3f,
      thumbnail: (packed & ROW_THUMBNAIL) !== 0,
      flags: view.getUint32(at + 4, true),
      nameId: view.getUint32(at + 8, true),
      x: view.getUint32(at + 12, true),
      y: view.getUint32(at + 16, true),
    }));
  }
  return Object.freeze(rows);
}

/**
 * Returns a reader that keeps the decoded AreaInfo rows. They are game
 * constants, so one decode serves every later publication.
 */
export function createCompanionProgressReader() {
  let areas: Readonly<{ count: number; rows: readonly AreaRow[] }> | null = null;
  return function readCompanionProgress(buffer: ArrayBuffer, pointer: number): GameProgressState {
    if (!Number.isInteger(pointer) || pointer <= 0 || pointer % 4 !== 0
      || pointer + ABI.bytes > buffer.byteLength) return waiting("unavailable");
    const view = new DataView(buffer, pointer, ABI.bytes);
    const sequence = view.getUint32(8, true);
    if ((sequence & 1) !== 0 || view.getUint32(0, true) !== MAGIC
      || view.getUint16(4, true) !== ABI.abi || view.getUint16(6, true) !== ABI.bytes) {
      return waiting("snapshot");
    }
    const flags = view.getUint32(12, true);
    const mapId = view.getUint32(16, true);
    const keyLow = view.getUint32(20, true);
    const keyHigh = view.getUint32(24, true);
    const areaCount = view.getUint32(28, true);
    if ((flags & ~KNOWN_FLAGS) !== 0 || areaCount > ABI.areaRows
      || ((flags & FLAGS.areas) !== 0) !== (areaCount !== 0)) return waiting("snapshot");
    if ((flags & FLAGS.ready) === 0) {
      return view.getUint32(8, true) === sequence
        ? waiting((flags & FLAGS.loading) !== 0 ? "loading" : "unavailable")
        : waiting("snapshot");
    }
    if (mapId === 0 || (keyLow === 0 && keyHigh === 0)) return waiting("snapshot");
    if (areaCount !== 0 && areas?.count !== areaCount) {
      areas = Object.freeze({ count: areaCount, rows: areaRows(view, areaCount) });
    }
    const missions = (flags & FLAGS.missions) === 0 ? null : Object.freeze({
      completed: bits(view, MISSIONS_AT),
      bonus: bits(view, MISSIONS_AT + WORDS * 4),
      completedHm: bits(view, MISSIONS_AT + WORDS * 8),
      bonusHm: bits(view, MISSIONS_AT + WORDS * 12),
    });
    const vanquished = (flags & FLAGS.vanquishes) === 0 ? null : bits(view, VANQUISHED_AT);
    // The client shows a percent title as points / 10 only when props bit 0 is set.
    const cartographer = (flags & FLAGS.titles) === 0 ? null : Object.freeze(
      Array.from({ length: ABI.titles }, (_, index) => {
        const props = view.getUint32(TITLES_AT + index * 8, true);
        const points = view.getUint32(TITLES_AT + index * 8 + 4, true);
        return (props & 1) === 1 && points <= 1_000 ? points / 10 : null;
      }),
    );
    if (view.getUint32(8, true) !== sequence) return waiting("snapshot");
    return Object.freeze({
      status: "ready",
      sequence,
      mapId,
      characterKey: `${keyHigh.toString(16).padStart(8, "0")}${keyLow.toString(16).padStart(8, "0")}`,
      missions,
      vanquished,
      cartographer,
      areas: areas?.rows ?? Object.freeze([]),
    });
  };
}

const sameWords = (left: ProgressBits | null, right: ProgressBits | null) =>
  left === right || (left !== null && right !== null && left.every((word, index) => word === right[index]));

/** Equal content keeps subscribers quiet; the kernel republishes every tick. */
export function sameGameProgress(previous: GameProgressState, next: GameProgressState): boolean {
  if (previous.status !== "ready" || next.status !== "ready") return previous === next;
  return previous.mapId === next.mapId && previous.characterKey === next.characterKey
    && previous.areas === next.areas
    && sameWords(previous.vanquished, next.vanquished)
    && (previous.missions === next.missions || (previous.missions !== null && next.missions !== null
      && sameWords(previous.missions.completed, next.missions.completed)
      && sameWords(previous.missions.bonus, next.missions.bonus)
      && sameWords(previous.missions.completedHm, next.missions.completedHm)
      && sameWords(previous.missions.bonusHm, next.missions.bonusHm)))
    && (previous.cartographer === next.cartographer || (previous.cartographer !== null && next.cartographer !== null
      && previous.cartographer.every((value, index) => value === next.cartographer![index])));
}

export function createProgressObservationInstallation(available: boolean) {
  return createCompanionRegionInstallation<GameProgressState>({
    available, name: "progress", bytes: ABI.bytes,
    waiting: { status: "waiting", reason: "unavailable" },
    stale: { status: "waiting", reason: "unavailable" },
    freshness: CONTINUOUS_COMPANION_FRESHNESS,
    sameReadyState: sameGameProgress,
  });
}
