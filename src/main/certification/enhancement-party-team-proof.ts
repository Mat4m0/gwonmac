/**
 * Feature-local structural authority for Party observation and Team Apply.
 * Team authority requires the complete Party proof.
 */
import { verifyLayout } from "./semantic-proof.js";
import { messageRelations } from "./enhancement-structural-report.js";
import { derivePartyCalleeGraph } from "./enhancement-party-callee-proof.js";
import { playerSkillbarRoleCandidateCounts } from "./enhancement-player-skillbar-proof.js";
import { dataEvidence } from "./wasm-data-evidence.js";
import {
  bodyMatchesRole,
  commonRelocationDelta,
  decodeFunctions,
  functionBody,
  functionBodySha256,
  mutableSpans,
  roleFunctions,
  semanticRole,
  signatureMatches,
  signedOperand,
  soleValue,
  staticCStringHash,
  uniqueExactFunction,
  uniqueRoleFunction,
  unsignedOperand,
  valuesForRole,
} from "./wasm-evidence.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import type {
  EnhancementObservationBaseLayout,
  EnhancementPartyLayout,
} from "../../shared/enhancement-config.js";
import type {
  DecodedFunction,
  ModuleShape,
  PlayerChatUiEvidenceReport,
} from "./enhancement-evidence-types.js";

const PARTY_PLAYER_PARTY_ROLE = semanticRole(
  338,
  "99d85ceb2072d683b1933603fb195f6fef2a27c1b11d3f0a235e850441be1df5",
  Object.freeze([
    { start: 117, end: 122, role: "party.ui", addressClass: "function-index" },
    { start: 144, end: 149, role: "party.ui", addressClass: "function-index" },
    { start: 189, end: 194, role: "party.ui", addressClass: "function-index" },
    { start: 224, end: 229, role: "party.ui", addressClass: "function-index" },
    { start: 241, end: 246, role: "party.membership-assertion", addressClass: "immutable-data" },
    { start: 306, end: 311, role: "party.ui", addressClass: "function-index" },
  ]),
  ["i32", "i32", "i32", "i32"],
  [],
);

const TEAM_SENDER_ROLE = semanticRole(
  4_425,
  "1dbcd6d20afed3f8edc323c4ddaa323e24809c439041a069f1eace6d127cc73f",
  Object.freeze([
    { start: 115, end: 120, role: "sender.assert-bytes", addressClass: "immutable-data" },
    { start: 3_526, end: 3_531, role: "sender.assert-string-length", addressClass: "immutable-data" },
    { start: 4_198, end: 4_203, role: "sender.assert-struct-count", addressClass: "immutable-data" },
    { start: 4_390, end: 4_395, role: "sender.assert-switch", addressClass: "immutable-data" },
  ]),
  ["i32", "i32", "i32"],
  [],
);

const PARTY_EXACT_ROLES = Object.freeze({
  partyInfoLifecycle: { semantic: semanticRole(295, "ae58140cf28e2d6afdc92d731da94fed2945fc501911160624cce6fddd37aa05", Object.freeze([
    ...[76, 111, 146, 181, 216, 251, 286].map((start) => ({ start, end: start + 5, role: "party-info.release", addressClass: "function-index" as const })),
  ]), ["i32"], ["i32"]) },
  partyFlagWriter: { semantic: semanticRole(15, "941d0f4ea3ce80d1787e3163e16cb06deb129a47f25ca91b398add3222a4082b", Object.freeze([
    { start: 9, end: 14, role: "party-flag.notify", addressClass: "function-index" },
  ]), ["i32", "i32"], []) },
  accountUnlockWriter: { semantic: semanticRole(19, "92bfe16ed2f66d3394546ca883489b0e3fc629125a99c6d8d67309bd1600677b", Object.freeze([
    { start: 6, end: 11, role: "unlocks.resolve", addressClass: "function-index" },
  ]), ["i32"], []) },
  heroFlagWriter: { semantic: semanticRole(150, "9f4ea1d46ddf8beeb429cbedcf0fc6ca45f9405e3c0f2be8ba43891721ad3375", Object.freeze([
    { start: 143, end: 148, role: "hero-flags.ui", addressClass: "function-index" },
  ]), ["i32", "i32", "i32"], []) },
  attributesWriter: { semantic: semanticRole(439, "08861c55923893efa078aac295007c0be9f6e19a8807542d4e24c6f4e41578de", Object.freeze([
    { start: 164, end: 169, role: "attributes.apply", addressClass: "function-index" },
    { start: 222, end: 227, role: "attributes.decode", addressClass: "function-index" },
    { start: 361, end: 366, role: "attributes.begin", addressClass: "function-index" },
    { start: 373, end: 378, role: "attributes.commit", addressClass: "function-index" },
    { start: 406, end: 411, role: "attributes.ui", addressClass: "function-index" },
    { start: 421, end: 426, role: "attributes.finish", addressClass: "function-index" },
  ]), ["i32", "i32", "i32"], []) },
  professionAgent: { bodySha256: "ff540acea56ffbc5947288f9d461495e1970006fba7799ffd9d2b1dae1d06b93", params: ["i32", "i32"], results: ["i32"] },
  professionPrimary: { bodySha256: "5b3490ae4c66dad083b8cbea456d2e47d41ff794e9c03aa15acdf2b6523915ec", params: ["i32", "i32"], results: ["i32"] },
  professionSecondary: { bodySha256: "92fe2aa71777d546d797a4f7850cb59b1693f3b2937021dd5cebc85933403e07", params: ["i32", "i32"], results: ["i32"] },
  professionUnlocked: { bodySha256: "7a1b17e51097a6599a036629fdcc630afa0850bacb0f2998d0ad8107d39ec9b5", params: ["i32", "i32"], results: ["i32"] },
  characterUnlockReader: { semantic: semanticRole(128, "1d6008c169d1dacfa8cde21d77a071336d056d2fa14677c3d468154d8689532a", Object.freeze([
    { start: 23, end: 28, role: "unlocks.resolve", addressClass: "function-index" },
    { start: 111, end: 116, role: "unlocks.ui", addressClass: "function-index" },
  ]), ["i32", "i32"], []) },
} as const);

// The exact mutable-static operand paired with the certified context root.
// Their common relocation delta must agree on every candidate client.
const PARTY_MAP_LIFECYCLE_STATIC_BASELINE = 1_447_000;

type PartyFunctionRole = (typeof PARTY_EXACT_ROLES)[keyof typeof PARTY_EXACT_ROLES];

const PARTY_DIRTY_ROLES = Object.freeze([
  semanticRole(622, "07d8d87f5575c572d3f53fcff464cd07fba710f1a01e451d94a414f28b55ba26", Object.freeze([
    { start: 580, end: 585, role: "party.ui", addressClass: "function-index" },
  ]), ["i32", "i32", "i32", "i32", "i32"], []),
  semanticRole(683, "4276027f9ac9dada4d236934c4a7170f22004934fdba19376e620e0aa14f6654", Object.freeze([
    { start: 665, end: 670, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 15 }, () => "i32"), []),
  semanticRole(127, "509bab21ca8be2a1f6287793e50f88825bb1d9f4432d3b29e3a394b117a72d3a", Object.freeze([
    { start: 88, end: 93, role: "map.lifecycle-static", addressClass: "mutable-static" },
    { start: 119, end: 124, role: "party.ui", addressClass: "function-index" },
  ]), ["i32", "i32"], ["i32"]),
  semanticRole(262, "157e15c62319c9bdff7b46e8b0ce504c52af0b6eee0faddd1b1d94eb90f2df7b", Object.freeze([
    { start: 120, end: 125, role: "party.ui", addressClass: "function-index" },
  ]), ["i32", "i32", "i32", "f32", "i32", "i32"], []),
  semanticRole(186, "6f06eff3b66948891fe3e291a62709706f41b2a47dfb20c00054655f917ed187", Object.freeze([
    { start: 169, end: 174, role: "party.ui", addressClass: "function-index" },
  ]), ["i32", "i32"], []),
  semanticRole(288, "3891f1163ce484f0244b5e16308b3a8d08eb95dbebf143fe2681af6112099468", Object.freeze([
    { start: 109, end: 114, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 9 }, () => "i32"), []),
  semanticRole(305, "4b39d0c5b6cd8be2bdbf8d6289b06f0206074ef0fa24e772cb4d34f2b774bb7f", Object.freeze([
    { start: 279, end: 284, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 8 }, () => "i32"), []),
  semanticRole(459, "a24e6314fed15093fce5c54faefe9ed8936e243b2a06e96c2401214b254b9125", Object.freeze([
    { start: 408, end: 413, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 4 }, () => "i32"), []),
  semanticRole(279, "ff174e8924bfb8ccdec3614b64ec884f499348d0430c137019295d451860b35e", Object.freeze([
    { start: 238, end: 243, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 3 }, () => "i32"), []),
  semanticRole(256, "c6c049152fba5d01560c74f2bc4ffac8a9133671f7d9ee8fc1e5d0c09b4e2b8b", Object.freeze([
    { start: 238, end: 243, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 3 }, () => "i32"), []),
] as const);

const PARTY_IMMUTABLE_HASHES = Object.freeze({
  playerPartyAssertion: "11e293befd3a98a58c54d320146aab4746f2456cfe5fefd40eca2c48d28366bb",
});

const TEAM_SENDER_IMMUTABLE_HASHES = Object.freeze([
  "1627a8bdcb297de40efb0cab4028bd069275d993bfe52cf1ea517e738427af4f",
  "52cfe327ad6c66540cb88272f04b99f45fcc9c0d3a2f6d2cc1d43d0d6d57ba75",
  "3be8fd491431691c04b545a9c691266e90592a747c964587f21f408067fda424",
  "3a27ab5c8418fcef888b2aff7a1dfd56fc9de2aa53789b29f4f0c4debe2c3dc4",
] as const);

const TEAM_PACKET_CONSTRUCTOR_ROLE = semanticRole(
  11,
  "62fdd53258c559ee8a453806b12dcd46d785e9f0696ecce902e8a46cf6243564",
  mutableSpans([[5, 10, "packet.factory"]]),
  [],
  ["i32"],
);

const TEAM_BUILDER_ROLES = Object.freeze([
  { opcode: 31, length: 65, fingerprint: "008cb3c8aa865ef17bf262bde0eeb10d29cd4f19a89a9ed22132a811835a39c6", opcodeAt: 30, constructorAt: 35, senderAt: 48 },
  { opcode: 30, length: 65, fingerprint: "f7f2072bfcde3b833ff1c388e9e1190936fde208e69e8363b732ea3944ce4f7b", opcodeAt: 30, constructorAt: 35, senderAt: 48 },
  { opcode: 21, length: 72, fingerprint: "91693fa5820bda13bf3b39eede0b8b9fb36d7f82a8a5c23e086505f0510a3cb2", opcodeAt: 37, constructorAt: 42, senderAt: 55 },
  { opcode: 93, length: 218, fingerprint: "b5406c64785a6e2559a238e271085d119d34fc45c36a2a4dd404ec2f09a67625", opcodeAt: 30, constructorAt: 188, senderAt: 201 },
  { opcode: 65, length: 73, fingerprint: "66d6960cf4f889c97977b4f8ae79461e0f7034b22c24af50bc19ac9ea4803226", opcodeAt: 37, constructorAt: 43, senderAt: 56 },
  { opcode: 16, length: 289, fingerprint: "711990b1affb366ad198616fd59fa6802e0ff1644070b2fa46d844556d5be8f7", opcodeAt: 31, constructorAt: 260, senderAt: 271 },
  { opcode: 155, length: 66, fingerprint: "b2ec78d3eaa13c6a4ec8265dd5bfbbc7611d17a61e8361b37849522f43dc38d2", opcodeAt: 30, constructorAt: 36, senderAt: 49 },
] as const);

function exactPartyFunction(
  module: ModuleShape,
  role: PartyFunctionRole,
): number | null {
  return "semantic" in role
    ? uniqueRoleFunction(module, role.semantic)
    : uniqueExactFunction(module, role.bodySha256, role.params, role.results);
}

function exactPartyFunctionCount(
  module: ModuleShape,
  role: PartyFunctionRole,
): number {
  if ("semantic" in role) return roleFunctions(module, role.semantic).length;
  let count = 0;
  for (
    let functionIndex = module.functionImportCount;
    functionIndex < module.functionTypeIndices.length;
    functionIndex += 1
  ) {
    if (
      signatureMatches(module, functionIndex, role.params, role.results)
      && functionBodySha256(module, functionIndex) === role.bodySha256
    ) count += 1;
  }
  return count;
}

function teamPacketConstructorHubCount(module: ModuleShape): number {
  const decoded = decodeFunctions(module, []);
  const family = roleFunctions(module, TEAM_PACKET_CONSTRUCTOR_ROLE).map(
    (functionIndex) => ({
      functionIndex,
      callSites: decoded.reduce(
        (count, caller) => count + (caller.calls.get(functionIndex) ?? 0),
        0,
      ),
    }),
  );
  if (family.length === 0) return 0;
  const mostCallSites = Math.max(...family.map(({ callSites }) => callSites));
  if (mostCallSites < TEAM_BUILDER_ROLES.length) return 0;
  return family.filter(({ callSites }) => callSites === mostCallSites).length;
}

export type PartyTeamRoleCandidateStatus = "candidate" | "ambiguous" | "unavailable";

export interface PartyTeamRoleCandidateDiagnostic {
  readonly status: PartyTeamRoleCandidateStatus;
  readonly candidateCount: number;
}

export interface PartyTeamRoleDiagnostics {
  readonly partyObservation: PartyTeamRoleCandidateDiagnostic;
  readonly teamApply: PartyTeamRoleCandidateDiagnostic;
}

function aggregateRoleCounts(
  counts: readonly number[],
): PartyTeamRoleCandidateDiagnostic {
  const largest = Math.max(0, ...counts);
  return Object.freeze({
    status: largest > 1
      ? "ambiguous"
      : counts.length > 0 && counts.every((count) => count === 1)
        ? "candidate"
        : "unavailable",
    candidateCount: largest > 1 ? largest : largest === 1 ? 1 : 0,
  });
}

export interface PartyTeamRoleAmbiguities {
  readonly partyObservation?: number;
  readonly teamApply?: number;
}

/** Review-only candidate counts for role-uniqueness refusals. */
export function inspectPartyTeamRoleCandidates(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
): PartyTeamRoleDiagnostics {
  const partyObservation = aggregateRoleCounts([
    ...Object.values(PARTY_EXACT_ROLES).map(
      (role) => exactPartyFunctionCount(module, role),
    ),
    ...playerSkillbarRoleCandidateCounts(module),
    roleFunctions(module, PARTY_PLAYER_PARTY_ROLE).length,
    ...PARTY_DIRTY_ROLES.map((role) => roleFunctions(module, role).length),
  ]);

  const expected = baseline.teamApply;
  const builderCounts = expected?.entries.length === TEAM_BUILDER_ROLES.length
    ? TEAM_BUILDER_ROLES.map((role, index) => {
        const expectedEntry = expected.entries[index]!;
        return roleFunctions(module, semanticRole(
          role.length,
          role.fingerprint,
          Object.freeze([
            {
              start: role.constructorAt,
              end: role.constructorAt + 5,
              role: "packet.constructor",
              addressClass: "function-index",
            },
            {
              start: role.senderAt,
              end: role.senderAt + 5,
              role: "packet.sender",
              addressClass: "function-index",
            },
          ]),
          expectedEntry.params,
          expectedEntry.results,
        )).length;
      })
    : [];
  const teamApply = aggregateRoleCounts([
    roleFunctions(module, TEAM_SENDER_ROLE).length,
    teamPacketConstructorHubCount(module),
    ...builderCounts,
  ]);
  return Object.freeze({ partyObservation, teamApply });
}

export function inspectPartyTeamRoleAmbiguities(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
): PartyTeamRoleAmbiguities {
  const diagnostics = inspectPartyTeamRoleCandidates(module, baseline);
  return Object.freeze({
    ...(diagnostics.partyObservation.status === "ambiguous"
      ? { partyObservation: diagnostics.partyObservation.candidateCount }
      : {}),
    ...(diagnostics.teamApply.status === "ambiguous"
      ? { teamApply: diagnostics.teamApply.candidateCount }
      : {}),
  });
}

export function derivePartyObservation(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
  observation: EnhancementObservationBaseLayout,
  playerSkillbar: NonNullable<KnownEnhancementBuild["playerSkillbarObservation"]>,
  uiDispatcher: NonNullable<KnownEnhancementBuild["uiDispatcher"]>,
  uiEvidence: NonNullable<PlayerChatUiEvidenceReport["candidate"]>,
  suppliedDecoded?: readonly DecodedFunction[],
): KnownEnhancementBuild["partyObservation"] | null {
  const expected = baseline.partyObservation;
  const baselineObservation = baseline.observationBase?.layout;
  if (!expected || !baselineObservation) return null;

  const partyInfoFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.partyInfoLifecycle);
  const partyFlagFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.partyFlagWriter);
  const accountFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.accountUnlockWriter);
  const flagFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.heroFlagWriter);
  const attributesFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.attributesWriter);
  const professionFunctions = [
    exactPartyFunction(module, PARTY_EXACT_ROLES.professionAgent),
    exactPartyFunction(module, PARTY_EXACT_ROLES.professionPrimary),
    exactPartyFunction(module, PARTY_EXACT_ROLES.professionSecondary),
    exactPartyFunction(module, PARTY_EXACT_ROLES.professionUnlocked),
  ];
  const characterUnlockFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.characterUnlockReader);
  const worldFunction = playerSkillbar.worldLifecycle.functionIndex;
  const playerPartyFunction = uniqueRoleFunction(module, PARTY_PLAYER_PARTY_ROLE);
  const dirtyFunctions = PARTY_DIRTY_ROLES.map((role) => uniqueRoleFunction(module, role));
  const infoFunction = dirtyFunctions[1] ?? null;
  const mapLoadedFunction = dirtyFunctions[2] ?? null;
  if (
    partyInfoFunction === null || partyFlagFunction === null || accountFunction === null
    || flagFunction === null || infoFunction === null || attributesFunction === null
    || professionFunctions.some((value) => value === null)
    || characterUnlockFunction === null || playerPartyFunction === null
    || mapLoadedFunction === null || dirtyFunctions.some((value) => value === null)
  ) return null;

  const worldBody = functionBody(module, worldFunction);
  const playerPartyBody = functionBody(module, playerPartyFunction);
  const mapLoadedBody = functionBody(module, mapLoadedFunction);
  const playerPartyValues = valuesForRole(playerPartyBody, PARTY_PLAYER_PARTY_ROLE);
  const mapValues = valuesForRole(mapLoadedBody, PARTY_DIRTY_ROLES[2]);
  if (
    staticCStringHash(module, soleValue(playerPartyValues, "party.membership-assertion"))
      !== PARTY_IMMUTABLE_HASHES.playerPartyAssertion
    || soleValue(playerPartyValues, "party.ui") !== uiDispatcher.functionIndex
    || commonRelocationDelta([
      [
        soleValue(mapValues, "map.lifecycle-static"),
        PARTY_MAP_LIFECYCLE_STATIC_BASELINE,
      ],
      [observation.contextRoot, baselineObservation.contextRoot],
    ]) === null
  ) return null;

  const dirtyMessages = [...expected.partyDirtyMessages];
  const decoded = suppliedDecoded ?? decodeFunctions(module, dirtyMessages);
  for (let index = 0; index < dirtyMessages.length; index += 1) {
    const roleValues = valuesForRole(
      functionBody(module, dirtyFunctions[index]!),
      PARTY_DIRTY_ROLES[index]!,
    );
    if (soleValue(roleValues, "party.ui") !== uiDispatcher.functionIndex) return null;
    const relation = messageRelations(decoded, uiDispatcher.functionIndex, dirtyMessages[index]!)
      .filter((candidate) => candidate.producerFunctionIndex === dirtyFunctions[index]);
    if (relation.length !== 1 || relation[0]!.messageSites !== 1) return null;
  }

  const heroAddBody = functionBody(module, dirtyFunctions[6]!);
  const partyInfoBody = functionBody(module, partyInfoFunction);
  const partyFlagBody = functionBody(module, partyFlagFunction);
  const accountBody = functionBody(module, accountFunction);
  const flagBody = functionBody(module, flagFunction);
  const infoBody = functionBody(module, infoFunction);
  const attributesBody = functionBody(module, attributesFunction);
  const professionBodies = professionFunctions.map((value) => functionBody(module, value!));
  const characterUnlockBody = functionBody(module, characterUnlockFunction);
  const observedAttributeCalls = valuesForRole(
    attributesBody,
    PARTY_EXACT_ROLES.attributesWriter.semantic,
  );
  const observedPartyFlagCalls = valuesForRole(
    partyFlagBody,
    PARTY_EXACT_ROLES.partyFlagWriter.semantic,
  );
  const partyInfoCalls = valuesForRole(
    partyInfoBody,
    PARTY_EXACT_ROLES.partyInfoLifecycle.semantic,
  );
  const partyFlagCalls = observedPartyFlagCalls;
  const accountCalls = valuesForRole(
    accountBody,
    PARTY_EXACT_ROLES.accountUnlockWriter.semantic,
  );
  const heroFlagCalls = valuesForRole(
    flagBody,
    PARTY_EXACT_ROLES.heroFlagWriter.semantic,
  );
  const attributeCalls = observedAttributeCalls;
  const characterUnlockCalls = valuesForRole(
    characterUnlockBody,
    PARTY_EXACT_ROLES.characterUnlockReader.semantic,
  );
  const observedUnlockResolver = soleValue(accountCalls, "unlocks.resolve");
  const attributeCallees = [
    soleValue(attributeCalls, "attributes.apply"),
    soleValue(attributeCalls, "attributes.decode"),
    soleValue(attributeCalls, "attributes.begin"),
    soleValue(attributeCalls, "attributes.commit"),
    soleValue(attributeCalls, "attributes.finish"),
  ];
  const calleeFunctions = derivePartyCalleeGraph(module, uiDispatcher.functionIndex, {
    unlockResolver: observedUnlockResolver,
    partyInfoRelease: soleValue(partyInfoCalls, "party-info.release"),
    partyFlagNotify: soleValue(partyFlagCalls, "party-flag.notify"),
    attributes: attributeCallees as [number, number, number, number, number],
  });
  if (
    calleeFunctions === null
    || soleValue(heroFlagCalls, "hero-flags.ui") !== uiDispatcher.functionIndex
    || soleValue(attributeCalls, "attributes.ui") !== uiDispatcher.functionIndex
    || soleValue(characterUnlockCalls, "unlocks.ui") !== uiDispatcher.functionIndex
    || soleValue(characterUnlockCalls, "unlocks.resolve") !== observedUnlockResolver
    || new Set(attributeCallees).size !== attributeCallees.length
    || !signatureMatches(module, attributeCallees[0]!, ["i32", "i32", "i32"], [])
    || !signatureMatches(module, attributeCallees[1]!, ["i32", "i32", "i32"], [])
    || !signatureMatches(module, attributeCallees[2]!, ["i32", "i32"], [])
    || !signatureMatches(module, attributeCallees[3]!, ["i32", "i32", "i32"], [])
    || !signatureMatches(module, attributeCallees[4]!, ["i32", "i32", "i32"], [])
  ) return null;

  const heroMemberStride = signedOperand(heroAddBody, 142);
  const professionStateStride = unsignedOperand(professionBodies[0]!, 18);
  const layout: EnhancementPartyLayout = {
    partyContext: unsignedOperand(heroAddBody, 30),
    playerParty: unsignedOperand(playerPartyBody, 56),
    partyHeroes: unsignedOperand(heroAddBody, 111),
    heroMemberStride,
    heroAgentId: heroMemberStride + signedOperand(heroAddBody, 188),
    heroOwnerPlayerId: heroMemberStride + signedOperand(heroAddBody, 200),
    heroId: heroMemberStride + signedOperand(heroAddBody, 178),
    heroLevel: heroMemberStride + signedOperand(heroAddBody, 148),
    partyPlayers: unsignedOperand(partyInfoBody, 277),
    partyHenchmen: unsignedOperand(partyInfoBody, 242),
    partyFlag: unsignedOperand(partyFlagBody, 7),
    accountContextSlot: unsignedOperand(accountBody, 4),
    accountUnlockedSkills: unsignedOperand(accountBody, 12),
    worldHeroFlags: unsignedOperand(worldBody, 1_991),
    heroFlagStride: unsignedOperand(flagBody, 18),
    flagHeroId: 0,
    flagAgentId: unsignedOperand(flagBody, 63),
    flagBehavior: unsignedOperand(flagBody, 131),
    worldHeroInfo: unsignedOperand(worldBody, 1_953),
    heroInfoStride: unsignedOperand(infoBody, 35),
    infoHeroId: unsignedOperand(infoBody, 475),
    infoAgentId: unsignedOperand(infoBody, 468),
    infoLevel: unsignedOperand(infoBody, 461),
    infoPrimary: unsignedOperand(infoBody, 454),
    infoSecondary: unsignedOperand(infoBody, 447),
    infoAppearanceBitmap: unsignedOperand(infoBody, 412),
    worldAttributes: unsignedOperand(worldBody, 2_826),
    attributeStride: unsignedOperand(attributesBody, 35),
    attributeAgentId: 0,
    attributeEntries: unsignedOperand(attributesBody, 198),
    attributeEntryStride: unsignedOperand(attributesBody, 181),
    attributeEntryId: 0,
    attributeEntryRank: 4,
    worldProfessionStates: unsignedOperand(worldBody, 1_213),
    professionStateStride,
    worldCharacterSkills: unsignedOperand(worldBody, 925),
  };
  if (
    unsignedOperand(playerPartyBody, 318) !== layout.playerParty
    || unsignedOperand(heroAddBody, 135) !== layout.partyHeroes
    || unsignedOperand(flagBody, 103) !== layout.heroFlagStride
    || unsignedOperand(flagBody, 119) !== layout.flagAgentId
    || [1, 2, 3].some((index) => unsignedOperand(professionBodies[index]!, 18) !== professionStateStride)
    || unsignedOperand(characterUnlockBody, 70) !== layout.worldCharacterSkills
  ) return null;

  const verified = verifyLayout(layout, {
    partyContext: { sourceRole: "PartyAddHero", expression: "GameContext PartyContext load", occurrences: [30, 213] },
    playerParty: { sourceRole: "party membership writer", expression: "matched load/store with shared party updater", occurrences: [56, 318] },
    partyHeroes: { sourceRole: "PartyAddHero+PartyInfo lifecycle", expression: "hero array field", occurrences: [111, 135, 207] },
    heroMemberStride: { sourceRole: "PartyAddHero", expression: "hero row multiplier", occurrences: [142] },
    heroAgentId: { sourceRole: "PartyAddHero", expression: "row end minus 24", occurrences: [188] },
    heroOwnerPlayerId: { sourceRole: "PartyAddHero", expression: "row end minus 20", occurrences: [200] },
    heroId: { sourceRole: "PartyAddHero", expression: "row end minus 16", occurrences: [178] },
    heroLevel: { sourceRole: "PartyAddHero", expression: "row end minus 4", occurrences: [148] },
    partyPlayers: { sourceRole: "PartyInfo lifecycle", expression: "player array clear", occurrences: [277] },
    partyHenchmen: { sourceRole: "PartyInfo lifecycle", expression: "henchman array clear", occurrences: [242] },
    partyFlag: { sourceRole: "party flag writer", expression: "field store followed by party updater", occurrences: [7] },
    accountContextSlot: { sourceRole: "account unlock writer", expression: "registered AccountContext slot", occurrences: [4] },
    accountUnlockedSkills: { sourceRole: "account unlock writer", expression: "AccountContext array field", occurrences: [12] },
    worldHeroFlags: { sourceRole: "WorldContext lifecycle", expression: "array clear field", occurrences: [1_991] },
    heroFlagStride: { sourceRole: "hero flag writer", expression: "binary-search row stride", occurrences: [18, 103] },
    flagHeroId: { sourceRole: "hero flag writer", expression: "first row key", occurrences: [0] },
    flagAgentId: { sourceRole: "hero flag writer", expression: "binary-search agent key", occurrences: [63, 119] },
    flagBehavior: { sourceRole: "hero flag writer", expression: "behavior store", occurrences: [131] },
    worldHeroInfo: { sourceRole: "WorldContext lifecycle", expression: "array clear field", occurrences: [1_953] },
    heroInfoStride: { sourceRole: "HeroDataAdded", expression: "hero-info row multiplier", occurrences: [35] },
    infoHeroId: { sourceRole: "HeroDataAdded", expression: "hero id store", occurrences: [475] },
    infoAgentId: { sourceRole: "HeroDataAdded", expression: "agent id store", occurrences: [468] },
    infoLevel: { sourceRole: "HeroDataAdded", expression: "level store", occurrences: [461] },
    infoPrimary: { sourceRole: "HeroDataAdded", expression: "primary profession store", occurrences: [454] },
    infoSecondary: { sourceRole: "HeroDataAdded", expression: "secondary profession store", occurrences: [447] },
    infoAppearanceBitmap: { sourceRole: "HeroDataAdded", expression: "appearance bitmap store", occurrences: [412] },
    worldAttributes: { sourceRole: "WorldContext lifecycle", expression: "array clear field", occurrences: [2_826] },
    attributeStride: { sourceRole: "attribute writer", expression: "row multiplier", occurrences: [35, 68, 124] },
    attributeAgentId: { sourceRole: "attribute writer", expression: "first row key", occurrences: [0] },
    attributeEntries: { sourceRole: "attribute writer", expression: "entry table base", occurrences: [198] },
    attributeEntryStride: { sourceRole: "attribute writer", expression: "entry index multiplier", occurrences: [181] },
    attributeEntryId: { sourceRole: "attribute writer", expression: "first entry field", occurrences: [0] },
    attributeEntryRank: { sourceRole: "attribute writer", expression: "rank field following id", occurrences: [4] },
    worldProfessionStates: { sourceRole: "WorldContext lifecycle", expression: "array clear field", occurrences: [1_213] },
    professionStateStride: { sourceRole: "four profession readers", expression: "binary-search row stride", occurrences: [18, 18, 18, 18] },
    worldCharacterSkills: { sourceRole: "WorldContext lifecycle+unlock reader", expression: "bitset array field", occurrences: [925, 70] },
  }).layout;
  return Object.freeze({
    ...expected,
    partyDirtyMessages: Object.freeze(dirtyMessages) as typeof expected.partyDirtyMessages,
    playerChatProducer: uiEvidence.playerChatProducerFunctionIndex,
    nearbyPlayerMessageProducers: Object.freeze([
      uiEvidence.nearby7fProducerFunctionIndices[0]!,
      uiEvidence.nearby80ProducerFunctionIndices[0]!,
    ] as const),
    layout: verified,
  });
}

export function deriveTeamApply(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
  suppliedDecoded?: readonly DecodedFunction[],
): KnownEnhancementBuild["teamApply"] | null {
  const expected = baseline.teamApply;
  if (!expected || expected.entries.length !== TEAM_BUILDER_ROLES.length) return null;
  const senderFunction = uniqueRoleFunction(module, TEAM_SENDER_ROLE);
  if (senderFunction === null) return null;
  const senderBody = functionBody(module, senderFunction);
  const senderValues = valuesForRole(senderBody, TEAM_SENDER_ROLE);
  const senderRoles = [
    "sender.assert-bytes", "sender.assert-string-length",
    "sender.assert-struct-count", "sender.assert-switch",
  ];
  if (senderRoles.some((role, index) =>
    staticCStringHash(module, soleValue(senderValues, role))
      !== TEAM_SENDER_IMMUTABLE_HASHES[index])) return null;

  let constructorFunction: number | null = null;
  const entries = TEAM_BUILDER_ROLES.map((role, index) => {
    const expectedEntry = expected.entries[index]!;
    const semantic = semanticRole(
      role.length,
      role.fingerprint,
      Object.freeze([
        { start: role.constructorAt, end: role.constructorAt + 5, role: "packet.constructor", addressClass: "function-index" },
        { start: role.senderAt, end: role.senderAt + 5, role: "packet.sender", addressClass: "function-index" },
      ]),
      expectedEntry.params,
      expectedEntry.results,
    );
    const functionIndex = uniqueRoleFunction(module, semantic);
    if (functionIndex === null) return null;
    const body = functionBody(module, functionIndex);
    const values = valuesForRole(body, semantic);
    const constructor = soleValue(values, "packet.constructor");
    if (constructorFunction !== null && constructorFunction !== constructor) return null;
    constructorFunction = constructor;
    if (
      soleValue(values, "packet.sender") !== senderFunction
      || unsignedOperand(body, role.opcodeAt) !== role.opcode
      || role.opcode !== expectedEntry.opcode
    ) return null;
    return Object.freeze({
      ...expectedEntry,
      functionIndex,
      bodySha256: functionBodySha256(module, functionIndex),
    });
  });
  if (constructorFunction === null || entries.some((entry) => entry === null)) return null;
  const packetConstructor = constructorFunction;
  const constructorBody = functionBody(module, packetConstructor);
  if (!bodyMatchesRole(constructorBody, TEAM_PACKET_CONSTRUCTOR_ROLE)) return null;
  const decoded = suppliedDecoded ?? decodeFunctions(module, []);
  // The packet allocator is the shared constructor hub: among the exact
  // factory-wrapper family it is the uniquely most-referenced node, and every
  // named Team builder above must call that same node. This admits unrelated
  // packet-builder additions while refusing an adjacent lookalike wrapper.
  const constructorFamily = roleFunctions(module, TEAM_PACKET_CONSTRUCTOR_ROLE)
    .map((functionIndex) => ({
      functionIndex,
      callSites: decoded.reduce(
        (count, caller) => count + (caller.calls.get(functionIndex) ?? 0),
        0,
      ),
    }));
  const mostCallSites = Math.max(...constructorFamily.map(({ callSites }) => callSites));
  const constructorHubs = constructorFamily.filter(
    ({ callSites }) => callSites === mostCallSites,
  );
  if (
    constructorHubs.length !== 1
    || constructorHubs[0]!.functionIndex !== packetConstructor
    || mostCallSites < TEAM_BUILDER_ROLES.length
  ) return null;
  const { initializedDataEnd } = dataEvidence(module);
  const packetFactory = soleValue(
    valuesForRole(constructorBody, TEAM_PACKET_CONSTRUCTOR_ROLE),
    "packet.factory",
  );
  if (packetFactory < initializedDataEnd || packetFactory % 4 !== 0) return null;
  return Object.freeze({
    ...expected,
    professionTrace: Object.freeze({
      ...expected.professionTrace,
      sender: Object.freeze({
        ...expected.professionTrace.sender,
        functionIndex: senderFunction,
        bodySha256: functionBodySha256(module, senderFunction),
      }),
    }),
    entries: Object.freeze(entries) as typeof expected.entries,
  });
}
