/**
 * Feature-local structural authority for observation state and Target Distance.
 * Every accepted layout field comes from independent readers or writers.
 */
import { createHash } from "node:crypto";
import { verifyLayout } from "./semantic-proof.js";
import { CLIENT_TICK_ROLE } from "./enhancement-client-hook-role.js";
import {
  bodyMatchesRole,
  codeOperandOccurrences,
  enhancementProofContext,
  functionBody,
  functionBodySha256,
  MAX_INPUT_BYTES,
  matchesEvidenceInput,
  mutableSpans,
  semanticRole,
  signatureMatches,
  soleValue,
  staticBytes,
  staticCStringHash,
  uniqueExactFunction,
  uniqueRoleFunction,
  roleFunctions,
  unsignedOperand,
  valuesForRole,
} from "./wasm-evidence.js";
import type { EnhancementProofContext } from "./wasm-evidence.js";
import { dataEvidence } from "./wasm-data-evidence.js";
import { tickEvidence } from "./enhancement-tick-evidence.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import type {
  EnhancementObservationBaseLayout,
  EnhancementPlayRegionLayout,
  EnhancementTargetLayout,
} from "../../shared/enhancement-config.js";
import type {
  AutomaticPlayRegionLocation,
  AutomaticTargetLocation,
  ModuleShape,
} from "./enhancement-evidence-types.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

const TARGET_CONTEXT_ROOT_ROLE = semanticRole(
  33,
  "3ec691dd53ed9441774e334e1cf646e9c5f62ca715c6069c2cc1080713852d36",
  mutableSpans([[11, 16, "context.root"]]),
  [],
  [],
);

const TARGET_SELECTOR_ROLE = semanticRole(
  726,
  "a6bc6ed7f164a3cccbb9cc851d32b281a466125053792e0a20389d6cf2b9dc1b",
  Object.freeze([
    { start: 38, end: 43, role: "target.assert-manual", addressClass: "immutable-data" },
    { start: 44, end: 49, role: "target.assert-file", addressClass: "immutable-data" },
    { start: 77, end: 82, role: "target.assert-automatic", addressClass: "immutable-data" },
    { start: 83, end: 88, role: "target.assert-file", addressClass: "immutable-data" },
    ...[214, 266, 528, 580].map((start) => ({
      start, end: start + 5, role: "target.message", addressClass: "immutable-data" as const,
    })),
    ...[220, 272, 534, 586].map((start) => ({
      start, end: start + 5, role: "target.assert-file", addressClass: "immutable-data" as const,
    })),
    ...mutableSpans([
      [111, 116, "target.related-0"],
      [132, 137, "target.manual"], [147, 152, "target.automatic"],
      [312, 317, "target.manual"], [332, 337, "target.automatic"],
      [381, 386, "target.related-1"], [451, 456, "target.related-1"],
      [501, 506, "target.related-2"],
      [636, 641, "target.manual"], [647, 652, "target.automatic"],
    ]),
  ]),
  ["i32", "i32"],
  [],
);

const TARGET_RESET_ROLE = semanticRole(
  136,
  "d3cae3aed2485fa4b3a309b096a5f6c3d542bb09c46e2d03c92790a05e53112f",
  Object.freeze([
    ...mutableSpans([
      [7, 12, "target.manual"], [18, 23, "target.automatic"],
      [29, 34, "target.related-0"], [40, 45, "target.related-3"],
      [51, 56, "target.related-4"], [62, 67, "target.related-5"],
      [73, 78, "target.related-6"], [84, 89, "target.related-7"],
      [107, 112, "target.related-8"], [130, 135, "target.related-9"],
    ]),
    { start: 92, end: 97, role: "target.reset-name-a", addressClass: "immutable-data" },
    { start: 115, end: 120, role: "target.reset-name-b", addressClass: "immutable-data" },
  ]),
  [],
  [],
);

const TARGET_CALLER_ROLE = semanticRole(
  214,
  "e3e9e34cfb66d34f16319b1b2bd78918df2589a7b6d0428991f6b85fce1d75e5",
  Object.freeze([
    ...mutableSpans([
      [9, 14, "target.automatic"], [23, 28, "target.manual"],
      [40, 45, "target.manual"], [60, 65, "target.manual"],
      [76, 81, "target.automatic"], [93, 98, "target.automatic"],
      [111, 116, "target.related-3"], [136, 141, "target.related-3"],
      [198, 203, "target.related-3"],
    ]),
    { start: 161, end: 166, role: "target.message", addressClass: "immutable-data" },
    { start: 167, end: 172, role: "target.assert-file", addressClass: "immutable-data" },
  ]),
  ["i32"],
  [],
);

const AGENT_ARRAY_LIFECYCLE_ROLE = semanticRole(
  51,
  "90bf935b288798d9383a84eefe73856cbe2048635aa7702bac56b1e0d5498436",
  mutableSpans([
    [9, 14, "agent-array.base"], [34, 39, "agent-array.base"],
    [45, 50, "agent-array.size"],
  ]),
  ["i32"],
  [],
);

const AGENT_ARRAY_ACCESSOR_ROLE = semanticRole(
  47,
  "e2d3a0903dd7eb7595e118466ce74d0e90f9f38c81068c8cd2fd1f8ab0570338",
  mutableSpans([
    [15, 20, "agent-array.size"], [27, 32, "agent-array.base"],
  ]),
  ["i32"],
  ["i32"],
);

const AREA_LOOKUP_SPANS = Object.freeze([
  { start: 12, end: 17, role: "area.assert-name", addressClass: "immutable-data" as const },
  { start: 18, end: 23, role: "area.source-file", addressClass: "immutable-data" as const },
  { start: 24, end: 26, role: "area.source-line", addressClass: "immutable-data" as const },
  { start: 40, end: 45, role: "area.table", addressClass: "immutable-data" as const },
]);

/** Reviewed semantic table generations. These are content certificates, not build hashes. */
const AREA_TABLE_CERTIFICATES = Object.freeze([
  Object.freeze({
    capacity: 888,
    sentinelRows: 585,
    lookupFingerprint: "60c62c20f1c8a33ac6af4a3850cbe2c78346f9058de11cedaafe313b00154d69",
    normalizedTableSha256: "97fc2684bd161b183f0833d3aef8246ea9074f0e08de0ca2bb37f1506f2b5a1c",
  }),
  Object.freeze({
    capacity: 897,
    sentinelRows: 594,
    lookupFingerprint: "d4b96fb929317c6da37fc8f9d3c2842fd8dec4ad0d50bd1d993ef28d12a452ae",
    normalizedTableSha256: "b0030b14d2f9ad706b048ec73468beb435f83c0555d42e0a04c967d2c4c8ad7c",
  }),
]);

const AREA_LOOKUP_ROLES = AREA_TABLE_CERTIFICATES.map((certificate) => semanticRole(
  47,
  certificate.lookupFingerprint,
  AREA_LOOKUP_SPANS,
  ["i32"],
  ["i32"],
));

const PLAY_REGION_SEMANTIC_ROLES = Object.freeze({
  mapState: semanticRole(
    318,
    "ab27a71f3fdf9ff46fa4f73b57be6b464048f70adc627f9c8d123a58d43909f0",
    Object.freeze([
      { start: 10, end: 15, role: "map-state.assert", addressClass: "immutable-data" },
      { start: 16, end: 21, role: "map-state.source-file", addressClass: "immutable-data" },
    ]),
    ["i32", "i32"],
    [],
  ),
  areaCount: semanticRole(
    137,
    "bcb52eb689d92cf731bedeec30cc3472e83b2cce588c347514f63429b5fd0323",
    Object.freeze([
      { start: 24, end: 29, role: "area-count.assert", addressClass: "immutable-data" },
      { start: 30, end: 35, role: "area-count.source-file", addressClass: "immutable-data" },
      { start: 121, end: 126, role: "area-count.source-file", addressClass: "immutable-data" },
    ]),
    ["i32", "i32", "i32"],
    ["i32"],
  ),
  areaFlags: semanticRole(
    23,
    "8305e1f87589f1f5e6fa8848bb910df49d7982a90f47f48626525a8517d62243",
    Object.freeze([
      { start: 14, end: 19, role: "area-flags.lookup", addressClass: "function-index" },
    ]),
    [],
    ["i32"],
  ),
});

type ExactTargetRole = Readonly<{
  bodySha256: string;
  params: readonly string[];
  results: readonly string[];
}>;

const EXACT_TARGET_ROLES = Object.freeze({
  gameCharacter: { bodySha256: "f234e09fc78c540418d7ee1e02bb339caf4e95b91dad5803dd87f1b1f229eede", params: ["i32"], results: ["i32"] },
  mapId: { bodySha256: "6698663ffed7669e3fa3922260e1e773179b41a5147fd961af44acc157839914", params: ["i32"], results: ["i32"] },
  mapState: { bodySha256: "35cea95a660e3e1964f2fab0342b60c9a96ebc563638feceb328231fb97b27cd", params: ["i32", "i32"], results: [] },
  currentMap: { bodySha256: "c6e2e54332d133eb208974890b255570fb2fcc9a802ea52957b4a64116f7e72c", params: [], results: ["i32"] },
  instanceType: { bodySha256: "b9898076fd712f74e586f60df2a7e551c68db82b3726025815f46b78f32b8413", params: ["i32"], results: ["i32"] },
  playerNumber: { bodySha256: "3656f5655d9704c608247be52aaf1654141bce2db8f085c6cef4c967c7068acf", params: [], results: ["i32"] },
  worldContext: { bodySha256: "35541e26cd5badf9bbf37b1e7a57489cb762e5ecffcb0f90e4069d4c63bd4c09", params: ["i32"], results: ["i32"] },
  agentFields: { bodySha256: "b9d3e9ffd560b43d918aa004088193c11e51da699d754682f651b02b5cdb8ab4", params: ["i32"], results: [] },
  agentModel: { bodySha256: "cf152611218510e0d086fb2808834d0381f64c237c9b4ee185eabcd58a850a6b", params: ["i32", "i32", "i32"], results: ["i32"] },
  areaCount: { bodySha256: "dc05263b317b11744dc07fdd0ee520bf3d9811e9869580c570ff81959ef2fd9b", params: ["i32", "i32", "i32"], results: ["i32"] },
  areaFlags: { bodySha256: "1cc6aeaa4c4f9228ee4984a26506f2f72d2b6ad4aeec4e50b1dd019504516382", params: [], results: ["i32"] },
} as const satisfies Readonly<Record<string, ExactTargetRole>>);

const TARGET_IMMUTABLE_HASHES = Object.freeze({
  manualAssertion: "d78c3ee557d2b4d2c335ea85a1c6e7088d894236e0225360d92942da98c54b7d",
  automaticAssertion: "ee8a8e207854674610e42099c03590270b556c9cd482de0bfca76959939d74c6",
  areaAssertion: "bbba85bc88debef8198061f3c1c86cf0c7051c7cb0752f8ca670bcace10d03fe",
  assertionFile: "0f8d017301e3b92b3d23377d064d8550cec12abd8ea16c1a0c5d588f0868a957",
  targetMessage: "a68e6c1f3f95630025c0436d3cd10923c341215659fd4f76ff3a54a8158ae618",
});

function uniqueCString(
  module: ModuleShape,
  address: number,
  expected: string,
): boolean {
  const data = dataEvidence(module);
  return data.readCString(address) === expected
    && data.addresses(new TextEncoder().encode(`${expected}\0`)).length === 1;
}

function exactTargetFunction(
  module: ModuleShape,
  role: ExactTargetRole,
): number | null {
  return uniqueExactFunction(module, role.bodySha256, role.params, role.results);
}

function playRegionFunction(
  module: ModuleShape,
  name: keyof typeof EXACT_TARGET_ROLES,
): number | null {
  if (name in PLAY_REGION_SEMANTIC_ROLES) {
    return uniqueRoleFunction(
      module,
      PLAY_REGION_SEMANTIC_ROLES[name as keyof typeof PLAY_REGION_SEMANTIC_ROLES],
    );
  }
  return exactTargetFunction(module, EXACT_TARGET_ROLES[name]);
}

function areaLookup(
  module: ModuleShape,
): { functionIndex: number; certificate: (typeof AREA_TABLE_CERTIFICATES)[number] } | null {
  const matches = AREA_LOOKUP_ROLES.flatMap((role, index) => {
    const functionIndex = uniqueRoleFunction(module, role);
    return functionIndex === null
      ? []
      : [{ functionIndex, certificate: AREA_TABLE_CERTIFICATES[index]! }];
  });
  return matches.length === 1 ? matches[0]! : null;
}

export function deriveAreaLookupFunction(module: ModuleShape): number | null {
  return areaLookup(module)?.functionIndex ?? null;
}

export type TargetRoleCandidateDiagnostic = Readonly<{
  status: "candidate" | "ambiguous" | "unavailable";
  candidateCount: number;
}>;

function targetRoleDiagnostic(counts: readonly number[]): TargetRoleCandidateDiagnostic {
  const ambiguousCount = Math.max(0, ...counts.filter((count) => count > 1));
  if (ambiguousCount > 1) {
    return Object.freeze({ status: "ambiguous", candidateCount: ambiguousCount });
  }
  if (counts.some((count) => count === 0)) {
    return Object.freeze({ status: "unavailable", candidateCount: 0 });
  }
  return Object.freeze({ status: "candidate", candidateCount: 1 });
}

/** Candidate cardinality used only to explain a fail-closed Target refusal. */
export function inspectTargetRoleCandidates(
  input: Uint8Array,
  suppliedContext?: EnhancementProofContext,
): TargetRoleCandidateDiagnostic | null {
  if (!WebAssembly.validate(input) || input.byteLength > MAX_INPUT_BYTES) return null;
  try {
    const context = matchesEvidenceInput(suppliedContext, input)
      ? suppliedContext
      : enhancementProofContext(input);
    if (!context) return null;
    const module = context.moduleView();
    const accessorMatches = roleFunctions(module, AGENT_ARRAY_ACCESSOR_ROLE);
    const lifecycleCount = accessorMatches.length === 1
      ? (() => {
          const accessor = valuesForRole(
            functionBody(module, accessorMatches[0]!),
            AGENT_ARRAY_ACCESSOR_ROLE,
          );
          const base = soleValue(accessor, "agent-array.base");
          const size = soleValue(accessor, "agent-array.size");
          return roleFunctions(module, AGENT_ARRAY_LIFECYCLE_ROLE).filter(
            (functionIndex) => {
              const values = valuesForRole(
                functionBody(module, functionIndex),
                AGENT_ARRAY_LIFECYCLE_ROLE,
              );
              return soleValue(values, "agent-array.base") === base
                && soleValue(values, "agent-array.size") === size;
            },
          ).length;
        })()
      : 0;
    return targetRoleDiagnostic([
      roleFunctions(module, TARGET_CONTEXT_ROOT_ROLE).length,
      lifecycleCount,
      accessorMatches.length,
      areaLookup(module) === null ? 0 : 1,
      roleFunctions(module, TARGET_SELECTOR_ROLE).length,
      roleFunctions(module, TARGET_RESET_ROLE).length,
      roleFunctions(module, TARGET_CALLER_ROLE).length,
      ...Object.entries(EXACT_TARGET_ROLES).map(([name, role]) => {
        if (name in PLAY_REGION_SEMANTIC_ROLES) {
          return roleFunctions(
            module,
            PLAY_REGION_SEMANTIC_ROLES[name as keyof typeof PLAY_REGION_SEMANTIC_ROLES],
          ).length;
        }
        const exact = exactTargetFunction(module, role);
        if (exact !== null) return 1;
        // A null unique lookup means either zero or multiple. Count explicitly
        // so duplicate exact bodies are reported as ambiguous, not changed.
        return module.functionTypeIndices.reduce((count, _, index) =>
          index >= module.functionImportCount
          && signatureMatches(module, index, role.params, role.results)
          && functionBodySha256(module, index) === role.bodySha256
            ? count + 1
            : count, 0);
      }),
    ]);
  } catch {
    return null;
  }
}

/** Exact, agent-independent authority for loading and PvE/PvP policy. */
export function derivePlayRegionLayout(
  module: ModuleShape,
): EnhancementPlayRegionLayout | null {
  const contextFunction = uniqueRoleFunction(module, TARGET_CONTEXT_ROOT_ROLE);
  const lookup = areaLookup(module);
  const roles = [
    "gameCharacter", "mapId", "mapState", "currentMap", "instanceType",
    "playerNumber", "areaCount", "areaFlags",
  ] as const satisfies readonly (keyof typeof EXACT_TARGET_ROLES)[];
  const exact = Object.fromEntries(roles.map(
    (name) => [name, playRegionFunction(module, name)],
  )) as Record<(typeof roles)[number], number | null>;
  if (
    contextFunction === null || lookup === null
    || Object.values(exact).some((value) => value === null)
  ) return null;
  const areaLookupFunction = lookup.functionIndex;
  const areaLookupRole = AREA_LOOKUP_ROLES[
    AREA_TABLE_CERTIFICATES.indexOf(lookup.certificate)
  ]!;

  const context = valuesForRole(functionBody(module, contextFunction), TARGET_CONTEXT_ROOT_ROLE);
  const area = valuesForRole(functionBody(module, areaLookupFunction), areaLookupRole);
  const contextRoot = soleValue(context, "context.root");
  const areaInfo = soleValue(area, "area.table");
  if (
    codeOperandOccurrences(module, contextRoot) !== 6
    || codeOperandOccurrences(module, areaInfo) !== 1
  ) return null;

  if (
    staticCStringHash(module, soleValue(area, "area.assert-name"))
      !== TARGET_IMMUTABLE_HASHES.areaAssertion
    || !uniqueCString(
      module,
      soleValue(area, "area.assert-name"),
      "index < arrsize(s_missionClientData)",
    )
  ) return null;

  const body = (name: (typeof roles)[number]) =>
    functionBody(module, exact[name]!);
  const contextBody = functionBody(module, contextFunction);
  const areaBody = functionBody(module, areaLookupFunction);
  const mapStateEvidence = valuesForRole(
    body("mapState"), PLAY_REGION_SEMANTIC_ROLES.mapState,
  );
  const areaCountEvidence = valuesForRole(
    body("areaCount"), PLAY_REGION_SEMANTIC_ROLES.areaCount,
  );
  if (
    !uniqueCString(
      module,
      soleValue(area, "area.source-file"),
      "../../../../Gw/Const/ConstMission.cpp",
    )
    || !uniqueCString(module, soleValue(mapStateEvidence, "map-state.assert"), "props")
    || !uniqueCString(
      module,
      soleValue(mapStateEvidence, "map-state.source-file"),
      "../../../../Engine/Map/Props/PrApi.cpp",
    )
    || !uniqueCString(module, soleValue(areaCountEvidence, "area-count.assert"), "iModel")
    || !uniqueCString(
      module,
      soleValue(areaCountEvidence, "area-count.source-file"),
      "../../../../Engine/Model/MdlSeq.cpp",
    )
    || unsignedOperand(areaBody, 6) !== lookup.certificate.capacity
    || unsignedOperand(body("areaFlags"), 14) !== areaLookupFunction
  ) return null;
  const observation: EnhancementPlayRegionLayout = {
    contextRoot,
    gameContextSlot: unsignedOperand(contextBody, 17),
    characterContext: unsignedOperand(body("gameCharacter"), 5),
    // Official CharContext::player_uuid is a fixed 16-byte field. Keeping the
    // raw UUID inside the kernel lets the renderer receive only a one-way key.
    characterUuid: 0x64,
    mapId: unsignedOperand(body("mapId"), 39),
    isExplorable: unsignedOperand(body("mapState"), 37),
    currentMapId: unsignedOperand(body("currentMap"), 11),
    currentInstanceType: unsignedOperand(body("instanceType"), 5),
    playerNumber: unsignedOperand(body("playerNumber"), 11),
    areaInfo,
    areaInfoCount: unsignedOperand(body("areaCount"), 36),
    areaInfoStride: unsignedOperand(areaBody, 36),
    areaInfoFlags: unsignedOperand(body("areaFlags"), 21),
  };
  if (lookup.certificate.capacity < observation.areaInfoCount) return null;
  const table = staticBytes(
    module,
    observation.areaInfo,
    lookup.certificate.capacity * observation.areaInfoStride,
  );
  if (!table) return null;
  const normalizedTable = table.slice();
  const tableView = new DataView(
    normalizedTable.buffer,
    normalizedTable.byteOffset,
    normalizedTable.byteLength,
  );
  let sentinelRows = 0;
  for (let row = 0; row < lookup.certificate.capacity; row += 1) {
    const offset = row * observation.areaInfoStride + 60;
    if (tableView.getUint32(offset, true) === lookup.certificate.capacity) {
      tableView.setUint32(offset, 0, true);
      sentinelRows += 1;
    }
  }
  if (
    sentinelRows !== lookup.certificate.sentinelRows
    || createHash("sha256").update(normalizedTable).digest("hex")
      !== lookup.certificate.normalizedTableSha256
  ) return null;

  return verifyLayout(observation, {
    contextRoot: { sourceRole: "context-root-writer", expression: "relocated static store", occurrences: [11] },
    gameContextSlot: { sourceRole: "context-root-writer", expression: "context registration slot", occurrences: [17] },
    characterContext: { sourceRole: "game-context character reader", expression: "i32.load offset", occurrences: [5] },
    characterUuid: { sourceRole: "official character-context layout", expression: "fixed 16-byte UUID field", occurrences: [0x64] },
    mapId: { sourceRole: "map-id reader", expression: "i32.load offset", occurrences: [39] },
    isExplorable: { sourceRole: "map-state reader", expression: "map availability field", occurrences: [37] },
    currentMapId: { sourceRole: "character-context map reader", expression: "i32.load offset", occurrences: [11] },
    currentInstanceType: { sourceRole: "character-context instance reader", expression: "i32.load offset", occurrences: [5] },
    playerNumber: { sourceRole: "character-context player reader", expression: "i32.load offset", occurrences: [11] },
    areaInfo: { sourceRole: "area lookup+static content", expression: "unique immutable table", occurrences: [40] },
    areaInfoCount: { sourceRole: "published-area bound", expression: "finite exact bound", occurrences: [36] },
    areaInfoStride: { sourceRole: "area lookup", expression: "index multiplier", occurrences: [36] },
    areaInfoFlags: { sourceRole: "area flags reader", expression: "post-lookup load", occurrences: [21] },
  }).layout;
}

export function deriveObservationLayout(
  module: ModuleShape,
): EnhancementObservationBaseLayout | null {
  const playRegion = derivePlayRegionLayout(module);
  const agentAccessorFunction = uniqueRoleFunction(module, AGENT_ARRAY_ACCESSOR_ROLE);
  const agentFieldsFunction = exactTargetFunction(module, EXACT_TARGET_ROLES.agentFields);
  const agentModelFunction = exactTargetFunction(module, EXACT_TARGET_ROLES.agentModel);
  const worldContextFunction = exactTargetFunction(module, EXACT_TARGET_ROLES.worldContext);
  if (
    !playRegion || agentAccessorFunction === null || agentFieldsFunction === null
    || agentModelFunction === null || worldContextFunction === null
  ) return null;
  const accessor = valuesForRole(
    functionBody(module, agentAccessorFunction),
    AGENT_ARRAY_ACCESSOR_ROLE,
  );
  const agentArray = soleValue(accessor, "agent-array.base");
  const agentArraySize = soleValue(accessor, "agent-array.size");
  const lifecycleMatches = roleFunctions(module, AGENT_ARRAY_LIFECYCLE_ROLE).filter(
    (functionIndex) => {
      const values = valuesForRole(
        functionBody(module, functionIndex), AGENT_ARRAY_LIFECYCLE_ROLE,
      );
      return soleValue(values, "agent-array.base") === agentArray
        && soleValue(values, "agent-array.size") === agentArraySize;
    },
  );
  if (
    lifecycleMatches.length !== 1 || agentArraySize !== agentArray + 8
    || codeOperandOccurrences(module, agentArray) !== 41
    || codeOperandOccurrences(module, agentArraySize) !== 41
  ) return null;
  const agentFields = functionBody(module, agentFieldsFunction);
  const agentModel = functionBody(module, agentModelFunction);
  const observation: EnhancementObservationBaseLayout = {
    ...playRegion,
    agentArray,
    agentId: unsignedOperand(agentFields, 899),
    agentX: unsignedOperand(agentFields, 395),
    agentY: unsignedOperand(agentFields, 367),
    agentType: unsignedOperand(agentFields, 99),
    agentPlayerNumber: unsignedOperand(agentFields, 927),
    agentModelType: unsignedOperand(agentModel, 393),
    worldContext: unsignedOperand(functionBody(module, worldContextFunction), 81),
  };
  if (unsignedOperand(agentModel, 365) !== observation.agentPlayerNumber) return null;
  return Object.freeze(observation);
}

/**
 * Strict launch authority for the bounded play-region observation.
 * Proves only the character/map and area-table facts policy consumes. Agent
 * tables and target selectors belong to the broader observation proof.
 */
export function locateAutomaticPlayRegion(
  input: Uint8Array,
  baselines: readonly KnownEnhancementBuild[],
  suppliedContext?: EnhancementProofContext,
): AutomaticPlayRegionLocation | null {
  if (!WebAssembly.validate(input) || input.byteLength > MAX_INPUT_BYTES) return null;
  try {
    const context = matchesEvidenceInput(suppliedContext, input)
      ? suppliedContext
      : enhancementProofContext(input);
    if (!context) return null;
    const module = context.moduleView();
    const tick = tickEvidence(module).candidate;
    if (!tick) return null;
    const tickBody = functionBody(module, tick.functionIndex);
    if (!bodyMatchesRole(tickBody, CLIENT_TICK_ROLE)) return null;
    const playRegionLayout = derivePlayRegionLayout(module);
    if (!playRegionLayout) return null;
    const matches = baselines.flatMap((baseline): AutomaticPlayRegionLocation[] =>
      baseline.playRegionObservation
      && signatureMatches(module, tick.functionIndex, baseline.hookParams, baseline.hookResults)
        ? [{
            baseline,
            hookFunction: tick.functionIndex,
            hookBodySha256: tick.bodySha256,
            playRegionLayout,
          }]
        : []);
    if (matches.length === 0) return null;
    const identity = (value: AutomaticPlayRegionLocation) => JSON.stringify({
      hookFunction: value.hookFunction,
      playRegionLayout: value.playRegionLayout,
    });
    return matches.every((match) => identity(match) === identity(matches[0]!))
      ? matches[0]!
      : null;
  } catch {
    return null;
  }
}

function deriveTargetLayout(
  module: ModuleShape,
): EnhancementTargetLayout | null {
  const selectorFunction = uniqueRoleFunction(module, TARGET_SELECTOR_ROLE);
  const resetFunction = uniqueRoleFunction(module, TARGET_RESET_ROLE);
  const callerFunction = uniqueRoleFunction(module, TARGET_CALLER_ROLE);
  if (
    selectorFunction === null || resetFunction === null || callerFunction === null
  ) return null;
  const selector = valuesForRole(functionBody(module, selectorFunction), TARGET_SELECTOR_ROLE);
  const reset = valuesForRole(functionBody(module, resetFunction), TARGET_RESET_ROLE);
  const caller = valuesForRole(functionBody(module, callerFunction), TARGET_CALLER_ROLE);
  const manualTargetAgentId = soleValue(selector, "target.manual");
  const automaticTargetAgentId = soleValue(selector, "target.automatic");
  if (
    manualTargetAgentId !== soleValue(reset, "target.manual")
    || manualTargetAgentId !== soleValue(caller, "target.manual")
    || automaticTargetAgentId !== soleValue(reset, "target.automatic")
    || automaticTargetAgentId !== soleValue(caller, "target.automatic")
    || manualTargetAgentId !== automaticTargetAgentId + 4
  ) return null;
  const selectorImmutable = valuesForRole(
    functionBody(module, selectorFunction), TARGET_SELECTOR_ROLE,
  );
  if (
    staticCStringHash(module, soleValue(selectorImmutable, "target.assert-manual"))
      !== TARGET_IMMUTABLE_HASHES.manualAssertion
    || staticCStringHash(module, soleValue(selectorImmutable, "target.assert-automatic"))
      !== TARGET_IMMUTABLE_HASHES.automaticAssertion
    || staticCStringHash(module, soleValue(selectorImmutable, "target.assert-file"))
      !== TARGET_IMMUTABLE_HASHES.assertionFile
    || staticCStringHash(module, soleValue(selectorImmutable, "target.message"))
      !== TARGET_IMMUTABLE_HASHES.targetMessage
    || soleValue(caller, "target.assert-file")
      !== soleValue(selectorImmutable, "target.assert-file")
    || soleValue(caller, "target.message")
      !== soleValue(selectorImmutable, "target.message")
  ) return null;
  const target = verifyLayout({ manualTargetAgentId, automaticTargetAgentId }, {
    manualTargetAgentId: { sourceRole: "target selector+reset+caller", expression: "manual target static", occurrences: [132, 312, 636, 7, 23, 40, 60] },
    automaticTargetAgentId: { sourceRole: "target selector+reset+caller", expression: "automatic target static", occurrences: [147, 332, 647, 18, 9, 76, 93] },
  }).layout;
  return target;
}

/**
 * Strict launch authority for read-only Target Distance on an unknown build.
 * Every pointer and structure offset is recovered from an independently
 * fingerprinted reader or writer. Relocated static data is accepted only when
 * its complete immutable content still matches.
 */
export function locateAutomaticTarget(
  input: Uint8Array,
  baselines: readonly KnownEnhancementBuild[],
  suppliedContext?: EnhancementProofContext,
): AutomaticTargetLocation | null {
  if (!WebAssembly.validate(input) || input.byteLength > MAX_INPUT_BYTES) return null;
  try {
    const context = matchesEvidenceInput(suppliedContext, input)
      ? suppliedContext
      : enhancementProofContext(input);
    if (!context) return null;
    const module = context.moduleView();
    const tick = tickEvidence(module).candidate;
    if (!tick) return null;
    const tickBody = functionBody(module, tick.functionIndex);
    if (!bodyMatchesRole(tickBody, CLIENT_TICK_ROLE)) return null;
    const observationLayout = deriveObservationLayout(module);
    if (!observationLayout) return null;
    const targetLayout = deriveTargetLayout(module);
    if (!targetLayout) return null;
    const matches = baselines.flatMap((baseline): AutomaticTargetLocation[] =>
      baseline.observationBase && baseline.targetObservation
      && signatureMatches(module, tick.functionIndex, baseline.hookParams, baseline.hookResults)
        ? [{
            baseline,
            hookFunction: tick.functionIndex,
            hookBodySha256: tick.bodySha256,
            observationLayout,
            targetLayout,
          }]
        : []);
    if (matches.length === 0) return null;
    const identity = (value: AutomaticTargetLocation) => JSON.stringify({
      hookFunction: value.hookFunction,
      observationLayout: value.observationLayout,
      targetLayout: value.targetLayout,
    });
    return matches.every((match) => identity(match) === identity(matches[0]!))
      ? matches[0]!
      : null;
  } catch {
    return null;
  }
}

/** Strict, independent authority for the three local action surfaces. */
