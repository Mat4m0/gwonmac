import type { GwNativeApi } from "../../../src/shared/contracts";

declare global {
  interface Window {
    gwNative: GwNativeApi;
    /** Bounded, session-only evidence from the most recent failed Team Apply. */
    gwTeamApplyProbe?: unknown;
  }
}

export {};
