/** Proves that remembered map coverage is bounded, merged, and disposable. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CartographyMapKnowledgeStore } from
  "../../src/main/core/cartography-map-knowledge.js";
import { parseCartographyMapKnowledge } from
  "../../src/shared/cartography-map-knowledge.js";

const FIRST_CLIENT = "a".repeat(64);
const NEXT_CLIENT = "b".repeat(64);
const FIRST_KERNEL = "c".repeat(64);
const NEXT_KERNEL = "d".repeat(64);

const knowledge = (words: readonly number[], revealRadius: 1 | 3 = 1) => ({
  kernelSha256: FIRST_KERNEL,
  mapId: 55,
  continent: 0,
  width: 8,
  height: 4,
  revealRadius,
  words,
});

describe("Cartography map knowledge", () => {
  it("unions repeated visits and keeps reveal modes independent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-cartography-knowledge-"));
    const path = join(dir, "cartography-map-knowledge.json");
    const store = new CartographyMapKnowledgeStore(path);

    await store.record(FIRST_CLIENT, parseCartographyMapKnowledge(knowledge([0b0011])));
    await store.record(FIRST_CLIENT, parseCartographyMapKnowledge(knowledge([0b1100])));
    await store.record(FIRST_CLIENT, parseCartographyMapKnowledge(knowledge([0b10000], 3)));

    assert.deepEqual(await new CartographyMapKnowledgeStore(path).get(
      FIRST_CLIENT,
      FIRST_KERNEL,
    ), [
      knowledge([0b1111]),
      knowledge([0b10000], 3),
    ]);
    const persisted = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(persisted.clientFingerprint, FIRST_CLIENT);
    assert.equal(persisted.kernelSha256, FIRST_KERNEL);
    assert.equal(JSON.stringify(persisted).includes("wordsBase64"), true);
    assert.equal(JSON.stringify(persisted).includes('"words"'), false);
  });

  it("starts empty after the installed Guild Wars content changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-cartography-knowledge-"));
    const path = join(dir, "cartography-map-knowledge.json");
    const store = new CartographyMapKnowledgeStore(path);
    await store.record(FIRST_CLIENT, parseCartographyMapKnowledge(knowledge([3])));

    assert.deepEqual(await store.get(NEXT_CLIENT, FIRST_KERNEL), []);
    assert.deepEqual(
      await store.record(NEXT_CLIENT, parseCartographyMapKnowledge(knowledge([4]))),
      [knowledge([4])],
    );
  });

  it("starts empty after the reachability kernel changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-cartography-knowledge-"));
    const path = join(dir, "cartography-map-knowledge.json");
    const store = new CartographyMapKnowledgeStore(path);
    await store.record(FIRST_CLIENT, parseCartographyMapKnowledge(knowledge([3])));

    assert.deepEqual(await store.get(FIRST_CLIENT, NEXT_KERNEL), []);
    const next = parseCartographyMapKnowledge({
      ...knowledge([4]),
      kernelSha256: NEXT_KERNEL,
    });
    assert.deepEqual(await store.record(FIRST_CLIENT, next), [next]);
  });

  it("quarantines corrupt convenience data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-cartography-knowledge-"));
    const path = join(dir, "cartography-map-knowledge.json");
    await writeFile(path, "not json");

    assert.deepEqual(
      await new CartographyMapKnowledgeStore(path).get(FIRST_CLIENT, FIRST_KERNEL),
      [],
    );
    await assert.rejects(readFile(path, "utf8"), /ENOENT/u);
  });

  it("refuses nonzero padding and oversized records", () => {
    assert.throws(() => parseCartographyMapKnowledge({
      ...knowledge([0xffff_ffff]),
      width: 3,
      height: 3,
    }), /padding/u);
    assert.throws(() => parseCartographyMapKnowledge({
      ...knowledge([]),
      width: 8_192,
      height: 8_192,
    }), /too large/u);
  });
});
