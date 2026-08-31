/** Proves that renderer aggregation keeps persisted map records immutable. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  cartographyKnowledgeWordsFingerprint,
  mergeCartographyMapKnowledge,
} from "../../src/renderer/cartography-spike/map-knowledge.js";

test("unions only matching continent knowledge for the selected reveal mode", () => {
  const records = [
    { kernelSha256: "a".repeat(64), mapId: 55, continent: 0, width: 8, height: 4, revealRadius: 1 as const, words: [3] },
    { kernelSha256: "a".repeat(64), mapId: 81, continent: 0, width: 8, height: 4, revealRadius: 1 as const, words: [12] },
    { kernelSha256: "a".repeat(64), mapId: 82, continent: 0, width: 8, height: 4, revealRadius: 3 as const, words: [16] },
    { kernelSha256: "a".repeat(64), mapId: 449, continent: 1, width: 8, height: 4, revealRadius: 1 as const, words: [32] },
  ];
  const merged = mergeCartographyMapKnowledge(records, {
    kernelSha256: "a".repeat(64),
    continent: 0,
    width: 8,
    height: 4,
    revealRadius: 1,
  });
  assert.deepEqual(merged, new Uint32Array([15]));
  assert.deepEqual(records[0]!.words, [3]);
});

test("fingerprints identical masks consistently", () => {
  const first = new Uint32Array([1, 2, 3]);
  assert.equal(
    cartographyKnowledgeWordsFingerprint(first),
    cartographyKnowledgeWordsFingerprint(first.slice()),
  );
  assert.notEqual(
    cartographyKnowledgeWordsFingerprint(first),
    cartographyKnowledgeWordsFingerprint(new Uint32Array([1, 2, 4])),
  );
});
