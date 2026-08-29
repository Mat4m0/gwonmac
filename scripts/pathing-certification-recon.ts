/**
 * Prints the bounded pathing-shape verdict for the cached official client.
 * It emits function identities and fixed offsets, never game-memory pointers.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { certifyPathingShape } from "../src/main/certification/pathing-spike-proof.js";

const clientPath = path.join(
  homedir(),
  "Library",
  "Application Support",
  "Guild Wars",
  "game",
  "artifacts",
  "Gw.jspi.wasm",
);
const proof = certifyPathingShape(new Uint8Array(await readFile(clientPath)));
if (!proof) throw new Error("the exact official client did not certify its pathing shape");
console.log(JSON.stringify(proof, null, 2));
