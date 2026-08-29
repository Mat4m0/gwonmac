/// <reference types="vite/client" />
import type { LauncherNativeApi } from "@shared/launcher-contracts";

declare global {
  interface Window {
    launcherNative?: LauncherNativeApi;
  }
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}

export {};
