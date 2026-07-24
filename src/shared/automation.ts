export const AUTOMATION_COMMAND = Object.freeze({
  startLevel1Capture: "diagnostics:start-level-1",
  stopCapture: "diagnostics:stop",
} as const);

export type AutomationCommand =
  (typeof AUTOMATION_COMMAND)[keyof typeof AUTOMATION_COMMAND];
