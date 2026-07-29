import type { GwControlApi } from "../shared/contracts.js";

declare global {
  interface Window {
    readonly gwControl: GwControlApi;
  }
}

export {};
