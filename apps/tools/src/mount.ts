import { createApp, h, ref } from "vue";
import ToolsApp from "./ToolsApp.vue";
import type { ToolsHost } from "./host";
import "./styles.css";

export type ToolsAppHandle = Readonly<{
  show(): void;
  hide(): void;
  toggle(): void;
  dispose(): void;
}>;

export function mountToolsApp(
  target: HTMLElement,
  options: {
    host: ToolsHost;
    mode: "standalone" | "embedded";
    initiallyVisible?: boolean;
    onVisibilityChange?: (visible: boolean) => void;
  },
): ToolsAppHandle {
  const visible = ref(options.initiallyVisible ?? options.mode === "standalone");
  const setVisible = (next: boolean) => {
    visible.value = next;
    options.onVisibilityChange?.(next);
  };
  const app = createApp({
    setup() {
      return () =>
        h(ToolsApp, {
          host: options.host,
          mode: options.mode,
          visible: visible.value,
          onClose: () => setVisible(false),
          onReady: () => {
            target.dataset.ready = "true";
          },
        });
    },
  });
  app.mount(target);
  return Object.freeze({
    show: () => setVisible(true),
    hide: () => setVisible(false),
    toggle: () => setVisible(!visible.value),
    dispose: () => app.unmount(),
  });
}
