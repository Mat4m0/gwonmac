import type { GwNativeApi } from "../../../src/shared/contracts";

declare global {
  interface Window {
    gwNative: GwNativeApi;
  }
}

export {};
