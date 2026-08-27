import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  codeOperandOccurrences,
  wasmEvidence,
} from "../src/main/certification/wasm-evidence.js";

const clientPath = path.join(
  homedir(),
  "Library",
  "Application Support",
  "Guild Wars",
  "game",
  "artifacts",
  "Gw.jspi.wasm",
);

const PATHING_ANCHORS = Object.freeze([
  "def->trapezoidCount < 1024",
  "index < pathMap.trapezoidCount",
  "m_trapezoid->portalLeft < pathMap.portalCount",
  "Failure: Infinite trapezoid bounds",
  "Next pathing trapezoid not found",
]);

function utf16Le(value: string) {
  const bytes = new Uint8Array(value.length * 2 + 2);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index * 2] = value.charCodeAt(index) & 0xff;
    bytes[index * 2 + 1] = value.charCodeAt(index) >>> 8;
  }
  return bytes;
}

const bytes = new Uint8Array(await readFile(clientPath));
const evidence = wasmEvidence(bytes);
if (!evidence) throw new Error("the cached client is not a supported bounded WASM input");

const compassAddresses = evidence.data.addresses(utf16Le("Compass"));
const pathingAddresses = PATHING_ANCHORS.flatMap((label) =>
  evidence.data.addresses(new TextEncoder().encode(`${label}\0`)).map((address) => ({
    label,
    address,
  }))
);
const trackedAddresses = [
  ...compassAddresses,
  ...pathingAddresses.map(({ address }) => address),
];
const references = new Map<number, number[]>();
for (const decoded of evidence.decodeFunctions(trackedAddresses)) {
  for (const site of decoded.constantSites) {
    if (!trackedAddresses.includes(site.value)) continue;
    const functions = references.get(site.value) ?? [];
    if (!functions.includes(decoded.functionIndex)) functions.push(decoded.functionIndex);
    references.set(site.value, functions);
  }
}
const project = (address: number) => ({
  address,
  codeReferences: codeOperandOccurrences(evidence.moduleView(), address),
  functions: Object.freeze(references.get(address) ?? []),
});

console.log(JSON.stringify({
  clientSha256: evidence.inputSha256,
  compass: {
    label: "Compass",
    encoding: "utf16-le",
    occurrences: compassAddresses.map(project),
  },
  pathing: PATHING_ANCHORS.map((label) => ({
    label,
    occurrences: pathingAddresses
      .filter((candidate) => candidate.label === label)
      .map(({ address }) => project(address)),
  })),
}, null, 2));
