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
] as const;

export type EnhancementProgram = (typeof ENHANCEMENT_PROGRAMS)[number];

export type EnhancementCapabilities = Readonly<{
  nativeCursor: boolean;
  targetObservation: boolean;
  partyObservation: boolean;
  commands: boolean;
}>;

export const ENHANCEMENT_CAPABILITY_PROFILES = Object.freeze({
  cursor: Object.freeze({
    nativeCursor: true,
    targetObservation: false,
    partyObservation: false,
    commands: false,
  }),
  target: Object.freeze({
    nativeCursor: false,
    targetObservation: true,
    partyObservation: false,
    commands: false,
  }),
  cursorTarget: Object.freeze({
    nativeCursor: true,
    targetObservation: true,
    partyObservation: false,
    commands: false,
  }),
  party: Object.freeze({
    nativeCursor: false,
    targetObservation: false,
    partyObservation: true,
    commands: false,
  }),
  cursorParty: Object.freeze({
    nativeCursor: true,
    targetObservation: false,
    partyObservation: true,
    commands: false,
  }),
  targetParty: Object.freeze({
    nativeCursor: false,
    targetObservation: true,
    partyObservation: true,
    commands: false,
  }),
  cursorTargetParty: Object.freeze({
    nativeCursor: true,
    targetObservation: true,
    partyObservation: true,
    commands: false,
  }),
  partyCommands: Object.freeze({
    nativeCursor: false,
    targetObservation: false,
    partyObservation: true,
    commands: true,
  }),
  cursorPartyCommands: Object.freeze({
    nativeCursor: true,
    targetObservation: false,
    partyObservation: true,
    commands: true,
  }),
  targetPartyCommands: Object.freeze({
    nativeCursor: false,
    targetObservation: true,
    partyObservation: true,
    commands: true,
  }),
  cursorTargetPartyCommands: Object.freeze({
    nativeCursor: true,
    targetObservation: true,
    partyObservation: true,
    commands: true,
  }),
} as const satisfies Readonly<Record<string, EnhancementCapabilities>>);

export type EnhancementCapabilityProfile =
  keyof typeof ENHANCEMENT_CAPABILITY_PROFILES;

const NONE: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  partyObservation: false,
  commands: false,
});

export function enhancementCapabilityProfile(
  capabilities: EnhancementCapabilities,
): EnhancementCapabilityProfile | null {
  for (const profile of Object.keys(ENHANCEMENT_CAPABILITY_PROFILES) as
    EnhancementCapabilityProfile[]) {
    const candidate = ENHANCEMENT_CAPABILITY_PROFILES[profile];
    if (
      candidate.nativeCursor === capabilities.nativeCursor
      && candidate.targetObservation === capabilities.targetObservation
      && candidate.partyObservation === capabilities.partyObservation
      && candidate.commands === capabilities.commands
    ) return profile;
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
export const ENHANCEMENT_TRANSFORM_ABI = 26;

export function enhancementConfigWordActive(
  capabilities: EnhancementCapabilities,
  index: number,
): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= ENHANCEMENT_CONFIG_WORD_COUNT) {
    return false;
  }
  const activation = ENHANCEMENT_CONFIG_FIELDS[index]?.activation;
  if (activation === "target") return capabilities.targetObservation;
  if (activation === "target-or-party") {
    return capabilities.targetObservation || capabilities.partyObservation;
  }
  if (activation === "cursor") return capabilities.nativeCursor;
  return activation === "party" && capabilities.partyObservation;
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
        ? ENHANCEMENT_CAPABILITY_PROFILES.cursorTargetPartyCommands
        : selection.nativeCursor
          ? ENHANCEMENT_CAPABILITY_PROFILES.cursor
          : NONE;
    case "cursor-observer": return ENHANCEMENT_CAPABILITY_PROFILES.cursor;
    case "target-observer": return ENHANCEMENT_CAPABILITY_PROFILES.target;
    case "toolbox-foundation": return ENHANCEMENT_CAPABILITY_PROFILES.party;
    case "toolbox-commands": return ENHANCEMENT_CAPABILITY_PROFILES.partyCommands;
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
    || capabilities.commands;
}

/** Commands consume live party identity, so no command-only profile is valid. */
export function validEnhancementCapabilities(
  capabilities: EnhancementCapabilities,
): boolean {
  return !capabilities.commands || capabilities.partyObservation;
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
    commands: requested.commands && supported.commands && partyObservation,
  });
}
