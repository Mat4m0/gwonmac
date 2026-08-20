import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATION = "src/main/core/retired-extended-memory.ts";
const LEGACY_DECODERS = new Set([
  "src/main/diagnostics/schema-app-update.ts",
  "src/tools/diagnostics/summarize.ts",
]);

function productionFiles(): string[] {
  return execFileSync("git", [
    "ls-files",
    "src",
    "scripts",
    "package.json",
  ], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean);
}

describe("withdrawn memory-profile policy", () => {
  it("contains no executable high-memory path or public opt-in", async () => {
    const violations: string[] = [];
    for (const file of productionFiles()) {
      let text: string;
      try {
        text = await readFile(path.join(ROOT, file), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (
        /gwonmacHeapCapBytes|4_?294_?901_?760|memory:qualify:4gb|(?:prepare|rewrite)ExtendedMemory/.test(text)
      ) {
        violations.push(`${file}: retired executable marker`);
      }
      if (text.includes("extendedMemoryEnabled") && file !== MIGRATION) {
        violations.push(`${file}: retired settings key`);
      }
      if (
        /wasm\.extendedMemory(?:PrepareFailed|Mode)?/.test(text)
        && !LEGACY_DECODERS.has(file)
      ) {
        violations.push(`${file}: retired diagnostic emission`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("tells affected players why their unsafe opt-in was removed", async () => {
    const main = await readFile(path.join(ROOT, "src/main/main.ts"), "utf8");
    assert.match(main, /message: "Experimental 4 GB memory limit removed"/);
    assert.match(
      main,
      /GWonMac has restored the standard 2 GB limit\. The memory warning and Reload Guild Wars recovery remain available\./,
    );
  });
});
