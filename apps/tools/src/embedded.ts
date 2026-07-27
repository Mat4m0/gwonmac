import { createNativeHost } from "./host";
import { mountToolsApp as mount } from "./mount";
import type { SkillDescriptionSource } from "./skill-catalog";

export { type ToolsAppHandle } from "./mount";

export function mountToolsApp(
  target: HTMLElement,
  options: {
    initiallyVisible?: boolean;
    onVisibilityChange?: (visible: boolean) => void;
    publishBuild: Parameters<typeof createNativeHost>[1];
    resolveSkillDescription: (
      source: SkillDescriptionSource,
    ) => Promise<string | null>;
  },
) {
  return mount(target, {
    host: createNativeHost(
      window.gwNative,
      options.publishBuild,
      options.resolveSkillDescription,
    ),
    mode: "embedded",
    ...options,
  });
}
