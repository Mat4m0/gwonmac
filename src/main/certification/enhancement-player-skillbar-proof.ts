/**
 * Exact, UI-independent authority for the player skillbar row and eight slots.
 * Party presentation and cooldown timing consume this shared proof as peers.
 */
import { verifyLayout } from "./semantic-proof.js";
import {
  functionBody,
  functionBodySha256,
  roleFunctions,
  semanticRole,
  signatureMatches,
  soleValue,
  staticBytesHash,
  staticCStringHash,
  uniqueExactFunction,
  uniqueRoleFunction,
  unsignedOperand,
  valuesForRole,
} from "./enhancement-wasm-proof-context.js";
import type { ModuleShape } from "./enhancement-evidence-types.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";

export const PLAYER_SKILLBAR_WORLD_ROLE = semanticRole(
  3_279,
  "878f00dc4ea68f51e5a79f507e37b0a5df3c32b561ca6d35c966a888d0cd022b",
  Object.freeze([
    { start: 1_342, end: 1_347, role: "world.assert-a", addressClass: "immutable-data" },
    { start: 1_395, end: 1_400, role: "world.assert-b", addressClass: "immutable-data" },
  ]),
  ["i32"],
  ["i32"],
);

export const PLAYER_SKILLBAR_UPDATE_ROLE = semanticRole(
  468,
  "5c17e22a87d68e79e2d258992d623f3ec83dca62d74a063d46e06f7fd426093c",
  Object.freeze([
    { start: 45, end: 50, role: "skillbar.assertion", addressClass: "immutable-data" },
    { start: 450, end: 455, role: "party.ui", addressClass: "function-index" },
  ]),
  [],
  [],
);

const ROW_READER = Object.freeze({
  bodySha256: "7b8b5c65a126fae2edfa517a4706244a0d2352c628fde208d049ecf82dfa4e72",
  params: Object.freeze(["i32", "i32", "i32"] as const),
  results: Object.freeze(["i32"] as const),
});
const SLOT_READER = Object.freeze({
  bodySha256: "ee41be1f4dcaf8e5822fc024e41cbbad74cf293cdafb2b89a8691aeb680e68b5",
  params: Object.freeze(["i32", "i32", "i32"] as const),
  results: Object.freeze(["i32"] as const),
});
const IMMUTABLE = Object.freeze({
  skillbar: "f450663f1e90de4ae2e581b6dc777b81f6c9e019bff3e5d2e60665099862e3f0",
  worldA: "435ae0e5b5663ba229fe0a312a2f3d83b4896302f9517b56d88f996ba7ea896d",
  worldB: "f7d0c7a8263c7a799862d8a513123d901e4f1cc30bc1d86da870bf5f2ec5aad6",
});

export function playerSkillbarRoleCandidateCounts(module: ModuleShape): readonly number[] {
  const exactCount = (role: Readonly<{
    bodySha256: string;
    params: readonly string[];
    results: readonly string[];
  }>): number => {
    let count = 0;
    for (
      let index = module.functionImportCount;
      index < module.functionTypeIndices.length;
      index += 1
    ) {
      if (
        signatureMatches(module, index, role.params, role.results)
        && functionBodySha256(module, index) === role.bodySha256
      ) count += 1;
    }
    return count;
  };
  return Object.freeze([
    roleFunctions(module, PLAYER_SKILLBAR_WORLD_ROLE).length,
    roleFunctions(module, PLAYER_SKILLBAR_UPDATE_ROLE).length,
    exactCount(ROW_READER),
    exactCount(SLOT_READER),
  ]);
}

export function derivePlayerSkillbarObservation(
  module: ModuleShape,
): NonNullable<KnownEnhancementBuild["playerSkillbarObservation"]> | null {
  const world = uniqueRoleFunction(module, PLAYER_SKILLBAR_WORLD_ROLE);
  const update = uniqueRoleFunction(module, PLAYER_SKILLBAR_UPDATE_ROLE);
  const rowReader = uniqueExactFunction(
    module, ROW_READER.bodySha256, ROW_READER.params, ROW_READER.results,
  );
  const slotReader = uniqueExactFunction(
    module, SLOT_READER.bodySha256, SLOT_READER.params, SLOT_READER.results,
  );
  if (world === null || update === null || rowReader === null || slotReader === null) {
    return null;
  }
  const worldBody = functionBody(module, world);
  const updateBody = functionBody(module, update);
  const rowBody = functionBody(module, rowReader);
  const slotBody = functionBody(module, slotReader);
  const worldValues = valuesForRole(worldBody, PLAYER_SKILLBAR_WORLD_ROLE);
  const updateValues = valuesForRole(updateBody, PLAYER_SKILLBAR_UPDATE_ROLE);
  if (
    staticCStringHash(module, soleValue(updateValues, "skillbar.assertion"))
      !== IMMUTABLE.skillbar
    || staticBytesHash(module, soleValue(worldValues, "world.assert-a"), 12)
      !== IMMUTABLE.worldA
    || staticBytesHash(module, soleValue(worldValues, "world.assert-b"), 12)
      !== IMMUTABLE.worldB
  ) return null;

  const worldSkillbars = unsignedOperand(worldBody, 983);
  const skillbarStride = unsignedOperand(updateBody, 236);
  const skillbarSkills = unsignedOperand(updateBody, 352);
  const slotTotalOffset = unsignedOperand(slotBody, 144);
  const coreLayout = {
    worldSkillbars,
    skillbarStride,
    skillbarAgentId: unsignedOperand(rowBody, 126),
    skillbarSkills,
    skillSlotStride: unsignedOperand(slotBody, 137),
  };
  const partyLayout = {
    skillSlotId: slotTotalOffset - skillbarSkills,
    skillbarDisabled: unsignedOperand(rowBody, 136),
  };
  if (
    slotTotalOffset < skillbarSkills
    || unsignedOperand(updateBody, 223) !== worldSkillbars
    || unsignedOperand(updateBody, 269) !== skillbarStride
    || unsignedOperand(updateBody, 323) !== skillbarStride
    || unsignedOperand(rowBody, 18) !== skillbarStride
    || unsignedOperand(slotBody, 18) !== skillbarStride
  ) return null;

  return Object.freeze({
    worldLifecycle: Object.freeze({
      functionIndex: world, params: ["i32"] as const, results: ["i32"] as const,
      bodySha256: functionBodySha256(module, world),
    }),
    update: Object.freeze({
      functionIndex: update, params: [] as const, results: [] as const,
      bodySha256: functionBodySha256(module, update),
    }),
    rowReader: Object.freeze({
      functionIndex: rowReader, params: ROW_READER.params, results: ROW_READER.results,
      bodySha256: ROW_READER.bodySha256,
    }),
    slotReader: Object.freeze({
      functionIndex: slotReader, params: SLOT_READER.params, results: SLOT_READER.results,
      bodySha256: SLOT_READER.bodySha256,
    }),
    coreLayout: verifyLayout(coreLayout, {
      worldSkillbars: { sourceRole: "world lifecycle+skillbar update", expression: "array field", occurrences: [983, 223] },
      skillbarStride: { sourceRole: "skillbar update+readers", expression: "row multiplier", occurrences: [236, 269, 323, 18] },
      skillbarAgentId: { sourceRole: "skillbar row reader", expression: "row key", occurrences: [126] },
      skillbarSkills: { sourceRole: "skillbar update", expression: "eight-slot base", occurrences: [352] },
      skillSlotStride: { sourceRole: "skill slot reader", expression: "slot multiplier", occurrences: [137] },
    }).layout,
    partyLayout: verifyLayout(partyLayout, {
      skillSlotId: { sourceRole: "skillbar update+slot reader", expression: "id offset from slot base", occurrences: [144, 352] },
      skillbarDisabled: { sourceRole: "skillbar row reader", expression: "disabled field", occurrences: [136] },
    }).layout,
  });
}
