import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  planSnapshotRetention,
  type SnapshotRelease,
} from "../../scripts/snapshot-retention.ts";

const NOW = Date.parse("2026-07-27T12:00:00Z");
const day = 24 * 60 * 60 * 1_000;

function release(
  sequence: number,
  ageDays: number,
  overrides: Partial<SnapshotRelease> = {},
): SnapshotRelease {
  return {
    id: sequence,
    tagName: `snapshot-${sequence}-abcdef${sequence}`,
    publishedAt: new Date(NOW - ageDays * day).toISOString(),
    draft: false,
    prerelease: true,
    ...overrides,
  };
}

describe("snapshot retention", () => {
  test("accepts an empty release history", () => {
    assert.deepEqual(planSnapshotRetention([], NOW), { keep: [], remove: [] });
  });

  test("always keeps the newest snapshot, even after a quiet month", () => {
    const newest = release(1, 30);
    assert.deepEqual(planSnapshotRetention([newest], NOW), {
      keep: [newest],
      remove: [],
    });
  });

  test("keeps three recent snapshots regardless of API ordering", () => {
    const releases = [release(2, 2), release(1, 3), release(3, 1)];
    assert.deepEqual(
      planSnapshotRetention(releases, NOW).keep.map(({ id }) => id),
      [3, 2, 1],
    );
  });

  test("removes every snapshot beyond the newest three", () => {
    const plan = planSnapshotRetention(
      [release(1, 4), release(4, 1), release(2, 3), release(3, 2)],
      NOW,
    );
    assert.deepEqual(plan.keep.map(({ id }) => id), [4, 3, 2]);
    assert.deepEqual(
      plan.remove.map(({ release: item, reason }) => [item.id, reason]),
      [[1, "overflow"]],
    );
  });

  test("expires the second and third snapshots after fourteen days", () => {
    const plan = planSnapshotRetention(
      [release(3, 15), release(1, 21), release(2, 18)],
      NOW,
    );
    assert.deepEqual(plan.keep.map(({ id }) => id), [3]);
    assert.deepEqual(
      plan.remove.map(({ release: item, reason }) => [item.id, reason]),
      [
        [2, "expired"],
        [1, "expired"],
      ],
    );
  });

  test("has no authority over versioned or malformed releases", () => {
    const realRelease = release(1, 100, {
      tagName: "v2026.7.0-beta.1",
    });
    const malformed = release(2, 100, {
      tagName: "snapshot-latest",
    });
    const draft = release(3, 100, { draft: true });
    const ordinaryPrerelease = release(4, 100, {
      tagName: "preview-4-abcdef4",
    });
    assert.deepEqual(
      planSnapshotRetention(
        [realRelease, malformed, draft, ordinaryPrerelease],
        NOW,
      ),
      { keep: [], remove: [] },
    );
  });
});
