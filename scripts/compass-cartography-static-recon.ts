import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  codeOperandOccurrences,
  functionBody,
  functionBodySha256,
  signatureEvidence,
  wasmEvidence,
} from "../src/main/certification/wasm-evidence.js";
import { ENHANCEMENT_BUILDS } from
  "../src/main/certification/enhancement-builds.js";
import { deriveCompassFrameSpikeProof } from
  "../src/main/certification/compass-frame-spike-proof.js";

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

const MISSION_MAP_ANCHORS = Object.freeze([
  "../../../../Gw/Ui/Game/Map/GmMapWindow.cpp",
  "MapWindow",
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
const retained = ENHANCEMENT_BUILDS[0];
const compassProof = retained?.preGameControls && retained.skillSlotGeometry
  ? deriveCompassFrameSpikeProof(
      evidence,
      retained.preGameControls,
      retained.skillSlotGeometry,
    )
  : null;

const compassAddresses = evidence.data.addresses(utf16Le("Compass"));
const pathingAddresses = PATHING_ANCHORS.flatMap((label) =>
  evidence.data.addresses(new TextEncoder().encode(`${label}\0`)).map((address) => ({
    label,
    address,
  }))
);
const missionMapAddresses = MISSION_MAP_ANCHORS.flatMap((label) => {
  const bytes = label === "MapWindow"
    ? utf16Le(label)
    : new TextEncoder().encode(`${label}\0`);
  return evidence.data.addresses(bytes).map((address) => ({ label, address }));
});
const trackedAddresses = [
  ...compassAddresses,
  ...pathingAddresses.map(({ address }) => address),
  ...missionMapAddresses.map(({ address }) => address),
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
const decodedFunctions = evidence.decodeFunctions(trackedAddresses);
const callers = new Map<number, number[]>();
for (const decoded of decodedFunctions) {
  for (const target of decoded.calls.keys()) {
    const values = callers.get(target) ?? [];
    values.push(decoded.functionIndex);
    callers.set(target, values);
  }
}
const functionEvidence = (functionIndex: number) => {
  const decoded = decodedFunctions.find((value) => value.functionIndex === functionIndex);
  return {
    functionIndex,
    signature: signatureEvidence(evidence.moduleView(), functionIndex),
    bodyBytes: functionBody(evidence.moduleView(), functionIndex).byteLength,
    bodySha256: functionBodySha256(evidence.moduleView(), functionIndex),
    tableSlots: Object.freeze(evidence.tableRelations.get(functionIndex) ?? []),
    callers: Object.freeze(callers.get(functionIndex) ?? []),
    callees: Object.freeze(decoded === undefined ? [] : [...decoded.calls.entries()]),
    memoryOffsets: Object.freeze(decoded === undefined
      ? []
      : [...new Set(decoded.memorySites.map(({ value }) => value))].sort((a, b) => a - b)),
  };
};

console.log(JSON.stringify({
  clientSha256: evidence.inputSha256,
  compass: {
    label: "Compass",
    encoding: "utf16-le",
    occurrences: compassAddresses.map(project),
    namedFrameProof: compassProof === null
      ? { status: "refused" }
      : {
          status: "proved",
          ownerFunction: compassProof.ownerFunction,
          closedRuntimePublication: [
            "frameId", "visible", "viewportWidth", "viewportHeight",
            "left", "bottom", "right", "top", "mapGeneration",
          ],
        },
  },
  pathing: PATHING_ANCHORS.map((label) => ({
    label,
    occurrences: pathingAddresses
      .filter((candidate) => candidate.label === label)
      .map(({ address }) => project(address)),
  })),
  missionMap: MISSION_MAP_ANCHORS.map((label) => ({
    label,
    occurrences: missionMapAddresses
      .filter((candidate) => candidate.label === label)
      .map(({ address }) => {
        const occurrence = project(address);
        return {
          ...occurrence,
          functionEvidence: occurrence.functions.map(functionEvidence),
        };
      }),
  })),
  missionMapNeighborhood: Array.from(
    { length: 71 },
    (_, offset) => functionEvidence(16_070 + offset),
  ),
}, null, 2));
