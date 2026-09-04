/**
 * Owns current-client semantic proof for controlled-player timed effects.
 * It refuses the capability unless every exact function role has one match.
 */
import {
  functionBodySha256,
  signatureMatches,
} from "./wasm-evidence.js";
import type { ModuleShape } from "./enhancement-evidence-types.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";

type PlayerEffectProof = NonNullable<
  KnownEnhancementBuild["playerEffectObservation"]
>;

type ExactRole = Readonly<{
  hash: string;
  bodyLength: number;
  params: readonly string[];
  results: readonly string[];
}>;

const ACCESSORS: readonly ExactRole[] = Object.freeze([
  { hash: "7df2376537653cac9b32172fb51073fa57503b1a2bcceb317a6d282d1e13fb0b", bodyLength: 30, params: ["i32", "i32", "i32", "i32", "i32"], results: [] },
  { hash: "18899c4be6bf2fd51f6dbf6e52241456cdaed94d912ed23f307c95917bf615b8", bodyLength: 24, params: ["i32", "i32"], results: [] },
  { hash: "1f2d462100add0c160d62265d2eaf292a00bfd1cde84c38c1e51f2aac0a2cc57", bodyLength: 30, params: ["i32", "i32", "i32", "i32", "i32"], results: [] },
  { hash: "a560a223d9756fc3579f057137601853ec23c2b6bbd57248216b77ce550d29af", bodyLength: 30, params: ["i32", "i32", "i32", "i32", "f32"], results: [] },
  { hash: "ecfa62c1bfaaebe98c2047ad986e137e9695a3cf2f0f7d5f6367b6e44cc10894", bodyLength: 28, params: ["i32", "i32", "i32", "f32"], results: [] },
  { hash: "3fecf883ff7543db3cfdd8f3d77fc5cf3ef1e78282252f4f3caedbbe4f80bac0", bodyLength: 24, params: ["i32", "i32"], results: [] },
]);
const ADD_TIMED: ExactRole = { hash: "fe97a736b61e83cc5ea5a84f38aecedd384476339c5b02594fcefeebc5ce5203", bodyLength: 758, params: ["i32", "i32", "i32", "i32", "i32", "f32"], results: [] };
const RENEW: ExactRole = { hash: "cafd172e56cbc1efcc64eb281fd8dadcfb6aa305eb4c165c0959f0903f98f769", bodyLength: 442, params: ["i32", "i32", "i32", "i32", "f32"], results: [] };
const REMOVE: ExactRole = { hash: "5e0ab6365510501ff760de8c3bdfb8682bf918e092d9263441d8fc7f56403533", bodyLength: 429, params: ["i32", "i32", "i32"], results: [] };
const TIMERS: readonly ExactRole[] = Object.freeze([
  { hash: "7340dbe70f3f4bf731d23f80882df99553e837f825d8bbebee7f8eac45d8ef58", bodyLength: 80, params: [], results: ["i32"] },
  { hash: "c1f93ac7e783305bff7d976dbf55365b67fa6696243305685aa1fb0fb7901030", bodyLength: 80, params: [], results: ["i32"] },
]);
const DIRTY_MESSAGES = Object.freeze([
  0x10000055, 0x10000056, 0x10000057, 0x10000141,
] as const);
const PLAYER_EFFECT_LAYOUT = Object.freeze({
  worldPartyEffects: 0x508,
  agentEffectsStride: 0x24,
  agentEffectsAgentId: 0,
  agentEffectsEffects: 0x14,
  effectStride: 0x18,
  effectSkillId: 0,
  effectAttributeLevel: 4,
  effectId: 8,
  effectMaintainerAgentId: 0x0c,
  effectDuration: 0x10,
  effectTimestamp: 0x14,
});

function index(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, position) => key === expected[position]);
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, position) => entry === expected[position]);
}

/** Strict boundary proof for the fixed semantic contract this locator owns. */
export function isPlayerEffectObservationProof(
  value: unknown,
): value is PlayerEffectProof {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<PlayerEffectProof>;
  if (!exactKeys(value, ["accessors", "mutations", "timer", "dirtyMessages", "layout"])
    || !Array.isArray(proof.accessors)
    || proof.accessors.length !== ACCESSORS.length
    || !proof.accessors.every((accessor, position) => {
      const role = ACCESSORS[position];
      return role !== undefined
        && accessor !== null
        && typeof accessor === "object"
        && exactKeys(accessor, ["functionIndex", "params", "results", "bodySha256"])
        && index(accessor.functionIndex)
        && accessor.bodySha256 === role.hash
        && sameStrings(accessor.params, role.params)
        && sameStrings(accessor.results, role.results);
    })) return false;
  const mutations = proof.mutations;
  const timer = proof.timer;
  return mutations !== undefined
    && exactKeys(mutations, ["addTimed", "renewTimed", "remove"])
    && exactKeys(mutations.addTimed, ["functionIndex", "bodySha256"])
    && index(mutations.addTimed.functionIndex)
    && mutations.addTimed.bodySha256 === ADD_TIMED.hash
    && exactKeys(mutations.renewTimed, ["functionIndex", "bodySha256"])
    && index(mutations.renewTimed.functionIndex)
    && mutations.renewTimed.bodySha256 === RENEW.hash
    && exactKeys(mutations.remove, ["functionIndex", "bodySha256"])
    && index(mutations.remove.functionIndex)
    && mutations.remove.bodySha256 === REMOVE.hash
    && timer !== undefined
    && exactKeys(timer, ["functionIndex", "params", "results", "bodySha256"])
    && index(timer.functionIndex)
    && sameStrings(timer.params, [])
    && sameStrings(timer.results, ["i32"])
    && TIMERS.some((role) => role.hash === timer.bodySha256)
    && Array.isArray(proof.dirtyMessages)
    && proof.dirtyMessages.length === DIRTY_MESSAGES.length
    && proof.dirtyMessages.every((message, position) =>
      message === DIRTY_MESSAGES[position])
    && proof.layout !== undefined
    && exactKeys(proof.layout, Object.keys(PLAYER_EFFECT_LAYOUT))
    && Object.entries(PLAYER_EFFECT_LAYOUT).every(([key, expected]) =>
      proof.layout?.[key as keyof typeof PLAYER_EFFECT_LAYOUT] === expected);
}

function scan(module: ModuleShape, roles: readonly ExactRole[]) {
  const indices = roles.map((): number[] => []);
  for (let index = module.functionImportCount; index < module.functionTypeIndices.length; index += 1) {
    const bodyLength = module.bodies[index - module.functionImportCount]?.byteLength;
    const matchingSignatures = roles.flatMap((role, roleIndex) =>
      bodyLength === role.bodyLength
        && signatureMatches(module, index, role.params, role.results) ? [roleIndex] : []);
    if (matchingSignatures.length === 0) continue;
    const hash = functionBodySha256(module, index);
    for (const roleIndex of matchingSignatures) {
      if (roles[roleIndex]?.hash === hash) indices[roleIndex]?.push(index);
    }
  }
  return Object.freeze(indices.map((matches) => Object.freeze(matches)));
}

export function playerEffectCandidateCounts(module: ModuleShape): readonly number[] {
  const fixed = scan(module, [...ACCESSORS, ADD_TIMED, RENEW, REMOVE]);
  const timer = new Set(scan(module, TIMERS).flat());
  return Object.freeze([...fixed.map((matches) => matches.length), timer.size]);
}

export function derivePlayerEffectObservation(
  module: ModuleShape,
): NonNullable<KnownEnhancementBuild["playerEffectObservation"]> | null {
  const roles = [...ACCESSORS, ADD_TIMED, RENEW, REMOVE] as const;
  const matches = scan(module, roles);
  if (matches.some((candidate) => candidate.length !== 1)) return null;
  const timerMatches = [...new Set(scan(module, TIMERS).flat())];
  if (timerMatches.length !== 1) return null;
  const located = matches.map((candidate) => candidate[0]!);
  const accessors = ACCESSORS.map((role, index) => [role, located[index]!] as const);
  const addTimed = located[ACCESSORS.length]!;
  const renewTimed = located[ACCESSORS.length + 1]!;
  const remove = located[ACCESSORS.length + 2]!;
  const timer = timerMatches[0]!;
  const timerHash = functionBodySha256(module, timer);
  return Object.freeze({
    accessors: Object.freeze(accessors.map(([role, functionIndex]) => Object.freeze({
      functionIndex, params: Object.freeze([...role.params]),
      results: Object.freeze([...role.results]), bodySha256: role.hash,
    }))),
    mutations: Object.freeze({
      addTimed: Object.freeze({ functionIndex: addTimed, bodySha256: ADD_TIMED.hash }),
      renewTimed: Object.freeze({ functionIndex: renewTimed, bodySha256: RENEW.hash }),
      remove: Object.freeze({ functionIndex: remove, bodySha256: REMOVE.hash }),
    }),
    timer: Object.freeze({ functionIndex: timer, params: [] as const, results: ["i32"] as const, bodySha256: timerHash }),
    dirtyMessages: DIRTY_MESSAGES,
    layout: PLAYER_EFFECT_LAYOUT,
  });
}
