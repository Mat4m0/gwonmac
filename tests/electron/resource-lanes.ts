/**
 * Classification of Electron specs by host resource ownership.
 *
 * This inventory does not change execution. The suite stays serial until the
 * background-safe lane has proved stable enough to run separately.
 */

export const backgroundSafeElectronSpecs = [
  "a-launch-checks-github-once-unless-opted-out.spec.ts",
  "build-templates.spec.ts",
  "client-runtime-concurrency.spec.ts",
  "enhancement-cursor.spec.ts",
  "input-keyboard.spec.ts",
  "input-pointer.spec.ts",
  "input-text-repeat.spec.ts",
  "input-toolbox.spec.ts",
  "input-travel.spec.ts",
  "launcher.spec.ts",
  "sandbox.spec.ts",
  "settings-memory.spec.ts",
  "settings-tools-updates.spec.ts",
  "webgate.spec.ts",
] as const;

export type DesktopResource =
  | "default-electron-profile"
  | "fixed-port-6112"
  | "foreground-focus"
  | "fullscreen"
  | "live-client-and-gpu"
  | "multi-window"
  | "pointer-lock"
  | "single-instance"
  | "system-clipboard";

interface DesktopExclusiveElectronSpec {
  readonly file: string;
  readonly resources: readonly DesktopResource[];
  readonly reason: string;
}

export const desktopExclusiveElectronSpecs = [
  {
    file: "app.spec.ts",
    resources: [
      "single-instance",
      "fixed-port-6112",
      "foreground-focus",
      "fullscreen",
    ],
    reason:
      "Exercises the application instance lock, binds the fixed game port, and restores a focused fullscreen window.",
  },
  {
    file: "client-compatibility.spec.ts",
    resources: ["fixed-port-6112"],
    reason: "Binds the fixed game port while it proves the real socket boundary.",
  },
  {
    file: "diagnostics-ownership.spec.ts",
    resources: ["multi-window"],
    reason:
      "Creates a second registered game window while it proves capture ownership and trace refusal.",
  },
  {
    file: "diagnostics.spec.ts",
    resources: ["multi-window"],
    reason:
      "Creates and crashes additional BrowserWindows while it proves renderer-command cleanup.",
  },
  {
    file: "input-camera.spec.ts",
    resources: ["foreground-focus", "pointer-lock"],
    reason:
      "Takes foreground macOS focus and requests real pointer lock for the game canvas.",
  },
  {
    file: "input-clipboard.spec.ts",
    resources: ["system-clipboard"],
    reason:
      "Reads and writes the shared macOS clipboard while it drives native editing commands.",
  },
  {
    file: "input-trace.spec.ts",
    resources: ["system-clipboard"],
    reason:
      "Copies the rendered trace through the shared macOS clipboard.",
  },
  {
    file: "live.spec.ts",
    resources: ["live-client-and-gpu"],
    reason:
      "Uses the live ArenaNet client and host GPU instead of an isolated offline fixture.",
  },
  {
    file: "local-client-verifier.spec.ts",
    resources: ["default-electron-profile"],
    reason:
      "Launches isolated verifier processes without an explicit user-data directory, so Electron's default profile remains shared.",
  },
  {
    file: "multiple-accounts.spec.ts",
    resources: ["foreground-focus", "multi-window"],
    reason:
      "Takes foreground focus and coordinates the Hub with several profile BrowserWindows.",
  },
  {
    file: "settings-data-display.spec.ts",
    resources: ["foreground-focus"],
    reason:
      "Takes foreground macOS focus to assert document focus and keyboard navigation.",
  },
  {
    file: "steam-acquire.spec.ts",
    resources: ["multi-window"],
    reason:
      "Creates, contains, crashes, and closes a modal Steam sign-in BrowserWindow.",
  },
  {
    file: "steam-login.spec.ts",
    resources: ["multi-window"],
    reason:
      "Coordinates the game window with the real Steam credential BrowserWindow boundary.",
  },
] as const satisfies readonly DesktopExclusiveElectronSpec[];
