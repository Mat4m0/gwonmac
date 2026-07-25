import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectToolboxCandidate } from "../main/core/toolbox-transform.js";

async function main(): Promise<void> {
  const filename = process.argv[2];
  if (!filename) {
    process.stderr.write("usage: toolbox:recertify path/to/Gw.jspi.wasm\n");
    process.exitCode = 2;
    return;
  }
  const report = inspectToolboxCandidate(await readFile(filename));
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (
  process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
