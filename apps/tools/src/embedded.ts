import { createNativeHost } from "./host";
import { mountToolsApp as mount } from "./mount";

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
