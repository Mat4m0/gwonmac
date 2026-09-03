/** Offline friend-table evidence only; this command never loads the game. */
import { readFile } from "node:fs/promises";
import { inspectFriendTable } from "../src/main/certification/friend-table-evidence.js";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0]!.startsWith("--")) {
  process.stderr.write("usage: node --import ./scripts/ts-hook.mjs scripts/friend-table-evidence.ts INPUT.wasm\n");
  process.exitCode = 2;
} else {
  try {
    const result = inspectFriendTable(new Uint8Array(await readFile(args[0]!)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "candidate" ? 0 : 1;
  } catch {
    process.stderr.write("Could not read the client artifact.\n");
    process.exitCode = 2;
  }
}
