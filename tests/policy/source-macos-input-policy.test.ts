import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const productionInputSurface = [
  "src/shared/contracts.ts",
  "src/main/core/settings.ts",
  "src/renderer/gw-native.d.ts",
  "src/renderer/harness.ts",
  "src/renderer/index.html",
  "src/renderer/input.ts",
  "src/renderer/settings.ts",
] as const;

describe("the macOS input policy", () => {
  it("has no selectable or persisted touch mode", async () => {
    const sources = await Promise.all(
      productionInputSurface.map((path) => readFile(path, "utf8")),
    );
    for (const [index, source] of sources.entries()) {
      assert.doesNotMatch(
        source,
        /touchMode|Mobile touch compatibility|Mouse and touch together|Translate mouse to touch/,
        productionInputSurface[index],
      );
    }
  });
});
