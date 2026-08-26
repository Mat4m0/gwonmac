/**
 * Proves the Party writer's private callees across equivalent client rebuilds.
 * It owns their immutable-content and mutable-storage relationship ledgers.
 */
import {
  bodyMatchesRole,
  functionBody,
  semanticRole,
  soleValue,
  staticCStringHash,
  uniqueExactFunction,
  uniqueRoleFunction,
  valuesForRole,
} from "./wasm-evidence.js";
import type { ModuleShape, SemanticRole } from "./enhancement-evidence-types.js";
import { dataEvidence } from "./wasm-data-evidence.js";

const span = (
  start: number,
  role: string,
  addressClass: "function-index" | "immutable-data" | "mutable-static",
) => Object.freeze({ start, end: start + 5, role, addressClass });

const PARTY_CALLEE_ROLES = Object.freeze({
  unlockResolver: semanticRole(62, "89a3bd86b2316709e91dc8c6e29fe0dd146bd341ea67500c1803dc90833ef0b5", [
    span(9, "resolver.slot", "mutable-static"), span(33, "resolver.apply", "function-index"),
    span(25, "resolver.source-file", "immutable-data"),
    span(42, "resolver.slot", "mutable-static"),
  ], ["i32"], ["i32"]),
  attributeApply: semanticRole(114, "30e9eb346f79bbb0bdebad3f93503e4381e20951a31441543ffc39375ed1e147", [
    span(44, "apply.source-file", "immutable-data"),
    span(55, "apply.prepare", "function-index"), span(82, "apply.error-a", "immutable-data"),
    span(88, "apply.error-b", "immutable-data"), span(96, "apply.import", "function-index"),
  ], ["i32", "i32", "i32"], []),
  partyInfoRelease: semanticRole(24, "acd056753294c376b38435aba83bd8bfe11276b0ffd53e9ea9ab75f3bafd2444", [
    span(6, "release.empty", "immutable-data"), span(17, "release.storage", "function-index"),
  ], ["i32"], []),
  attributeFinish: semanticRole(76, "e4e61ee10c161858ab5a05ede4649e8a09649e4035327fd1a564e5e546443bb1", [
    span(49, "finish.notify", "function-index"), span(59, "finish.flush", "function-index"),
  ], ["i32", "i32", "i32"], []),
  attributeBegin: semanticRole(309, "a3d603997c440ac3a816c9320d701d7e5fa1557adaada16515dcbe1456b24c3a", [
    span(191, "begin.error-a", "immutable-data"), span(205, "begin.apply", "function-index"),
    span(197, "begin.source-file", "immutable-data"),
    span(229, "begin.error-b", "immutable-data"), span(243, "begin.apply", "function-index"),
    span(235, "begin.source-file", "immutable-data"),
    span(292, "begin.ui", "function-index"),
  ], ["i32", "i32"], []),
  attributeDecode: semanticRole(235, "ada7f9a374a6a34216e582e2d3c5a4dae59891c7a3431f3a1fc52eed62548376", [
    span(29, "decode.first", "function-index"), span(90, "decode.second", "function-index"),
    span(140, "decode.error", "immutable-data"), span(155, "decode.apply", "function-index"),
    span(146, "decode.source-file", "immutable-data"),
    span(171, "decode.copy", "function-index"), span(189, "decode.release", "function-index"),
  ], ["i32", "i32", "i32"], []),
  attributeCommit: semanticRole(134, "771da112535ec001dfcb8ebd7902815aa868487eca03affedf1500b5843a1dae", [
    span(6, "commit.resolve", "function-index"), span(21, "commit.first", "function-index"),
    span(37, "commit.second", "function-index"), span(55, "commit.third", "function-index"),
    span(81, "commit.fourth", "function-index"), span(99, "commit.fifth", "function-index"),
    span(113, "commit.sixth", "function-index"),
  ], ["i32", "i32", "i32"], []),
  partyFlagNotify: semanticRole(16, "03a8933028dafb93280618f5b57c4f89081e4a2f351b9f608e937b0b3b4a6fa2", [
    span(4, "notify.resolve", "function-index"), span(10, "notify.dispatch", "function-index"),
  ], [], []),
  notifyDispatch: semanticRole(1_054, "03bb2a190659b28eae56afe306dbbfd959295d294da23af71b32db30bd1ceea1", [
    span(61, "notify.helper-a", "function-index"),
    span(247, "notify.array-file", "immutable-data"),
    span(583, "notify.helper-b", "function-index"),
    span(703, "notify.helper-b", "function-index"),
    span(961, "notify.ui", "function-index"), span(1_022, "notify.ui", "function-index"),
  ], ["i32"], []),
});

const RELEASE_STATIC_STARTS = Object.freeze([
  23, 112, 153, 197, 213, 464, 475, 496, 509, 665, 738, 752, 763,
  775, 796, 810, 821, 836, 852, 863, 875, 937, 981, 997, 1_248,
  1_259, 1_280, 1_293, 1_467, 1_522, 1_538, 1_567, 1_687, 1_707,
  1_733, 1_955, 1_972,
] as const);
const RELEASE_STATIC_DELTAS = Object.freeze([
  16, 20, 40, 0, 0, 304, 304, 4, 4, 8, 24, 24, 12, 12, 20, 8, 20,
  20, 20, 8, 8, 40, 0, 0, 304, 304, 4, 4, 8, 40, 0, 0, 304, 4, 4, 32, 32,
] as const);
const PARTY_RELEASE_STORAGE_ROLE = semanticRole(
  1_988,
  "a99214933ed1c82fe6ce45a9c067cc87b374389e00c87373defa0faeb6dea402",
  [
    ...RELEASE_STATIC_STARTS.map((start, index) =>
      span(start, `release.static-${index}`, "mutable-static")),
    span(1_981, "release.cleanup", "function-index"),
  ],
  ["i32"],
  [],
);

const PARTY_LEAF_ROLES = Object.freeze({
  first: semanticRole(60, "2295ea545e420022895bf4084eaa03bd8e47bce067db291c7e9ce2e1c390e89d", [span(13, "first.error", "immutable-data"), span(19, "first.source-file", "immutable-data"), span(50, "first.empty", "immutable-data")], ["i32"], ["i32"]),
  second: semanticRole(45, "a99cc45b1dc37974f3ab2032d30f7617ebb5f0d45cdf249b2453094b8d49bb41", [span(11, "second.error", "immutable-data"), span(17, "second.source-file", "immutable-data"), span(39, "second.empty", "immutable-data")], ["i32"], ["i32"]),
  third: semanticRole(48, "c6ef04ab4bddab108d5b0f7c90acb55f7d6eab79b0c28355ca89b43751c02060", [span(11, "third.error", "immutable-data"), span(17, "third.source-file", "immutable-data"), span(38, "third.empty", "immutable-data")], ["i32"], ["i32"]),
  sixth: semanticRole(48, "7aaa435337e435feda9d0d29ab7f66079f92cadbcd52c1bf2749de775e883799", [span(11, "sixth.error", "immutable-data"), span(17, "sixth.source-file", "immutable-data"), span(38, "sixth.empty", "immutable-data")], ["i32"], ["i32"]),
  finishState: semanticRole(11, "8e87304b020e158179c2a265fec3d2b82230104b60f1c55db6aaafe7ecfc7936", [span(5, "finish.state", "mutable-static")], [], ["i32"]),
  finishFlush: semanticRole(4_425, "c9e18e4f6773e7b7dde9c9b171ba89429f1a9c35e6b2e6f5d46d8220da5f9418", [
    span(28, "flush.assert-e", "immutable-data"), span(34, "flush.source-file", "immutable-data"),
    span(56, "flush.assert-f", "immutable-data"), span(62, "flush.source-file", "immutable-data"),
    span(115, "flush.assert-a", "immutable-data"), span(3_526, "flush.assert-b", "immutable-data"),
    ...[121, 695, 844].map((start) => span(start, "flush.source-file", "immutable-data")),
    span(888, "flush.assert-g", "immutable-data"), span(894, "flush.array-file", "immutable-data"),
    span(2_818, "flush.assert-h", "immutable-data"), span(2_824, "flush.source-file", "immutable-data"),
    span(4_198, "flush.assert-c", "immutable-data"), span(4_390, "flush.assert-d", "immutable-data"),
    span(3_532, "flush.source-file", "immutable-data"),
    span(4_204, "flush.source-file", "immutable-data"),
    span(4_396, "flush.source-file", "immutable-data"),
  ], ["i32", "i32", "i32"], []),
});

const IMMUTABLE_HASHES = Object.freeze({
  "apply.error-a": "5407348e457aa37bbe697988235c6a8a082c28d31f5bf96b85f11f492f3385af",
  "apply.error-b": "9bde6f6e145018ed239b90184e83c6d20fa2758122ae1c91a9347fa3c6070db4",
  "release.empty": "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
  "begin.error-a": "aaafeb7fb3bb71d547e6527adb5b26414003dc789161216147ad243547bd2db4",
  "begin.error-b": "7610a216cf55f580f894d3b4747dd0ee7c3b702e220e721e749117bbcaa78018",
  "decode.error": "d1b8f6625b756a1a05e25c81d847cf2a3d41ad9241c36c2129ec358a98ec58e9",
  "first.error": "e8d0499ff24ad5612dfc80f89eaa8b452644e72d9f402c3a47c12f3db5b60d55",
  "first.empty": "2921a11f25dadaa24aa79a548e4e81508c2e5e56af2d833d65e2bcce448ce2f5",
  "second.error": "e8d0499ff24ad5612dfc80f89eaa8b452644e72d9f402c3a47c12f3db5b60d55",
  "second.empty": "47dc540c94ceb704a23875c11273e16bb0b8a87aed84de911f2133568115f254",
  "third.error": "4cdf02f5889ea4e29dcd948c57b45f0d33aefb1429949d06797f6bcb19caad88",
  "third.empty": "2921a11f25dadaa24aa79a548e4e81508c2e5e56af2d833d65e2bcce448ce2f5",
  "sixth.error": "4cdf02f5889ea4e29dcd948c57b45f0d33aefb1429949d06797f6bcb19caad88",
  "sixth.empty": "47dc540c94ceb704a23875c11273e16bb0b8a87aed84de911f2133568115f254",
  "flush.assert-a": "1627a8bdcb297de40efb0cab4028bd069275d993bfe52cf1ea517e738427af4f",
  "flush.assert-b": "52cfe327ad6c66540cb88272f04b99f45fcc9c0d3a2f6d2cc1d43d0d6d57ba75",
  "flush.assert-c": "3be8fd491431691c04b545a9c691266e90592a747c964587f21f408067fda424",
  "flush.assert-d": "3a27ab5c8418fcef888b2aff7a1dfd56fc9de2aa53789b29f4f0c4debe2c3dc4",
});

const PARTY_APPLY_PREPARE_ROLE = semanticRole(113,
  "2598fca9c7b8501d556bf382d75b285bdb5fc3b824a3f861a104035e88e30150",
  [span(33, "prepare.source-file", "immutable-data"),
    span(58, "prepare.assertion", "immutable-data"),
    span(64, "prepare.source-file", "immutable-data")],
  ["i32", "i32", "i32"], []);
const PARTY_DECODE_SECOND_ROLE = semanticRole(66,
  "f7d8b9b0af470b4b8811847f143b5dc08b3a929ce1bbd70773d97ff13e3efda7",
  [span(46, "second.empty", "immutable-data")],
  ["i32", "i32", "i32"], ["i32"]);
const PARTY_DECODE_COPY_ROLE = semanticRole(15,
  "55503d8f407c3fe2635098719d71efbd50ce88afb596b08cee0b62005e89554a",
  [span(8, "copy.helper", "function-index")],
  ["i32", "i32", "i32"], []);

const EXACT_LEAVES = Object.freeze({
  decodeFirst: ["b0ca60097a5aaaa6a371046a092ef3ad04a84b1f56ab6322e4e8b585beee721a", ["i32", "i32", "i32", "i32"], ["i32"]],
  commitFourth: ["fb96881d692f9e58bd28daaf2a4c0f2872c9fe2f8f19b5a7248e244fbd91a03c", ["i32", "i32", "i32"], ["i32"]],
  commitFifth: ["5b3490ae4c66dad083b8cbea456d2e47d41ff794e9c03aa15acdf2b6523915ec", ["i32", "i32"], ["i32"]],
} as const);

export interface PartyCalleeGraph {
  readonly unlockResolver: number;
  readonly attributeApply: number;
  readonly partyInfoRelease: number;
  readonly attributeFinish: number;
  readonly attributeBegin: number;
  readonly attributeDecode: number;
  readonly attributeCommit: number;
  readonly partyFlagNotify: number;
}

function values(module: ModuleShape, index: number, role: SemanticRole) {
  return valuesForRole(functionBody(module, index), role);
}

function immutableValuesMatch(
  module: ModuleShape,
  roleValues: Map<string, number[]>,
  roles: readonly (keyof typeof IMMUTABLE_HASHES)[],
): boolean {
  return roles.every((role) =>
    staticCStringHash(module, soleValue(roleValues, role)) === IMMUTABLE_HASHES[role]);
}

export function derivePartyCalleeGraph(
  module: ModuleShape,
  uiDispatcher: number,
  observed: Readonly<{
    unlockResolver: number;
    partyInfoRelease: number;
    partyFlagNotify: number;
    attributes: readonly [number, number, number, number, number];
  }>,
): PartyCalleeGraph | null {
  const exact = Object.fromEntries(Object.entries(EXACT_LEAVES).map(([name, entry]) =>
    [name, uniqueExactFunction(module, entry[0], entry[1], entry[2])])) as {
      [Name in keyof typeof EXACT_LEAVES]: number | null;
    };
  const applyPrepare = uniqueRoleFunction(module, PARTY_APPLY_PREPARE_ROLE);
  const decodeSecond = uniqueRoleFunction(module, PARTY_DECODE_SECOND_ROLE);
  const semantic = {
    unlockResolver: uniqueRoleFunction(module, PARTY_CALLEE_ROLES.unlockResolver),
    attributeApply: uniqueRoleFunction(module, PARTY_CALLEE_ROLES.attributeApply),
    partyInfoRelease: uniqueRoleFunction(module, PARTY_CALLEE_ROLES.partyInfoRelease),
    attributeFinish: uniqueRoleFunction(module, PARTY_CALLEE_ROLES.attributeFinish),
    attributeBegin: uniqueRoleFunction(module, PARTY_CALLEE_ROLES.attributeBegin),
    attributeCommit: uniqueRoleFunction(module, PARTY_CALLEE_ROLES.attributeCommit),
    notifyDispatch: uniqueRoleFunction(module, PARTY_CALLEE_ROLES.notifyDispatch),
    releaseStorage: uniqueRoleFunction(module, PARTY_RELEASE_STORAGE_ROLE),
    first: uniqueRoleFunction(module, PARTY_LEAF_ROLES.first),
    second: uniqueRoleFunction(module, PARTY_LEAF_ROLES.second),
    third: uniqueRoleFunction(module, PARTY_LEAF_ROLES.third),
    sixth: uniqueRoleFunction(module, PARTY_LEAF_ROLES.sixth),
    finishFlush: uniqueRoleFunction(module, PARTY_LEAF_ROLES.finishFlush),
  } as const;
  if (applyPrepare === null || decodeSecond === null
    || Object.values(exact).some((value) => value === null)
    || Object.values(semantic).some((value) => value === null)) return null;
  const attributeDecode = observed.attributes[1];
  const partyFlagNotify = observed.partyFlagNotify;
  if (!bodyMatchesRole(functionBody(module, attributeDecode), PARTY_CALLEE_ROLES.attributeDecode)
    || !bodyMatchesRole(functionBody(module, partyFlagNotify), PARTY_CALLEE_ROLES.partyFlagNotify)) return null;

  const resolver = values(module, semantic.unlockResolver!, PARTY_CALLEE_ROLES.unlockResolver);
  const apply = values(module, semantic.attributeApply!, PARTY_CALLEE_ROLES.attributeApply);
  const release = values(module, semantic.partyInfoRelease!, PARTY_CALLEE_ROLES.partyInfoRelease);
  const finish = values(module, semantic.attributeFinish!, PARTY_CALLEE_ROLES.attributeFinish);
  const finishStateFunction = soleValue(finish, "finish.notify");
  if (!bodyMatchesRole(
    functionBody(module, finishStateFunction),
    PARTY_LEAF_ROLES.finishState,
  )) return null;
  const begin = values(module, semantic.attributeBegin!, PARTY_CALLEE_ROLES.attributeBegin);
  const decode = values(module, attributeDecode, PARTY_CALLEE_ROLES.attributeDecode);
  const decodeCopy = soleValue(decode, "decode.copy");
  const commit = values(module, semantic.attributeCommit!, PARTY_CALLEE_ROLES.attributeCommit);
  const notify = values(module, partyFlagNotify, PARTY_CALLEE_ROLES.partyFlagNotify);
  const dispatch = values(module, semantic.notifyDispatch!, PARTY_CALLEE_ROLES.notifyDispatch);
  const releaseStorage = values(module, semantic.releaseStorage!, PARTY_RELEASE_STORAGE_ROLE);
  const releaseStaticValues = RELEASE_STATIC_STARTS.map((_, index) =>
    soleValue(releaseStorage, `release.static-${index}`));
  const releaseBase = Math.min(...releaseStaticValues);
  const resolverSlot = soleValue(resolver, "resolver.slot");
  const finishState = soleValue(
    values(module, finishStateFunction, PARTY_LEAF_ROLES.finishState),
    "finish.state",
  );
  const { initializedDataEnd } = dataEvidence(module);

  if (
    observed.unlockResolver !== semantic.unlockResolver
    || observed.partyInfoRelease !== semantic.partyInfoRelease
    || observed.attributes[0] !== semantic.attributeApply
    || observed.attributes[2] !== semantic.attributeBegin
    || observed.attributes[3] !== semantic.attributeCommit
    || observed.attributes[4] !== semantic.attributeFinish
    || soleValue(resolver, "resolver.apply") !== semantic.attributeApply
    || soleValue(apply, "apply.prepare") !== applyPrepare
    || soleValue(apply, "apply.import") !== 1
    || soleValue(release, "release.storage") !== semantic.releaseStorage
    || soleValue(finish, "finish.notify") !== finishStateFunction
    || soleValue(finish, "finish.flush") !== semantic.finishFlush
    || soleValue(begin, "begin.apply") !== semantic.attributeApply
    || soleValue(begin, "begin.ui") !== uiDispatcher
    || soleValue(decode, "decode.first") !== exact.decodeFirst
    || soleValue(decode, "decode.second") !== decodeSecond
    || soleValue(decode, "decode.apply") !== semantic.attributeApply
    || !bodyMatchesRole(functionBody(module, decodeCopy), PARTY_DECODE_COPY_ROLE)
    || soleValue(decode, "decode.release") !== semantic.partyInfoRelease
    || soleValue(commit, "commit.resolve") !== semantic.unlockResolver
    || soleValue(commit, "commit.first") !== semantic.first
    || soleValue(commit, "commit.second") !== semantic.second
    || soleValue(commit, "commit.third") !== semantic.third
    || soleValue(commit, "commit.fourth") !== exact.commitFourth
    || soleValue(commit, "commit.fifth") !== exact.commitFifth
    || soleValue(commit, "commit.sixth") !== semantic.sixth
    || soleValue(notify, "notify.resolve") !== semantic.unlockResolver
    || soleValue(notify, "notify.dispatch") !== semantic.notifyDispatch
    || soleValue(dispatch, "notify.ui") !== uiDispatcher
    || releaseBase < initializedDataEnd || releaseBase % 4 !== 0
    || releaseStaticValues.some((value, index) =>
      value !== releaseBase + RELEASE_STATIC_DELTAS[index]!)
    || resolverSlot < initializedDataEnd || resolverSlot % 4 !== 0
    || finishState < initializedDataEnd || finishState % 4 !== 0
    || !immutableValuesMatch(module, apply, ["apply.error-a", "apply.error-b"])
    || !immutableValuesMatch(module, release, ["release.empty"])
    || !immutableValuesMatch(module, begin, ["begin.error-a", "begin.error-b"])
    || !immutableValuesMatch(module, decode, ["decode.error"])
    || !immutableValuesMatch(module, values(module, semantic.first!, PARTY_LEAF_ROLES.first), ["first.error", "first.empty"])
    || !immutableValuesMatch(module, values(module, semantic.second!, PARTY_LEAF_ROLES.second), ["second.error", "second.empty"])
    || !immutableValuesMatch(module, values(module, semantic.third!, PARTY_LEAF_ROLES.third), ["third.error", "third.empty"])
    || !immutableValuesMatch(module, values(module, semantic.sixth!, PARTY_LEAF_ROLES.sixth), ["sixth.error", "sixth.empty"])
    || !immutableValuesMatch(module, values(module, semantic.finishFlush!, PARTY_LEAF_ROLES.finishFlush), [
      "flush.assert-a", "flush.assert-b", "flush.assert-c", "flush.assert-d",
    ])
  ) return null;
  return Object.freeze({
    unlockResolver: semantic.unlockResolver!, attributeApply: semantic.attributeApply!,
    partyInfoRelease: semantic.partyInfoRelease!, attributeFinish: semantic.attributeFinish!,
    attributeBegin: semantic.attributeBegin!, attributeDecode,
    attributeCommit: semantic.attributeCommit!, partyFlagNotify,
  });
}
