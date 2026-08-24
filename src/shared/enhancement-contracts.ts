/**
 * The closed Enhancement vocabulary shared by certification, launch policy,
 * preload and renderer. Keeping this separate prevents the general IPC
 * contract from becoming the accidental home of the transform ABI.
 */
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
] as const;

export type EnhancementProgram = (typeof ENHANCEMENT_PROGRAMS)[number];

/**
 * Profile-mask bit order. Reordering or inserting fields changes every profile
 * identity and requires an Enhancement transform ABI change.
 */
export const ENHANCEMENT_CAPABILITY_FIELDS = Object.freeze([
  "nativeCursor",
  "targetObservation",
  "partyObservation",
  "teamApply",
  "travelAction",
  "xunlaiAction",
  "chatAliases",
  "skillSlotGeometry",
  "skillCooldownObservation",
] as const);

export type EnhancementCapability = (typeof ENHANCEMENT_CAPABILITY_FIELDS)[number];
export type EnhancementCapabilities = Readonly<Record<EnhancementCapability, boolean>>;

const MAX_CAPABILITY_MASK = (1 << ENHANCEMENT_CAPABILITY_FIELDS.length) - 1;
const CAPABILITY_PROFILE = /^features-([0-9a-f]{2,3})$/;

/** A compact transform identity; the two hex digits are the eight capability bits. */
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
  cursor: capabilitiesFromMask(0x01),
  target: capabilitiesFromMask(0x02),
  party: capabilitiesFromMask(0x84),
  cursorParty: capabilitiesFromMask(0x85),
  storage: capabilitiesFromMask(0x70),
  partyCommandsStorage: capabilitiesFromMask(0xfc),
  all: capabilitiesFromMask(0x1ff),
});

import {
  ENHANCEMENT_CONFIG_FIELDS,
  ENHANCEMENT_CONFIG_WORD_COUNT,
} from "./enhancement-config.js";
export {
  ENHANCEMENT_CONFIG_WORD_COUNT,
  ENHANCEMENT_LAYOUT_WORD_COUNT,
  ENHANCEMENT_PARTY_DIRTY_MESSAGE_COUNT,
} from "./enhancement-config.js";
export const ENHANCEMENT_TRANSFORM_ABI = 40;

export function enhancementConfigWordActive(
  capabilities: EnhancementCapabilities,
  index: number,
): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= ENHANCEMENT_CONFIG_WORD_COUNT) {
    return false;
  }
  const owner = ENHANCEMENT_CONFIG_FIELDS[index]?.owner;
  if (owner === "target") {
    return capabilities.targetObservation;
  }
  if (owner === "observation") {
    return capabilities.targetObservation
      || capabilities.partyObservation
      || capabilities.xunlaiAction;
  }
  if (owner === "cursor") return capabilities.nativeCursor;
  if (owner === "party") return capabilities.partyObservation;
  if (owner === "skill-slots") return capabilities.skillSlotGeometry;
  if (owner === "skill-cooldown") return capabilities.skillCooldownObservation;
  return owner === "storage" && capabilities.xunlaiAction;
}

export type EnhancementHooks = Readonly<{
  tick: boolean;
  cursor: boolean;
  ui: boolean;
}>;

export function enhancementCapabilitiesFor(
  selection: EnhancementSelection,
  program: EnhancementProgram,
): EnhancementCapabilities {
  switch (program) {
    case "none":
      return selection.tools
        ? ENHANCEMENT_CAPABILITY_PRESETS.all
        : selection.nativeCursor
          ? ENHANCEMENT_CAPABILITY_PRESETS.cursor
          : NO_ENHANCEMENT_CAPABILITIES;
    case "cursor-observer": return ENHANCEMENT_CAPABILITY_PRESETS.cursor;
    case "target-observer": return ENHANCEMENT_CAPABILITY_PRESETS.target;
    case "toolbox-foundation": return ENHANCEMENT_CAPABILITY_PRESETS.party;
    case "toolbox-commands": return ENHANCEMENT_CAPABILITY_PRESETS.partyCommandsStorage;
    case "xunlai-storage": return ENHANCEMENT_CAPABILITY_PRESETS.storage;
  }
}

export function enhancementHooksFor(
  capabilities: EnhancementCapabilities,
): EnhancementHooks {
  return Object.freeze({
    tick: enhancementCapabilitiesRequested(capabilities),
    cursor: capabilities.nativeCursor,
    ui: capabilities.partyObservation,
  });
}

export function enhancementCapabilitiesRequested(
  capabilities: EnhancementCapabilities,
): boolean {
  return ENHANCEMENT_CAPABILITY_FIELDS.some((field) => capabilities[field]);
}

/** Team Apply alone requires the party observer; local actions do not. */
export function validEnhancementCapabilities(
  capabilities: EnhancementCapabilities,
): boolean {
  return (!capabilities.teamApply || capabilities.partyObservation)
    && (!capabilities.skillSlotGeometry || capabilities.partyObservation)
    && (!capabilities.skillCooldownObservation || capabilities.partyObservation)
    && (!capabilities.chatAliases
      || capabilities.travelAction
      || capabilities.xunlaiAction);
}

/** The exact requested subset that one build's optional certificate groups support. */
export function intersectEnhancementCapabilities(
  requested: EnhancementCapabilities,
  supported: EnhancementCapabilities,
): EnhancementCapabilities {
  const partyObservation = requested.partyObservation && supported.partyObservation;
  const travelAction = requested.travelAction && supported.travelAction;
  const xunlaiAction = requested.xunlaiAction && supported.xunlaiAction;
  return Object.freeze({
    nativeCursor: requested.nativeCursor && supported.nativeCursor,
    targetObservation:
      requested.targetObservation && supported.targetObservation,
    partyObservation,
    teamApply: requested.teamApply && supported.teamApply && partyObservation,
    travelAction,
    xunlaiAction,
    chatAliases: requested.chatAliases && supported.chatAliases
      && (travelAction || xunlaiAction),
    skillSlotGeometry: requested.skillSlotGeometry && supported.skillSlotGeometry
      && partyObservation,
    skillCooldownObservation: requested.skillCooldownObservation
      && supported.skillCooldownObservation && partyObservation,
  });
}
