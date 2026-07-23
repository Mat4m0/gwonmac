import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic, writeAtomicJson } from "../../src/main/core/atomic-file.js";

describe("atomic-file", () => {
  it("replaces the target only after a complete write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-atomic-"));
    const path = join(dir, "out.txt");
    await writeFile(path, "old");
    await writeAtomic(path, "new-contents");
    assert.equal(await readFile(path, "utf8"), "new-contents");
  });

  it("writes JSON atomically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-atomic-"));
    const path = join(dir, "meta.json");
    await writeAtomicJson(path, { a: 1, b: "x" });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { a: 1, b: "x" });
  });

  it("creates parent directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-atomic-"));
    const path = join(dir, "nested", "deep", "f.bin");
    await writeAtomic(path, new Uint8Array([1, 2, 3]));
    assert.deepEqual(Uint8Array.from(await readFile(path)), new Uint8Array([1, 2, 3]));
  });
});
