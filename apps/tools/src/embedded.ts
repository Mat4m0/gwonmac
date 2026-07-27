import { createNativeHost } from "./host";
import { mountToolsApp as mount } from "./mount";

export { type ToolsAppHandle } from "./mount";

export function mountToolsApp(
  target: HTMLElement,
  options: {
    initiallyVisible?: boolean;
    onVisibilityChange?: (visible: boolean) => void;
  } = {},
) {
  return mount(target, {
    host: createNativeHost(window.gwNative),
    mode: "embedded",
    ...options,
  });
}
