import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const assetPath = path.join(
  root,
  "src/renderer/images/playstation-controller-prompts.png",
);
const evidencePath = path.join(root, "internal/upstream/controller-prompt-atlas.md");

test("the PlayStation prompt atlas is the reviewed 256×512 CC0 composition", async () => {
  const bytes = await readFile(assetPath);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(bytes.readUInt32BE(16), 256);
  assert.equal(bytes.readUInt32BE(20), 512);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "d3dcb98fa3bbc9541f6456a36611ebad44e557ef1099aad328393b4eca25f294",
  );

  const notices = await readFile(path.join(root, "THIRD-PARTY-NOTICES.md"), "utf8");
  assert.match(notices, /Kenney Input Prompts/u);
  assert.match(notices, /Creative Commons Zero 1\.0 Universal/u);

  const evidence = await readFile(evidencePath, "utf8");
  assert.match(evidence, /b8cc509714b82b69fdfd79a26ba257aa4c9ef23d90bca9dfcbbd044e371cfb17/u);
  assert.match(evidence, /3cd87bf15df6812073b558e9f365c8fb8e2a54b1b4c37028e5d3a6cbaf5e6f9e/u);
  assert.match(evidence, /0x74eb6846/u);
  assert.match(evidence, /d3dcb98fa3bbc9541f6456a36611ebad44e557ef1099aad328393b4eca25f294/u);
  assert.match(evidence, /Matching candidates in the bounded diagnostic capture.*\| 1 \|/u);
});

test("the controller prompt lifecycle resets on WebGL context replacement", async () => {
  const [harness, textureModule] = await Promise.all([
    readFile(path.join(root, "src/renderer/harness.ts"), "utf8"),
    readFile(path.join(root, "src/renderer/controller-prompt-texture.ts"), "utf8"),
  ]);
  assert.match(harness, /controllerPrompts\?\.dispose\(\)/u);
  assert.match(textureModule, /addEventListener\("gw:graphics-context-reset", reset\)/u);
  assert.match(textureModule, /removeEventListener\("gw:graphics-context-reset", reset\)/u);
});
