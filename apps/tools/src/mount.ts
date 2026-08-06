import { createApp, h, ref } from "vue";
import ToolsApp from "./ToolsApp.vue";
import {
  liveParty,
  type ToolboxObservation,
} from "../../../src/shared/builds/live-party";
import type { ToolsHost } from "./host";
import "./styles.css";

export type ToolsAppHandle = Readonly<{
  show(): void;
  hide(): void;
  toggle(): void;
  /**
   * The companion's latest projection of the running game, from the overlay.
   *
   * The raw observation crosses the boundary and is read into the domain here,
   * because this bundle is where the domain lives. The renderer side stays a
   * courier that never learns what a hero is.
   */
  update(observation: ToolboxObservation): void;
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
    update: (observation: ToolboxObservation) => {
      options.host.party.value = liveParty(observation);
    },
    dispose: () => app.unmount(),
  });
}
