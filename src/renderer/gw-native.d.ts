import type { GwNativeApi } from "../shared/contracts.js";

declare global {
  interface Window {
    readonly gwNative: GwNativeApi;
  }
}

export {};
