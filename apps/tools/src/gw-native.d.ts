import type {
  AppSettings,
  GwNativeApi,
} from "../../../src/shared/contracts";
import type { CustomUiTheme } from "../../../src/shared/ui-theme";

export type StandaloneAppearanceFixture = Readonly<{
  uiStyle: AppSettings["uiStyle"];
  uiPanelOpacity: AppSettings["uiPanelOpacity"];
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
  }
}

export {};
