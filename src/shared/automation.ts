/**
 * The closed set of commands the developer automation harness may issue.
 *
 * Two capture controls and nothing else. The list is a union rather than an
 * open string so an automation build cannot reach a capability by naming it,
 * and it lives in `shared` because both sides of the harness must agree on the
 * spelling — not because the surface is meant to grow.
 */
export const AUTOMATION_COMMAND = Object.freeze({
  startLevel1Capture: "diagnostics:start-level-1",
  stopCapture: "diagnostics:stop",
} as const);

export type AutomationCommand =
  (typeof AUTOMATION_COMMAND)[keyof typeof AUTOMATION_COMMAND];
