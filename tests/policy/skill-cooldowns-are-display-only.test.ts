import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSources = [
  "src/renderer/skill-cooldown-view.ts",
  "src/renderer/skill-cooldown-overlay.ts",
  "src/renderer/skill-cooldown-overlay-consumer.ts",
  "src/renderer/skill-cooldown-observation-installation.ts",
  "src/renderer/settings-skill-cooldowns.ts",
] as const;

test("cooldown presentation has no gameplay input or command dependency", async () => {
  const source = (await Promise.all(rendererSources.map((path) => readFile(path, "utf8"))))
    .join("\n");
  assert.doesNotMatch(source, /(?:\.\/|\.\.\/)input(?:\.js)?["']/u);
  assert.doesNotMatch(source, /commandEnqueue|sendInput|postMessage|dispatchKey|useSkill/u);
  assert.doesNotMatch(source, /gwNative\.(?:input|skillKeys)/u);
});
