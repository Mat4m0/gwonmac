/**
 * Compares two compatible Cartography reports and writes deterministic JSON
 * and optional human-readable PNG evidence.
 */
import { resolve } from "node:path";
import { renderCartographyBitsetPreview } from "../../main/cartography-evidence/capture.js";
import {
  readCartographyEvidence,
  writeCartographyJson,
  writeCartographyPng,
} from "./io.js";
import { compareCartographyEvidence } from "../../main/cartography-evidence/report.js";

const args = process.argv.slice(2);
const positionals: string[] = [];
let outputPath: string | undefined;
let pngPath: string | undefined;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]!;
  if (arg === "--out" || arg === "--png") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      console.error(`missing value for ${arg}`);
      process.exitCode = 2;
      break;
    }
    if (arg === "--out") outputPath = value;
    else pngPath = value;
    index += 1;
  } else positionals.push(arg);
}
const [leftPath, rightPath] = positionals;
if (process.exitCode !== 2 && (!leftPath || !rightPath || positionals.length !== 2)) {
  console.error("usage: pnpm cartography:compare <left.zip|json> <right.zip|json> [--out result.json] [--png result.png]");
  process.exitCode = 2;
} else if (process.exitCode !== 2 && leftPath && rightPath) {
  try {
    const result = compareCartographyEvidence(
      await readCartographyEvidence(resolve(leftPath)),
      await readCartographyEvidence(resolve(rightPath)),
    );
    if (outputPath) await writeCartographyJson(resolve(outputPath), result);
    if (pngPath) {
      await writeCartographyPng(resolve(pngPath), renderCartographyBitsetPreview([
        { cells: result.explored.intersection, color: [64, 125, 92, 255] },
        { cells: result.explored.onlyLeft, color: [255, 116, 38, 255] },
        { cells: result.explored.onlyRight, color: [61, 167, 214, 255] },
      ]));
    }
    if (!outputPath) console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : "comparison failed"}`);
    process.exitCode = 1;
  }
}
