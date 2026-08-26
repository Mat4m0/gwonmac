/**
 * The closed Enhancement vocabulary shared by certification, launch policy,
 * preload and renderer. Keeping this separate prevents the general IPC
 * contract from becoming the accidental home of the transform ABI.
 */
import {
  ENHANCEMENT_CONFIG_FIELDS,
  ENHANCEMENT_CONFIG_WORD_COUNT,
  type EnhancementConfigOwner,
} from "./enhancement-config.js";

export const ENHANCEMENTS = ["nativeCursor", "tools"] as const;

export type Enhancement = (typeof ENHANCEMENTS)[number];
export type EnhancementSelection = Record<Enhancement, boolean>;

export const ENHANCEMENT_PROGRAMS = [
  "none",
  "cursor-observer",
  "target-observer",
  "toolbox-foundation",
  "toolbox-commands",
  "xunlai-storage",
  "reconnect-probe",
] as const;

export type EnhancementProgram = (typeof ENHANCEMENT_PROGRAMS)[number];

type EnhancementHook = "cursor" | "ui";

/**
 * Compile-time capability registry and profile-mask bit order. Reordering or
 * inserting entries changes every profile identity and requires an Enhancement
 * transform ABI change. Dependencies describe proof/runtime requirements; they
 * never select addresses or dynamically install code.
 */
const CAPABILITY_DEFINITIONS = Object.freeze([
  {
    id: "nativeCursor",
    requiresAll: [],
    requiresAny: [],
    configOwners: ["cursor"],
    hooks: ["cursor"],
  },
  {
    id: "targetObservation",
    requiresAll: ["playRegionObservation"],
    requiresAny: [],
    configOwners: ["observation", "target"],
    hooks: [],
  },
  {
    id: "partyObservation",
    requiresAll: ["playRegionObservation"],
    requiresAny: [],
    configOwners: [
      "observation", "party", "player-skillbar", "party-skillbar",
    ],
    hooks: ["ui"],
  },
  {
    id: "teamApply",
    requiresAll: ["partyObservation"],
    requiresAny: [],
    configOwners: [],
    hooks: [],
  },
  {
    id: "travelAction",
    requiresAll: ["playRegionObservation"],
    requiresAny: [],
    configOwners: ["observation", "travel"],
    hooks: [],
  },
  {
    id: "xunlaiAction",
    requiresAll: ["playRegionObservation"],
    requiresAny: [],
    configOwners: ["observation", "storage"],
    hooks: [],
  },
  {
    id: "chatAliases",
    requiresAll: [],
    requiresAny: ["travelAction", "xunlaiAction"],
    configOwners: [],
    hooks: [],
  },
  {
    id: "skillSlotGeometry",
    requiresAll: ["playRegionObservation"],
    requiresAny: [],
    configOwners: ["skill-slots"],
    hooks: [],
  },
  {
    id: "skillCooldownObservation",
    requiresAll: ["playRegionObservation"],
    requiresAny: [],
    configOwners: ["observation", "player-skillbar", "skill-cooldown"],
    hooks: [],
  },
  {
    id: "playRegionObservation",
    requiresAll: [],
    requiresAny: [],
    configOwners: ["play-region"],
    hooks: [],
  },
  {
    // Core reload automation observes only five exact native frames and
    // publishes a closed pre-game state. It deliberately has no generic UI
    // hook or frame command surface.
    id: "preGameControls",
    requiresAll: ["playRegionObservation"],
    requiresAny: [],
    configOwners: [],
    hooks: [],
  },
] as const);
for (const contract of CAPABILITY_DEFINITIONS) {
  Object.freeze(contract.requiresAll);
  Object.freeze(contract.requiresAny);
  Object.freeze(contract.configOwners);
  Object.freeze(contract.hooks);
  Object.freeze(contract);
}

export type EnhancementCapability = (typeof CAPABILITY_DEFINITIONS)[number]["id"];
export type EnhancementCapabilityContract = Readonly<{
  id: EnhancementCapability;
  requiresAll: readonly EnhancementCapability[];
  requiresAny: readonly EnhancementCapability[];
  configOwners: readonly EnhancementConfigOwner[];
  hooks: readonly EnhancementHook[];
}>;
export const ENHANCEMENT_CAPABILITY_CONTRACTS:
readonly EnhancementCapabilityContract[] = CAPABILITY_DEFINITIONS;
export const ENHANCEMENT_CAPABILITY_FIELDS = Object.freeze(
  CAPABILITY_DEFINITIONS.map(({ id }) => id),
);
export type EnhancementCapabilities = Readonly<Record<EnhancementCapability, boolean>>;

const MAX_CAPABILITY_MASK = (1 << ENHANCEMENT_CAPABILITY_FIELDS.length) - 1;
const CAPABILITY_PROFILE = /^features-([0-9a-f]{2,3})$/;

/** A compact transform identity whose hex mask follows the registry order. */
export type EnhancementCapabilityProfile = `features-${string}`;

function capabilitiesFromMask(mask: number): EnhancementCapabilities {
  return Object.freeze(Object.fromEntries(
    ENHANCEMENT_CAPABILITY_FIELDS.map(
      (field, index) => [field, (mask & (1 << index)) !== 0],
    ),
  )) as EnhancementCapabilities;
}

function capabilityMask(capabilities: EnhancementCapabilities): number | null {
  let mask = 0;
  for (let index = 0; index < ENHANCEMENT_CAPABILITY_FIELDS.length; index += 1) {
    const enabled = capabilities[ENHANCEMENT_CAPABILITY_FIELDS[index]!];
    if (typeof enabled !== "boolean") return null;
    if (enabled) mask |= 1 << index;
  }
  return mask !== 0 && validEnhancementCapabilities(capabilities) ? mask : null;
}

export function enhancementCapabilitiesForProfile(
  profile: string,
): EnhancementCapabilities | null {
  const matched = CAPABILITY_PROFILE.exec(profile);
  if (!matched) return null;
  const mask = Number.parseInt(matched[1]!, 16);
  if (mask === 0 || mask > MAX_CAPABILITY_MASK) return null;
  const capabilities = capabilitiesFromMask(mask);
  return validEnhancementCapabilities(capabilities) ? capabilities : null;
}

/** True when every requested capability is present in the available set. */
export function enhancementCapabilitiesCover(
  available: EnhancementCapabilities,
  requested: EnhancementCapabilities,
): boolean {
  return ENHANCEMENT_CAPABILITY_FIELDS.every(
    (field) => !requested[field] || available[field],
  );
}

export function isEnhancementCapabilityProfile(
  value: unknown,
): value is EnhancementCapabilityProfile {
  return typeof value === "string"
    && enhancementCapabilitiesForProfile(value) !== null;
}

export const NO_ENHANCEMENT_CAPABILITIES: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  partyObservation: false,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
  playRegionObservation: false,
  preGameControls: false,
});

function isExactBooleanRecord<Key extends string>(
  value: unknown,
  keys: readonly Key[],
): value is Readonly<Record<Key, boolean>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return actual.length === keys.length
    && keys.every(
      (key) => Object.hasOwn(record, key) && typeof record[key] === "boolean",
    );
}

export function parseEnhancementCapabilities(
  value: unknown,
): EnhancementCapabilities | null {
  if (!isExactBooleanRecord(value, ENHANCEMENT_CAPABILITY_FIELDS)) {
    return null;
  }
  return Object.freeze({
    nativeCursor: value.nativeCursor,
    targetObservation: value.targetObservation,
    partyObservation: value.partyObservation,
    teamApply: value.teamApply,
    travelAction: value.travelAction,
    xunlaiAction: value.xunlaiAction,
    chatAliases: value.chatAliases,
    skillSlotGeometry: value.skillSlotGeometry,
    skillCooldownObservation: value.skillCooldownObservation,
    playRegionObservation: value.playRegionObservation,
    preGameControls: value.preGameControls,
  });
}

export function sameEnhancementCapabilities(
  left: EnhancementCapabilities,
  right: EnhancementCapabilities,
): boolean {
  return ENHANCEMENT_CAPABILITY_FIELDS.every(
    (field) => left[field] === right[field],
  );
}

export function enhancementCapabilityProfile(
  capabilities: EnhancementCapabilities,
): EnhancementCapabilityProfile | null {
  const mask = capabilityMask(capabilities);
  return mask === null
    ? null
    : `features-${mask.toString(16).padStart(2, "0")}`;
}

/** Named product/developer choices. Certificates and caches use only bit identities. */
export const ENHANCEMENT_CAPABILITY_PRESETS = Object.freeze({
  cursor: capabilitiesFromMask(0x001),
  core: capabilitiesFromMask(0x601),
  reconnect: capabilitiesFromMask(0x601),
  region: capabilitiesFromMask(0x200),
  target: capabilitiesFromMask(0x202),
  party: capabilitiesFromMask(0x284),
  cursorParty: capabilitiesFromMask(0x285),
  storage: capabilitiesFromMask(0x270),
  partyCommandsStorage: capabilitiesFromMask(0x2fc),
  all: capabilitiesFromMask(0x7ff),
});

export {
  ENHANCEMENT_CONFIG_WORD_COUNT,
  ENHANCEMENT_LAYOUT_WORD_COUNT,
  ENHANCEMENT_PARTY_DIRTY_MESSAGE_COUNT,
} from "./enhancement-config.js";
export const ENHANCEMENT_TRANSFORM_ABI = 46;

export function enhancementConfigWordActive(
  capabilities: EnhancementCapabilities,
  index: number,
): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= ENHANCEMENT_CONFIG_WORD_COUNT) {
    return false;
  }
  const owner = ENHANCEMENT_CONFIG_FIELDS[index]?.owner;
  return owner !== undefined && ENHANCEMENT_CAPABILITY_CONTRACTS.some(
    (contract) => capabilities[contract.id]
      && contract.configOwners.includes(owner),
  );
}

export type EnhancementHooks = Readonly<
  { tick: boolean } & Record<EnhancementHook, boolean>
>;

export function enhancementCapabilitiesFor(
  selection: EnhancementSelection,
  program: EnhancementProgram,
): EnhancementCapabilities {
  switch (program) {
    case "none":
      return selection.tools
        ? ENHANCEMENT_CAPABILITY_PRESETS.all
        : selection.nativeCursor
          ? ENHANCEMENT_CAPABILITY_PRESETS.core
          : NO_ENHANCEMENT_CAPABILITIES;
    case "cursor-observer": return ENHANCEMENT_CAPABILITY_PRESETS.cursor;
    case "target-observer": return ENHANCEMENT_CAPABILITY_PRESETS.target;
    case "toolbox-foundation": return ENHANCEMENT_CAPABILITY_PRESETS.party;
    case "toolbox-commands": return ENHANCEMENT_CAPABILITY_PRESETS.partyCommandsStorage;
    case "xunlai-storage": return ENHANCEMENT_CAPABILITY_PRESETS.storage;
    // The reload probe needs the same bounded pre-game and play-region readers
    // that required Core installs in production.
    case "reconnect-probe": return ENHANCEMENT_CAPABILITY_PRESETS.reconnect;
  }
}

export function enhancementHooksFor(
  capabilities: EnhancementCapabilities,
): EnhancementHooks {
  return Object.freeze({
    tick: enhancementCapabilitiesRequested(capabilities),
    cursor: ENHANCEMENT_CAPABILITY_CONTRACTS.some(
      (contract) => capabilities[contract.id] && contract.hooks.includes("cursor"),
    ),
    ui: ENHANCEMENT_CAPABILITY_CONTRACTS.some(
      (contract) => capabilities[contract.id] && contract.hooks.includes("ui"),
    ),
  });
}

export function enhancementCapabilitiesRequested(
  capabilities: EnhancementCapabilities,
): boolean {
  return ENHANCEMENT_CAPABILITY_FIELDS.some((field) => capabilities[field]);
}

function capabilityDependenciesSatisfied(
  contract: EnhancementCapabilityContract,
  capabilities: EnhancementCapabilities,
): boolean {
  return contract.requiresAll.every((dependency) => capabilities[dependency])
    && (
      contract.requiresAny.length === 0
      || contract.requiresAny.some((dependency) => capabilities[dependency])
    );
}

/** Every enabled capability must carry the dependencies in its contract. */
export function validEnhancementCapabilities(
  capabilities: EnhancementCapabilities,
): boolean {
  return ENHANCEMENT_CAPABILITY_CONTRACTS.every(
    (contract) => !capabilities[contract.id]
      || capabilityDependenciesSatisfied(contract, capabilities),
  );
}

/** The exact requested subset that one build's optional certificate groups support. */
export function intersectEnhancementCapabilities(
  requested: EnhancementCapabilities,
  supported: EnhancementCapabilities,
): EnhancementCapabilities {
  const enabled = Object.fromEntries(ENHANCEMENT_CAPABILITY_FIELDS.map(
    (field) => [field, requested[field] && supported[field]],
  )) as Record<EnhancementCapability, boolean>;
  let changed = true;
  while (changed) {
    changed = false;
    for (const contract of ENHANCEMENT_CAPABILITY_CONTRACTS) {
      if (enabled[contract.id] && !capabilityDependenciesSatisfied(contract, enabled)) {
        enabled[contract.id] = false;
        changed = true;
      }
    }
  }
  return Object.freeze(enabled);
}
