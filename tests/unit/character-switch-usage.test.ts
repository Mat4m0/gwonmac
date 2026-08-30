import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CharacterSwitchUsageStore } from "../../src/main/core/character-switch-usage.js";
import {
  CHARACTER_SWITCH_COUNT_MAX,
  CHARACTER_SWITCH_USAGE_LIMIT,
  EMPTY_CHARACTER_SWITCH_USAGE,
  parseCharacterSwitchUsageDocument,
  parseCharacterSwitchUsageRecord,
  recordSuccessfulCharacterSwitch,
} from "../../src/shared/character-switch-usage.js";

const alpha = "0123456789abcdef";
const beta = "fedcba9876543210";

describe("Character Switch usage", () => {
  it("records only bounded opaque keys and persists across store instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-character-switch-usage-"));
    const path = join(dir, "usage.json");
    const store = new CharacterSwitchUsageStore(path);
    await store.record(alpha);
    await store.record(beta);
    await store.record(alpha);

    assert.deepEqual(await new CharacterSwitchUsageStore(path).get(), {
      formatVersion: 1,
      sequence: 3,
      entries: [
        { characterKey: alpha, successfulSwitches: 2, lastUsedSequence: 3 },
        { characterKey: beta, successfulSwitches: 1, lastUsedSequence: 2 },
      ],
    });
    const persisted = await readFile(path, "utf8");
    assert.equal(persisted.includes("Private Character"), false);
    assert.equal(persisted.includes("search"), false);
  });

  it("saturates counts and compacts a saturated sequence without changing recency", () => {
    const saturated = parseCharacterSwitchUsageDocument({
      formatVersion: 1,
      sequence: 0xffff_ffff,
      entries: [
        { characterKey: alpha, successfulSwitches: CHARACTER_SWITCH_COUNT_MAX, lastUsedSequence: 5 },
        { characterKey: beta, successfulSwitches: 2, lastUsedSequence: 9 },
      ],
    });
    assert.deepEqual(recordSuccessfulCharacterSwitch(saturated, alpha), {
      formatVersion: 1,
      sequence: 3,
      entries: [
        { characterKey: alpha, successfulSwitches: CHARACTER_SWITCH_COUNT_MAX, lastUsedSequence: 3 },
        { characterKey: beta, successfulSwitches: 2, lastUsedSequence: 2 },
      ],
    });
  });

  it("rejects names, zero keys, duplicates, and malformed statistics", () => {
    for (const value of [
      { characterKey: "Private Character" },
      { characterKey: "0000000000000000" },
      { characterKey: `${alpha}extra` },
    ]) assert.throws(() => parseCharacterSwitchUsageRecord(value));
    assert.throws(() => parseCharacterSwitchUsageDocument({
      formatVersion: 1,
      sequence: 1,
      entries: [
        { characterKey: alpha, successfulSwitches: 1, lastUsedSequence: 1 },
        { characterKey: alpha, successfulSwitches: 1, lastUsedSequence: 1 },
      ],
    }));
  });

  it("quarantines an unreadable convenience document", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-character-switch-usage-"));
    const path = join(dir, "usage.json");
    await writeFile(path, "Private Character");
    assert.deepEqual(await new CharacterSwitchUsageStore(path).get(), EMPTY_CHARACTER_SWITCH_USAGE);
    await assert.rejects(readFile(path, "utf8"), /ENOENT/u);
  });

  it("prunes the least-recently-used key after the bounded capacity", () => {
    let document = EMPTY_CHARACTER_SWITCH_USAGE;
    for (let index = 1; index <= CHARACTER_SWITCH_USAGE_LIMIT + 1; index += 1) {
      document = recordSuccessfulCharacterSwitch(
        document,
        index.toString(16).padStart(16, "0"),
      );
    }
    assert.equal(document.entries.length, CHARACTER_SWITCH_USAGE_LIMIT);
    assert.equal(document.entries.some(({ characterKey }) => characterKey === "0000000000000001"), false);
    assert.equal(document.entries[0]?.characterKey, "0000000000000101");
  });
});
