import { createNativeHost } from "./host";
import { mountToolsApp as mount } from "./mount";
import { createNativeTravelHost } from "./travel-host";
import { mountTravelPalette as mountTravel } from "./travel-mount";
import type { TravelCommand } from "../../../src/shared/travel-command";

export { type ToolsAppHandle } from "./mount";

export function mountToolsApp(
  target: HTMLElement,
  options: {
    initiallyVisible?: boolean;
    onVisibilityChange?: (visible: boolean) => void;
    publishTemplate: Parameters<typeof createNativeHost>[1];
    commands: Parameters<typeof createNativeHost>[2];
    storage: Parameters<typeof createNativeHost>[3];
    applyUnavailable: Parameters<typeof createNativeHost>[4];
    observationUnavailable: string | null;
    development: boolean;
  },
) {
  return mount(target, {
    host: createNativeHost(
      window.gwNative,
      options.publishTemplate,
      options.commands,
      options.storage,
      options.applyUnavailable,
      options.development,
      options.observationUnavailable,
    ),
    mode: "embedded",
    ...options,
  });
}

export function mountTravelPalette(
  target: HTMLElement,
  options: {
    command: TravelCommand;
    development: boolean;
    initiallyVisible?: boolean;
    onVisibilityChange?: (visible: boolean) => void;
  },
) {
  return mountTravel(target, {
    ...options,
    host: createNativeTravelHost(window.gwNative, options.command, options.development),
  });
}
