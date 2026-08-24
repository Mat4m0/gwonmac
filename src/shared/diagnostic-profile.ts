/**
 * The one policy table behind every restart-required graphics isolation mode.
 * A profile name is persisted intent; this is the effective behavior it means.
 */
import type { DiagnosticProfile } from "./contracts.js";

export interface DiagnosticProfilePolicy {
  readonly officialClient: boolean;
  readonly glOverrides: boolean;
  readonly presentationPath: "offscreen" | "direct";
}

const POLICIES = {
  standard: {
    officialClient: false,
    glOverrides: true,
    presentationPath: "offscreen",
  },
  "no-gl-overrides": {
    officialClient: false,
    glOverrides: false,
    presentationPath: "offscreen",
  },
  "official-baseline": {
    officialClient: true,
    glOverrides: false,
    presentationPath: "offscreen",
  },
  "direct-canvas": {
    officialClient: true,
    glOverrides: false,
    presentationPath: "direct",
  },
} as const satisfies Record<DiagnosticProfile, DiagnosticProfilePolicy>;

export function diagnosticProfilePolicy(
  profile: DiagnosticProfile,
): DiagnosticProfilePolicy {
  return POLICIES[profile];
}
