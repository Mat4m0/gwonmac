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
} from "./enhancement-wasm-proof-context.js";
import type { ModuleShape, SemanticRole } from "./enhancement-evidence-types.js";

const span = (
  start: number,
  role: string,
  addressClass: "function-index" | "immutable-data" | "mutable-static",
) => Object.freeze({ start, end: start + 5, role, addressClass });

const CALLEE_ROLES = Object.freeze({
  unlockResolver: semanticRole(62, "36a7d7f3a6fabf5333e02b9aa8f24e0568d588e6cea93b7e0fa79db0caecaa68", [
    span(9, "resolver.slot", "mutable-static"), span(33, "resolver.apply", "function-index"),
    span(42, "resolver.slot", "mutable-static"),
  ], ["i32"], ["i32"]),
  attributeApply: semanticRole(114, "a8883a9e3931c54ac72993d107f08f8ed9631449a425dad63ad54ef0e6a873ad", [
    span(55, "apply.prepare", "function-index"), span(82, "apply.error-a", "immutable-data"),
    span(88, "apply.error-b", "immutable-data"), span(96, "apply.import", "function-index"),
  ], ["i32", "i32", "i32"], []),
  partyInfoRelease: semanticRole(24, "acd056753294c376b38435aba83bd8bfe11276b0ffd53e9ea9ab75f3bafd2444", [
    span(6, "release.empty", "immutable-data"), span(17, "release.storage", "function-index"),
  ], ["i32"], []),
  attributeFinish: semanticRole(76, "e4e61ee10c161858ab5a05ede4649e8a09649e4035327fd1a564e5e546443bb1", [
    span(49, "finish.notify", "function-index"), span(59, "finish.flush", "function-index"),
  ], ["i32", "i32", "i32"], []),
  attributeBegin: semanticRole(309, "461708dfb1cfba5d50983461087cadcb4b706fa16538ab66bd517add2a77ac53", [
    span(191, "begin.error-a", "immutable-data"), span(205, "begin.apply", "function-index"),
    span(229, "begin.error-b", "immutable-data"), span(243, "begin.apply", "function-index"),
    span(292, "begin.ui", "function-index"),
  ], ["i32", "i32"], []),
  attributeDecode: semanticRole(235, "d29313135d7a4120ee86dff7a2e463064a2ae857618567c5891851d6245239b8", [
    span(29, "decode.first", "function-index"), span(90, "decode.second", "function-index"),
    span(140, "decode.error", "immutable-data"), span(155, "decode.apply", "function-index"),
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
  notifyDispatch: semanticRole(1_054, "5234992743cc93ab20d3b162d0e35ecfc4b1622b85ba981f45331824d35089bc", [
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
const RELEASE_STORAGE_ROLE = semanticRole(
  1_988,
  "2958596503e4a6b9cd6cc220eb7b55e3330ea0e02c5afa22b2e60a516641c729",
  RELEASE_STATIC_STARTS.map((start, index) => span(start, `release.static-${index}`, "mutable-static")),
  ["i32"],
  [],
);

const LEAF_ROLES = Object.freeze({
  first: semanticRole(60, "91265b97d2ae0718d4b9668b966b30017c46ef68059776e6942ef5e274ef8c7b", [span(13, "first.error", "immutable-data"), span(50, "first.empty", "immutable-data")], ["i32"], ["i32"]),
  second: semanticRole(45, "77769d50a1726c9c451f0f38868104b9ae0fbc376d6ad26b3e45cda36a1edd09", [span(11, "second.error", "immutable-data"), span(39, "second.empty", "immutable-data")], ["i32"], ["i32"]),
  third: semanticRole(48, "1225201de145d830b27bbb2a6c820cc25c2e50b1e64476520c9436cfa1e9fbcd", [span(11, "third.error", "immutable-data"), span(38, "third.empty", "immutable-data")], ["i32"], ["i32"]),
  sixth: semanticRole(48, "b2985700fe8acbda202d211f6d9da186cb15a6c2cc91e101eb284ad48e64f0af", [span(11, "sixth.error", "immutable-data"), span(38, "sixth.empty", "immutable-data")], ["i32"], ["i32"]),
  finishState: semanticRole(11, "8e87304b020e158179c2a265fec3d2b82230104b60f1c55db6aaafe7ecfc7936", [span(5, "finish.state", "mutable-static")], [], ["i32"]),
  finishFlush: semanticRole(4_425, "fb5d7b8bf1f2aa5ffa8eb8b9af6a27151806ccea5ba03040945dbdf8f25d81b8", [
    span(115, "flush.assert-a", "immutable-data"), span(3_526, "flush.assert-b", "immutable-data"),
    span(4_198, "flush.assert-c", "immutable-data"), span(4_390, "flush.assert-d", "immutable-data"),
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

const EXACT_LEAVES = Object.freeze({
  applyPrepare: ["bdca14f409465ebefff3a6fd130733ea8abb37681d44d44adbef04dd7087d2b5", ["i32", "i32", "i32"], []],
  decodeFirst: ["b0ca60097a5aaaa6a371046a092ef3ad04a84b1f56ab6322e4e8b585beee721a", ["i32", "i32", "i32", "i32"], ["i32"]],
  decodeSecond: ["af19ccb5b9e9d862bf7029ab1a66e532a1c7af014657d05378ae6302fb7e4710", ["i32", "i32", "i32"], ["i32"]],
  decodeCopy: ["a6f6d28dae7bdd00b5cb1968256efecb6f18eea2e17fde5bca9235a9ffdd3ada", ["i32", "i32", "i32"], []],
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
  const semantic = {
    unlockResolver: uniqueRoleFunction(module, CALLEE_ROLES.unlockResolver),
    attributeApply: uniqueRoleFunction(module, CALLEE_ROLES.attributeApply),
    partyInfoRelease: uniqueRoleFunction(module, CALLEE_ROLES.partyInfoRelease),
    attributeFinish: uniqueRoleFunction(module, CALLEE_ROLES.attributeFinish),
    attributeBegin: uniqueRoleFunction(module, CALLEE_ROLES.attributeBegin),
    attributeCommit: uniqueRoleFunction(module, CALLEE_ROLES.attributeCommit),
    notifyDispatch: uniqueRoleFunction(module, CALLEE_ROLES.notifyDispatch),
    releaseStorage: uniqueRoleFunction(module, RELEASE_STORAGE_ROLE),
    first: uniqueRoleFunction(module, LEAF_ROLES.first),
    second: uniqueRoleFunction(module, LEAF_ROLES.second),
    third: uniqueRoleFunction(module, LEAF_ROLES.third),
    sixth: uniqueRoleFunction(module, LEAF_ROLES.sixth),
    finishFlush: uniqueRoleFunction(module, LEAF_ROLES.finishFlush),
  } as const;
  if (Object.values(exact).some((value) => value === null)
    || Object.values(semantic).some((value) => value === null)) return null;
  const attributeDecode = observed.attributes[1];
  const partyFlagNotify = observed.partyFlagNotify;
  if (!bodyMatchesRole(functionBody(module, attributeDecode), CALLEE_ROLES.attributeDecode)
    || !bodyMatchesRole(functionBody(module, partyFlagNotify), CALLEE_ROLES.partyFlagNotify)) return null;

  const resolver = values(module, semantic.unlockResolver!, CALLEE_ROLES.unlockResolver);
  const apply = values(module, semantic.attributeApply!, CALLEE_ROLES.attributeApply);
  const release = values(module, semantic.partyInfoRelease!, CALLEE_ROLES.partyInfoRelease);
  const finish = values(module, semantic.attributeFinish!, CALLEE_ROLES.attributeFinish);
  const finishStateFunction = soleValue(finish, "finish.notify");
  if (!bodyMatchesRole(
    functionBody(module, finishStateFunction),
    LEAF_ROLES.finishState,
  )) return null;
  const begin = values(module, semantic.attributeBegin!, CALLEE_ROLES.attributeBegin);
  const decode = values(module, attributeDecode, CALLEE_ROLES.attributeDecode);
  const commit = values(module, semantic.attributeCommit!, CALLEE_ROLES.attributeCommit);
  const notify = values(module, partyFlagNotify, CALLEE_ROLES.partyFlagNotify);
  const dispatch = values(module, semantic.notifyDispatch!, CALLEE_ROLES.notifyDispatch);
  const releaseStorage = values(module, semantic.releaseStorage!, RELEASE_STORAGE_ROLE);
  const releaseStaticValues = RELEASE_STATIC_STARTS.map((_, index) =>
    soleValue(releaseStorage, `release.static-${index}`));
  const releaseBase = Math.min(...releaseStaticValues);
  const resolverSlot = soleValue(resolver, "resolver.slot");
  const finishState = soleValue(
    values(module, finishStateFunction, LEAF_ROLES.finishState),
    "finish.state",
  );
  const initializedDataEnd = module.dataSegments.reduce(
    (highest, segment) => Math.max(highest, segment.base + segment.bytes.byteLength), 0,
  );

  if (
    observed.unlockResolver !== semantic.unlockResolver
    || observed.partyInfoRelease !== semantic.partyInfoRelease
    || observed.attributes[0] !== semantic.attributeApply
    || observed.attributes[2] !== semantic.attributeBegin
    || observed.attributes[3] !== semantic.attributeCommit
    || observed.attributes[4] !== semantic.attributeFinish
    || soleValue(resolver, "resolver.apply") !== semantic.attributeApply
    || soleValue(apply, "apply.prepare") !== exact.applyPrepare
    || soleValue(apply, "apply.import") !== 1
    || soleValue(release, "release.storage") !== semantic.releaseStorage
    || soleValue(finish, "finish.notify") !== finishStateFunction
    || soleValue(finish, "finish.flush") !== semantic.finishFlush
    || soleValue(begin, "begin.apply") !== semantic.attributeApply
    || soleValue(begin, "begin.ui") !== uiDispatcher
    || soleValue(decode, "decode.first") !== exact.decodeFirst
    || soleValue(decode, "decode.second") !== exact.decodeSecond
    || soleValue(decode, "decode.apply") !== semantic.attributeApply
    || soleValue(decode, "decode.copy") !== exact.decodeCopy
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
    || resolverSlot - releaseBase !== -3_305_024
    || finishState - releaseBase !== -55_084
    || !immutableValuesMatch(module, apply, ["apply.error-a", "apply.error-b"])
    || !immutableValuesMatch(module, release, ["release.empty"])
    || !immutableValuesMatch(module, begin, ["begin.error-a", "begin.error-b"])
    || !immutableValuesMatch(module, decode, ["decode.error"])
    || !immutableValuesMatch(module, values(module, semantic.first!, LEAF_ROLES.first), ["first.error", "first.empty"])
    || !immutableValuesMatch(module, values(module, semantic.second!, LEAF_ROLES.second), ["second.error", "second.empty"])
    || !immutableValuesMatch(module, values(module, semantic.third!, LEAF_ROLES.third), ["third.error", "third.empty"])
    || !immutableValuesMatch(module, values(module, semantic.sixth!, LEAF_ROLES.sixth), ["sixth.error", "sixth.empty"])
    || !immutableValuesMatch(module, values(module, semantic.finishFlush!, LEAF_ROLES.finishFlush), [
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
