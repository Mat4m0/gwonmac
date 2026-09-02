/**
 * Static product-feature selection policy.
 *
 * This registry centralizes only policy that it actively enforces. Native
 * capabilities and lifecycle behavior stay in their owning modules until a
 * coordinator can consume those contracts directly.
 */
import type { AppSettings } from "./contracts.js";

type BooleanSetting = {
  [Key in keyof AppSettings]: AppSettings[Key] extends boolean ? Key : never
}[keyof AppSettings];
type FeatureBooleanSetting = BooleanSetting & (
  | "gwonmacTools"
  | "buildLibrary"
  | "tradeChat"
  | "targetReadout"
  | "xunlaiStorage"
  | "travelPalette"
  | "skillKeyLabelsEnabled"
  | "skillCooldownOverlayEnabled"
  | "cartographyEnabled"
  | "characterSwitchEnabled"
);
type FeatureActivation =
  | Readonly<{ kind: "master"; setting: FeatureBooleanSetting }>
  | Readonly<{ kind: "independent"; setting: FeatureBooleanSetting }>
  | Readonly<{
      kind: "setting";
      setting: FeatureBooleanSetting;
      master: FeatureBooleanSetting;
    }>;

type FeatureSelectionPolicy = Readonly<{
  activation: FeatureActivation;
  region: "any" | "non-pvp" | "pve";
}>;

function defineFeatureSelectionPolicies<
  const Registry extends Record<string, FeatureSelectionPolicy>,
>(registry: Registry): Readonly<{
  readonly [Id in keyof Registry]: FeatureSelectionPolicy;
}> {
  for (const policy of Object.values(registry)) {
    Object.freeze(policy.activation);
    Object.freeze(policy);
  }
  return Object.freeze(registry);
}

export const FEATURE_SELECTION_POLICIES = defineFeatureSelectionPolicies({
  characterSwitch: {
    activation: { kind: "independent", setting: "characterSwitchEnabled" },
    region: "any",
  },
  cartography: {
    activation: { kind: "setting", setting: "cartographyEnabled", master: "gwonmacTools" },
    region: "pve",
  },
  tools: {
    activation: { kind: "master", setting: "gwonmacTools" },
    region: "non-pvp",
  },
  buildLibrary: {
    activation: {
      kind: "setting",
      setting: "buildLibrary",
      master: "gwonmacTools",
    },
    region: "non-pvp",
  },
  tradeChat: {
    activation: {
      kind: "setting",
      setting: "tradeChat",
      master: "gwonmacTools",
    },
    region: "non-pvp",
  },
  targetReadout: {
    activation: {
      kind: "setting",
      setting: "targetReadout",
      master: "gwonmacTools",
    },
    region: "pve",
  },
  teamApply: {
    activation: {
      kind: "setting",
      setting: "buildLibrary",
      master: "gwonmacTools",
    },
    region: "pve",
  },
  xunlaiStorage: {
    activation: {
      kind: "setting",
      setting: "xunlaiStorage",
      master: "gwonmacTools",
    },
    // The storage controller still owns the stronger, fresh access gate.
    // This coarse rule withdraws the complete feature during active PvP play.
    region: "non-pvp",
  },
  travel: {
    activation: {
      kind: "setting",
      setting: "travelPalette",
      master: "gwonmacTools",
    },
    region: "pve",
  },
  skillKeyLabels: {
    activation: {
      kind: "setting",
      setting: "skillKeyLabelsEnabled",
      master: "gwonmacTools",
    },
    region: "pve",
  },
  skillCooldowns: {
    activation: {
      kind: "setting",
      setting: "skillCooldownOverlayEnabled",
      master: "gwonmacTools",
    },
    region: "pve",
  },
});

export type FeatureId = keyof typeof FEATURE_SELECTION_POLICIES;
export type FeatureActivationSettings = Pick<
  AppSettings,
  FeatureBooleanSetting
>;

export function featureActivationRequested(
  id: FeatureId,
  settings: Partial<FeatureActivationSettings>,
): boolean {
  const activation = FEATURE_SELECTION_POLICIES[id].activation;
  if (activation.kind !== "setting") return settings[activation.setting] === true;
  if (!settings[activation.master]) return false;
  return settings[activation.setting] === true;
}

/**
 * Answers only the coarse region part of feature selection. Feature-owned
 * live-state gates remain authoritative for stronger access checks.
 */
export function featureRegionAllowsRequest(
  id: FeatureId,
  region: "pve" | "pvp" | "unknown",
): boolean {
  const policy = FEATURE_SELECTION_POLICIES[id].region;
  if (policy === "any") return true;
  if (policy === "non-pvp") return region !== "pvp";
  return region === "pve";
}
