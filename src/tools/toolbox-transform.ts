import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "../main/core/atomic-file.js";
import { findToolboxBuild } from "../main/core/toolbox-builds.js";
import {
  TOOLBOX_TRANSFORM_ABI,
  transformToolboxWasm,
} from "../main/core/toolbox-transform.js";

const [inputPath, outputPath] = process.argv.slice(2).filter((arg) => arg !== "--");
if (!inputPath || !outputPath) {
  throw new Error(
    "usage: node build/tools/toolbox-transform.js INPUT.wasm OUTPUT.wasm",
  );
}

const input = await readFile(inputPath);
const sha256 = createHash("sha256").update(input).digest("hex");
const build = findToolboxBuild(sha256);
if (!build) {
  throw new Error(`unsupported official WASM hash ${sha256}`);
}
const output = transformToolboxWasm(input, build);
await writeAtomic(path.resolve(outputPath), output);
console.log(
  JSON.stringify({
    buildId: build.buildId,
    inputSha256: sha256,
    transformAbi: TOOLBOX_TRANSFORM_ABI,
    inputBytes: input.byteLength,
    outputBytes: output.byteLength,
    output: path.resolve(outputPath),
  }),
);
