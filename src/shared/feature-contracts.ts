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
  | "targetReadout"
  | "teamManagement"
  | "xunlaiStorage"
  | "travelPalette"
  | "skillCooldownOverlayEnabled"
);
type ContentSetting = "skillKeyBindings";
type FeatureActivation =
  | Readonly<{ kind: "master"; setting: FeatureBooleanSetting }>
  | Readonly<{
      kind: "setting";
      setting: FeatureBooleanSetting;
      master: FeatureBooleanSetting;
    }>
  | Readonly<{
      kind: "configured-content";
      setting: ContentSetting;
      master: FeatureBooleanSetting;
    }>;

type FeatureSelectionPolicy = Readonly<{
  activation: FeatureActivation;
  region: "any" | "pve";
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
  tools: {
    activation: { kind: "master", setting: "gwonmacTools" },
    region: "any",
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
      setting: "teamManagement",
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
    // The storage controller owns the stronger, fresh access gate; this
    // selector therefore makes no region claim of its own.
    region: "any",
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
      kind: "configured-content",
      setting: "skillKeyBindings",
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
  FeatureBooleanSetting | ContentSetting
>;

export function featureActivationRequested(
  id: FeatureId,
  settings: FeatureActivationSettings,
): boolean {
  const activation = FEATURE_SELECTION_POLICIES[id].activation;
  if (activation.kind === "master") return settings[activation.setting];
  if (!settings[activation.master]) return false;
  if (activation.kind === "setting") return settings[activation.setting];
  return settings[activation.setting].some((value) => value !== null);
}

/**
 * Answers only the coarse region part of feature selection. Feature-owned
 * live-state gates remain authoritative for stronger access checks.
 */
export function featureRegionAllowsRequest(
  id: FeatureId,
  region: "pve" | "pvp" | "unknown",
): boolean {
  return FEATURE_SELECTION_POLICIES[id].region !== "pve" || region === "pve";
}
