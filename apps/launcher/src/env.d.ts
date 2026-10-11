/// <reference types="vite/client" />
import type { LauncherNativeApi, SettingsNativeApi } from "@shared/launcher-contracts";

declare global {
  interface Window {
    launcherNative?: LauncherNativeApi;
    settingsNative?: SettingsNativeApi;
  }
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}

export {};
