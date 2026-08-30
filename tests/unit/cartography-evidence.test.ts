import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import type {
  CartographyEvidenceCapture,
  CartographyEvidenceDraft,
  CartographyEvidenceReport,
} from "../../src/shared/cartography-evidence.ts";
import type { ClientSession } from "../../src/shared/contracts.ts";
import {
  buildCartographyEvidenceReport,
  parseCartographyEvidenceCapture,
  renderCartographyEvidencePreview,
} from "../../src/tools/cartography-evidence/capture.ts";
import {
  compareCartographyEvidence,
  decodeCartographyBitset,
  encodeCartographyBitset,
  mergeCartographyEvidence,
  parseCartographyEvidence,
  sealCartographyEvidence,
  validateCartographyEvidence,
} from "../../src/tools/cartography-evidence/report.ts";
import {
  readCartographyEvidence,
} from "../../src/tools/cartography-evidence/io.ts";

const execFileAsync = promisify(execFile);

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

const SESSION: ClientSession = {
  appVersion: "2026.8.10",
  compatibility: null,
  extendedMemory: null,
  healthToken: null,
};

function words(...cells: number[]): Uint32Array {
  const value = new Uint32Array(2);
  for (const cell of cells) value[cell >>> 5] = value[cell >>> 5]! | (1 << (cell & 31));
  return value;
}

function capture(): CartographyEvidenceCapture {
  return {
    source: {
      layoutId: 1,
      gridRevision: 1,
      toolboxSha256: HASH_B,
      kernelSha256: HASH_C,
    },
    continent: {
      status: "ready",
      continentId: 0,
      explored: { width: 8, height: 8, words: words(0, 1) },
      creditable: { width: 8, height: 8, words: words(0, 1, 2, 3) },
    },
    currentInstance: {
      status: "unavailable",
      reason: "kernel",
      mapId: 58,
      areaEpoch: 2,
      resourceGeneration: null,
      kernel: null,
    },
  };
}

function report(exploredCells: number[], options: Readonly<{
  client?: string;
  toolbox?: string;
  current?: boolean;
}> = {}): CartographyEvidenceReport {
  const explored = encodeCartographyBitset(8, 8, words(...exploredCells));
  const creditableWords = words(0, 1, 2, 3, 4, 5, 6, 7);
  const creditable = encodeCartographyBitset(8, 8, creditableWords);
  const remaining = encodeCartographyBitset(
    8, 8, Uint32Array.from(creditableWords, (value, index) => value & ~words(...exploredCells)[index]!),
  );
  const source = {
    applicationVersion: "2026.8.10",
    clientSha256: options.client ?? HASH_A,
    layoutId: 1 as const,
    gridRevision: 1,
    toolboxSha256: options.toolbox ?? HASH_B,
    kernelSha256: HASH_C,
  };
  const current = options.current === false ? null : {
    status: "ready" as const,
    mapId: 58,
    instanceType: "explorable" as const,
    areaEpoch: 2,
    resourceGeneration: 3,
    revealRadius: 1 as const,
    worldAnchor: { x: 1, y: 2 },
    mapBounds: { min: { x: 1, y: 2 }, max: { x: 9, y: 10 } },
    reachable: encodeCartographyBitset(8, 8, words(2, 3, 4)),
    actionable: encodeCartographyBitset(
      8, 8, words(...[2, 3, 4].filter((cell) => !exploredCells.includes(cell))),
    ),
    terrain: {
      mapLeft: 1,
      mapTop: 2,
      mapUnitsPerPixel: 2,
      cells: encodeCartographyBitset(2, 2, Uint32Array.of(0b1111)),
    },
    kernel: {
      status: "ready" as const,
      reason: null,
      planeCount: 2,
      totalTrapezoids: 100,
      reachableTrapezoids: 40,
      groundCells: 3,
      doorwayCount: 1,
      terrainWidth: 2,
      terrainHeight: 2,
      planeLimit: 256,
      trapezoidLimit: 65_536,
      doorwayLimit: 256,
      terrainCellLimit: 262_144,
    },
  };
  const draft: CartographyEvidenceDraft = {
    formatVersion: 1,
    reportId: randomUUID(),
    capturedAt: "2026-08-30T12:00:00.000Z",
    source,
    continent: {
      status: "ready",
      continentId: 0,
      explored,
      creditable,
      remainingEstimate: remaining,
    },
    currentInstance: current,
  };
  return sealCartographyEvidence(draft);
}

describe("Cartography evidence", () => {
  it("encodes little-endian bitsets deterministically and rejects tail data", () => {
    const encoded = encodeCartographyBitset(8, 8, words(0, 31, 32, 63));
    assert.deepEqual([...decodeCartographyBitset(encoded)], [...words(0, 31, 32, 63)]);
    assert.equal(
      encodeCartographyBitset(8, 8, words(0, 31, 32, 63)).sha256,
      encoded.sha256,
    );
    assert.throws(() => encodeCartographyBitset(3, 3, Uint32Array.of(1 << 20)));
  });

  it("seals the semantic payload independently of report metadata", () => {
    const first = report([0, 1]);
    const second = sealCartographyEvidence({
      ...first,
      reportId: randomUUID(),
      capturedAt: "2026-08-31T12:00:00.000Z",
    });
    assert.equal(first.contentSha256, second.contentSha256);
    assert.deepEqual(validateCartographyEvidence(first), []);
  });

  it("rejects undeclared identity, free-text, and altered derived state", () => {
    const valid = report([0]);
    assert.throws(() => parseCartographyEvidence({ ...valid, characterName: "Private" }));
    assert.throws(() => parseCartographyEvidence({
      ...valid,
      continent: { ...valid.continent, note: "arbitrary text" },
    }));
    assert.throws(() => parseCartographyEvidence({
      ...valid,
      contentSha256: HASH_A,
    }));
  });

  it("compares continent snapshots across client builds but rejects source drift", () => {
    const comparison = compareCartographyEvidence(
      report([0, 1], { client: HASH_A, current: false }),
      report([1, 2], { client: HASH_C, current: false }),
    );
    assert.equal(comparison.explored.union.setBits, 3);
    assert.equal(comparison.explored.intersection.setBits, 1);
    assert.equal(comparison.explored.xor.setBits, 2);
    assert.throws(() => compareCartographyEvidence(
      report([0], { toolbox: HASH_A, current: false }),
      report([0], { toolbox: HASH_B, current: false }),
    ));
  });

  it("requires exact current-instance revisions when both reports carry live data", () => {
    assert.throws(() => compareCartographyEvidence(
      report([0], { client: HASH_A }),
      report([0], { client: HASH_C }),
    ));
  });

  it("accepts over-limit diagnostics only with their exact closed failure reason", () => {
    const valid = report([0], { current: false });
    const limited = sealCartographyEvidence({
      ...valid,
      currentInstance: {
        status: "unavailable",
        reason: "plane-limit",
        mapId: 58,
        areaEpoch: 2,
        resourceGeneration: 3,
        kernel: {
          status: "limit",
          reason: "plane-limit",
          planeCount: 257,
          totalTrapezoids: 100,
          reachableTrapezoids: 0,
          groundCells: 0,
          doorwayCount: 0,
          terrainWidth: 0,
          terrainHeight: 0,
          planeLimit: 256,
          trapezoidLimit: 65_536,
          doorwayLimit: 256,
          terrainCellLimit: 262_144,
        },
      },
    });
    assert.deepEqual(validateCartographyEvidence(limited), []);
    assert.throws(() => sealCartographyEvidence({
      ...limited,
      currentInstance: {
        ...limited.currentInstance!,
        kernel: { ...limited.currentInstance!.kernel!, reason: "loading" },
      },
    }));
  });

  it("merges unique snapshots into union, intersection, XOR, and support counts", () => {
    const first = report([0, 1], { current: false });
    const merged = mergeCartographyEvidence([
      first,
      first,
      report([1, 2], { current: false }),
      report([1, 3], { current: false }),
    ]);
    assert.equal(merged.inputReports, 4);
    assert.equal(merged.uniqueExplorationSnapshots, 3);
    assert.equal(merged.duplicateSnapshots, 1);
    assert.equal(merged.union.setBits, 4);
    assert.equal(merged.intersection.setBits, 1);
    assert.equal(merged.xor.setBits, 4);
    const support = Buffer.from(merged.supportCounts.data, "base64");
    assert.deepEqual([0, 1, 2, 3].map((cell) => support.readUint16LE(cell * 2)), [1, 3, 1, 1]);
  });

  it("validates renderer captures before deriving remaining continent cells", () => {
    const parsed = parseCartographyEvidenceCapture(capture());
    const value = buildCartographyEvidenceReport(parsed, SESSION);
    assert.equal(value.continent.status, "ready");
    if (value.continent.status !== "ready") return;
    assert.deepEqual(
      [...decodeCartographyBitset(value.continent.remainingEstimate)],
      [...words(2, 3)],
    );
    assert.throws(() => parseCartographyEvidenceCapture({
      ...capture(),
      characterName: "must never cross the boundary",
    }));
  });

  it("renders a deterministic privacy-safe continent preview", () => {
    const value = buildCartographyEvidenceReport(capture(), SESSION);
    const first = renderCartographyEvidencePreview(value);
    const second = renderCartographyEvidencePreview(value);
    assert.ok(first);
    assert.deepEqual(first, second);
    const png = PNG.sync.read(Buffer.from(first));
    assert.equal(png.width, 8);
    assert.equal(png.height, 8);
    assert.deepEqual([...png.data.subarray(0, 4)], [64, 125, 92, 255]);
    assert.deepEqual([...png.data.subarray(2 * 4, 3 * 4)], [226, 174, 62, 255]);
  });

  it("reads ZIP evidence and writes comparison and merge PNGs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cartography-evidence-test-"));
    try {
      const document = path.join(root, "cartography-report.json");
      const otherDocument = path.join(root, "cartography-other.json");
      const archive = path.join(root, "evidence.zip");
      const output = path.join(root, "comparison.json");
      const comparisonPng = path.join(root, "comparison.png");
      const mergeOutput = path.join(root, "merge.json");
      const mergePng = path.join(root, "merge.png");
      const value = report([0, 1], { current: false });
      await writeFile(document, JSON.stringify(value), "utf8");
      await writeFile(otherDocument, JSON.stringify(report([1, 2], { current: false })), "utf8");
      await execFileAsync("/usr/bin/zip", ["-q", archive, "cartography-report.json"], {
        cwd: root,
      });
      assert.equal((await readCartographyEvidence(document)).contentSha256, value.contentSha256);
      assert.equal((await readCartographyEvidence(archive)).contentSha256, value.contentSha256);
      const hook = path.join(process.cwd(), "scripts/ts-hook.mjs");
      await execFileAsync(process.execPath, [
        "--import", hook,
        path.join(process.cwd(), "src/tools/cartography-evidence/compare.ts"),
        archive, otherDocument, "--out", output, "--png", comparisonPng,
      ]);
      await execFileAsync(process.execPath, [
        "--import", hook,
        path.join(process.cwd(), "src/tools/cartography-evidence/merge.ts"),
        archive, otherDocument, "--out", mergeOutput, "--png", mergePng,
      ]);
      await assert.doesNotReject(async () => JSON.parse(await readFile(output, "utf8")));
      await assert.doesNotReject(async () => JSON.parse(await readFile(mergeOutput, "utf8")));
      assert.deepEqual(PNG.sync.read(await readFile(comparisonPng)).width, 8);
      assert.deepEqual(PNG.sync.read(await readFile(mergePng)).height, 8);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
