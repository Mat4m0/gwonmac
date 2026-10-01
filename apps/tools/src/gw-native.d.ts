import type {
  AppSettings,
  GwNativeApi,
} from "../../../src/shared/contracts";
import type { CustomUiTheme } from "../../../src/shared/ui-theme";
import type { FixtureCanvasEvent } from "./hub-fixture";

export type StandaloneAppearanceFixture = Readonly<{
  uiStyle: AppSettings["uiStyle"];
  uiPanelOpacity: AppSettings["uiPanelOpacity"];
  uiTextSize?: AppSettings["uiTextSize"];
  uiFont?: AppSettings["uiFont"];
  uiCustomTheme?: CustomUiTheme;
}>;

declare global {
  interface Window {
    gwNative: GwNativeApi;
    /** Bounded, session-only evidence from the most recent failed Team Apply. */
    gwTeamApplyProbe?: unknown;
    /** Test-only bridge exposed by the standalone Vite workbench. */
    gwApplyFixtureAppearance?: (fixture: StandaloneAppearanceFixture) => void;
    /** Hub fixture only: every input event that reached the synthetic game canvas. */
    gwFixtureCanvas?: Readonly<{ events: readonly FixtureCanvasEvent[]; clear(): void }>;
    /** Hub fixture only: every recorded game or account action, oldest first. */
    gwFixtureActions?: readonly string[];
    /** Hub fixture only: renames the saved account "Second" for every later read. */
    gwFixtureAccounts?: Readonly<{ renameSecond(name: string): void }>;
  }
}

export {};
