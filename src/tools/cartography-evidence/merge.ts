/**
 * Merges compatible Cartography reports into reviewed candidate evidence and
 * writes deterministic JSON and optional human-readable PNG output.
 */
import { resolve } from "node:path";
import { renderCartographyBitsetPreview } from "./capture.js";
import {
  readCartographyEvidence,
  writeCartographyJson,
  writeCartographyPng,
} from "./io.js";
import { mergeCartographyEvidence } from "./report.js";

const args = process.argv.slice(2);
const inputs: string[] = [];
let output: string | undefined;
let png: string | undefined;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]!;
  if (arg === "--out" || arg === "--png") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      console.error(`missing value for ${arg}`);
      process.exitCode = 2;
      break;
    }
    if (arg === "--out") output = value;
    else png = value;
    index += 1;
  } else inputs.push(arg);
}
if (process.exitCode !== 2 && inputs.length === 0) {
  console.error("usage: pnpm cartography:merge <report.zip|json> [...] [--out result.json] [--png result.png]");
  process.exitCode = 2;
} else if (process.exitCode !== 2) {
  try {
    const result = mergeCartographyEvidence(
      await Promise.all(inputs.map((input) => readCartographyEvidence(resolve(input)))),
    );
    if (output) await writeCartographyJson(resolve(output), result);
    if (png) {
      await writeCartographyPng(resolve(png), renderCartographyBitsetPreview([
        { cells: result.union, color: [61, 167, 214, 255] },
        { cells: result.intersection, color: [64, 125, 92, 255] },
        { cells: result.disagreement, color: [226, 174, 62, 255] },
        { cells: result.observedOutsideCreditable, color: [218, 90, 153, 255] },
      ]));
    }
    if (!output) console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : "merge failed"}`);
    process.exitCode = 1;
  }
}
