import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  backgroundSafeElectronSpecs,
  desktopExclusiveElectronSpecs,
} from "../electron/resource-lanes.js";

const electronTestDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../electron",
);

async function discoverSpecs(directory: string): Promise<string[]> {
  const discovered: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      discovered.push(...await discoverSpecs(entryPath));
    } else if (entry.name.endsWith(".spec.ts")) {
      discovered.push(
        path.relative(electronTestDirectory, entryPath).split(path.sep).join("/"),
      );
    }
  }
  return discovered;
}

describe("Electron resource lanes", () => {
  it("classifies every spec exactly once", async () => {
    const discovered = (await discoverSpecs(electronTestDirectory)).sort();
    const classified = [
      ...backgroundSafeElectronSpecs,
      ...desktopExclusiveElectronSpecs.map(({ file }) => file),
    ];

    assert.equal(
      new Set(classified).size,
      classified.length,
      "an Electron spec belongs to more than one resource lane",
    );
    assert.deepEqual(
      [...classified].sort(),
      discovered,
      "every Electron spec must have one explicit resource-lane owner",
    );
  });

  it("records why each desktop-exclusive spec must stay serial", () => {
    for (const spec of desktopExclusiveElectronSpecs) {
      assert.ok(spec.resources.length > 0, `${spec.file} names no desktop resource`);
      assert.ok(spec.reason.length > 0, `${spec.file} has no exclusivity reason`);
    }
  });
});
