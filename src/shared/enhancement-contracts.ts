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

export type EnhancementCapabilities = Readonly<{
  nativeCursor: boolean;
  targetObservation: boolean;
  partyObservation: boolean;
  /** Team Apply packet authority. */
  teamApply: boolean;
  /** Travel message authority. */
  travelAction: boolean;
  /** Xunlai DataWindow authority. */
  xunlaiAction: boolean;
  /** Optional parser aliases; buttons and shortcuts remain independent. */
  chatAliases: boolean;
}>;

const LEGACY_CAPABILITY_PROFILES = Object.freeze({
  cursor: Object.freeze({
    nativeCursor: true,
    targetObservation: false,
    partyObservation: false,
    teamApply: false,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
  }),
  target: Object.freeze({
    nativeCursor: false,
    targetObservation: true,
    partyObservation: false,
    teamApply: false,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
  }),
  cursorTarget: Object.freeze({
    nativeCursor: true,
    targetObservation: true,
    partyObservation: false,
    teamApply: false,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
  }),
  party: Object.freeze({
    nativeCursor: false,
    targetObservation: false,
    partyObservation: true,
    teamApply: false,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
  }),
  cursorParty: Object.freeze({
    nativeCursor: true,
    targetObservation: false,
    partyObservation: true,
    teamApply: false,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
  }),
  targetParty: Object.freeze({
    nativeCursor: false,
    targetObservation: true,
    partyObservation: true,
    teamApply: false,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
  }),
  cursorTargetParty: Object.freeze({
    nativeCursor: true,
    targetObservation: true,
    partyObservation: true,
    teamApply: false,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
  }),
  partyCommands: Object.freeze({
    nativeCursor: false,
    targetObservation: false,
    partyObservation: true,
    teamApply: true,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
  }),
  cursorPartyCommands: Object.freeze({
    nativeCursor: true,
    targetObservation: false,
    partyObservation: true,
    teamApply: true,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
  }),
  targetPartyCommands: Object.freeze({
    nativeCursor: false,
    targetObservation: true,
    partyObservation: true,
    teamApply: true,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
  }),
  cursorTargetPartyCommands: Object.freeze({
    nativeCursor: true,
    targetObservation: true,
    partyObservation: true,
    teamApply: true,
    travelAction: false,
    xunlaiAction: false,
    chatAliases: false,
  }),
  storage: Object.freeze({
    nativeCursor: false,
    targetObservation: false,
    partyObservation: false,
    teamApply: false,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
  }),
  partyStorage: Object.freeze({
    nativeCursor: false,
    targetObservation: false,
    partyObservation: true,
    teamApply: false,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
  }),
  cursorPartyStorage: Object.freeze({
    nativeCursor: true,
    targetObservation: false,
    partyObservation: true,
    teamApply: false,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
  }),
  targetPartyStorage: Object.freeze({
    nativeCursor: false,
    targetObservation: true,
    partyObservation: true,
    teamApply: false,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
  }),
  cursorTargetPartyStorage: Object.freeze({
    nativeCursor: true,
    targetObservation: true,
    partyObservation: true,
    teamApply: false,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
  }),
  partyCommandsStorage: Object.freeze({
    nativeCursor: false,
    targetObservation: false,
    partyObservation: true,
    teamApply: true,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
  }),
  cursorPartyCommandsStorage: Object.freeze({
    nativeCursor: true,
    targetObservation: false,
    partyObservation: true,
    teamApply: true,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
  }),
  targetPartyCommandsStorage: Object.freeze({
    nativeCursor: false,
    targetObservation: true,
    partyObservation: true,
    teamApply: true,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
  }),
  cursorTargetPartyCommandsStorage: Object.freeze({
    nativeCursor: true,
    targetObservation: true,
    partyObservation: true,
    teamApply: true,
    travelAction: true,
    xunlaiAction: true,
    chatAliases: true,
  }),
} as const satisfies Readonly<Record<string, EnhancementCapabilities>>);

const CAPABILITY_FIELDS = Object.freeze([
  "nativeCursor",
  "targetObservation",
  "partyObservation",
  "teamApply",
  "travelAction",
  "xunlaiAction",
  "chatAliases",
] as const satisfies readonly (keyof EnhancementCapabilities)[]);

function sameCapabilities(
  left: EnhancementCapabilities,
  right: EnhancementCapabilities,
): boolean {
  return CAPABILITY_FIELDS.every((field) => left[field] === right[field]);
}

const generatedProfiles = Object.fromEntries(
  Array.from({ length: 1 << CAPABILITY_FIELDS.length }, (_, mask) => {
    const capabilities = Object.freeze(Object.fromEntries(
      CAPABILITY_FIELDS.map((field, index) => [field, (mask & (1 << index)) !== 0]),
    )) as EnhancementCapabilities;
    return [mask, capabilities] as const;
  })
    .filter(([mask, capabilities]) =>
      mask !== 0
      && validEnhancementCapabilities(capabilities)
      && !Object.values(LEGACY_CAPABILITY_PROFILES).some(
        (legacy) => sameCapabilities(legacy, capabilities),
      ))
    .map(([mask, capabilities]) => [`features-${mask.toString(16).padStart(2, "0")}`, capabilities]),
);

/** Every valid feature subset has one deterministic transform identity. */
export type EnhancementCapabilityProfile =
  | keyof typeof LEGACY_CAPABILITY_PROFILES
  | `features-${string}`;

export const ENHANCEMENT_CAPABILITY_PROFILES: typeof LEGACY_CAPABILITY_PROFILES
  & Readonly<Record<EnhancementCapabilityProfile, EnhancementCapabilities>> = Object.freeze({
  ...LEGACY_CAPABILITY_PROFILES,
  ...generatedProfiles,
});

export function enhancementCapabilitiesForProfile(
  profile: string,
): EnhancementCapabilities | null {
  return (ENHANCEMENT_CAPABILITY_PROFILES as Readonly<
    Record<string, EnhancementCapabilities | undefined>
  >)[profile] ?? null;
}

const NONE: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  partyObservation: false,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
});

export function enhancementCapabilityProfile(
  capabilities: EnhancementCapabilities,
): EnhancementCapabilityProfile | null {
  for (const profile of Object.keys(ENHANCEMENT_CAPABILITY_PROFILES) as
    EnhancementCapabilityProfile[]) {
    const candidate = enhancementCapabilitiesForProfile(profile);
    if (!candidate) continue;
    if (sameCapabilities(candidate, capabilities)) return profile;
  }
  return null;
}

import {
  ENHANCEMENT_CONFIG_FIELDS,
  ENHANCEMENT_CONFIG_WORD_COUNT,
} from "./enhancement-config.js";
export {
  ENHANCEMENT_CONFIG_WORD_COUNT,
  ENHANCEMENT_LAYOUT_WORD_COUNT,
  ENHANCEMENT_PARTY_DIRTY_MESSAGE_COUNT,
} from "./enhancement-config.js";
export const ENHANCEMENT_TRANSFORM_ABI = 36;

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
        ? ENHANCEMENT_CAPABILITY_PROFILES.cursorTargetPartyCommandsStorage
        : selection.nativeCursor
          ? ENHANCEMENT_CAPABILITY_PROFILES.cursor
          : NONE;
    case "cursor-observer": return ENHANCEMENT_CAPABILITY_PROFILES.cursor;
    case "target-observer": return ENHANCEMENT_CAPABILITY_PROFILES.target;
    case "toolbox-foundation": return ENHANCEMENT_CAPABILITY_PROFILES.party;
    case "toolbox-commands": return ENHANCEMENT_CAPABILITY_PROFILES.partyCommandsStorage;
    case "xunlai-storage": return ENHANCEMENT_CAPABILITY_PROFILES.storage;
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
  return capabilities.nativeCursor
    || capabilities.targetObservation
    || capabilities.partyObservation
    || capabilities.teamApply
    || capabilities.travelAction
    || capabilities.xunlaiAction
    || capabilities.chatAliases;
}

/** Team Apply alone requires the party observer; local actions do not. */
export function validEnhancementCapabilities(
  capabilities: EnhancementCapabilities,
): boolean {
  return !capabilities.teamApply || capabilities.partyObservation;
}

/** The exact requested subset that one build's optional certificate groups support. */
export function intersectEnhancementCapabilities(
  requested: EnhancementCapabilities,
  supported: EnhancementCapabilities,
): EnhancementCapabilities {
  const partyObservation = requested.partyObservation && supported.partyObservation;
  return Object.freeze({
    nativeCursor: requested.nativeCursor && supported.nativeCursor,
    targetObservation:
      requested.targetObservation && supported.targetObservation,
    partyObservation,
    teamApply: requested.teamApply && supported.teamApply && partyObservation,
    travelAction: requested.travelAction && supported.travelAction,
    xunlaiAction: requested.xunlaiAction && supported.xunlaiAction,
    chatAliases: requested.chatAliases && supported.chatAliases,
  });
}
