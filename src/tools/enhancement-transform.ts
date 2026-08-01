/**
 * `pnpm enhancements:transform`: runs the Enhancement transform over one client
 * module on the command line, for inspecting the derived bytes outside a
 * launch.
 *
 * It emits one fixed profile. The other certified profiles are selected through
 * the application path that owns their cache identity, and reproducing that
 * selection here would be a second place where a capability set decides which
 * output is correct.
 *
 * The transform, the build lookup and the expected output hash all come from
 * the application's own modules, so this command cannot produce bytes a launch
 * would not.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "../main/core/atomic-file.js";
import {
  enhancementOutputSha256,
  findEnhancementBuild,
} from "../main/core/enhancement-builds.js";
import { transformEnhancementWasm } from "../main/core/enhancement-transform.js";
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  ENHANCEMENT_TRANSFORM_ABI,
} from "../shared/contracts.js";

const FOUNDATION_CAPABILITIES = ENHANCEMENT_CAPABILITY_PROFILES.cursorToolbox;

const [inputPath, outputPath] = process.argv.slice(2).filter((arg) => arg !== "--");
if (!inputPath || !outputPath) {
  throw new Error(
    "usage: node build/tools/enhancement-transform.js INPUT.wasm OUTPUT.wasm",
  );
}

const input = await readFile(inputPath);
const sha256 = createHash("sha256").update(input).digest("hex");
const build = findEnhancementBuild(sha256);
if (!build) {
  throw new Error(`unsupported official WASM hash ${sha256}`);
}
const output = transformEnhancementWasm(input, build, FOUNDATION_CAPABILITIES);
const outputSha256 = createHash("sha256").update(output).digest("hex");
if (
  outputSha256
  !== enhancementOutputSha256(build, FOUNDATION_CAPABILITIES)
) {
  throw new Error(`uncertified foundation output ${outputSha256}`);
}
await writeAtomic(path.resolve(outputPath), output);
console.log(
  JSON.stringify({
    buildId: build.buildId,
    inputSha256: sha256,
    transformAbi: ENHANCEMENT_TRANSFORM_ABI,
    inputBytes: input.byteLength,
    outputBytes: output.byteLength,
    outputSha256,
    output: path.resolve(outputPath),
  }),
);
