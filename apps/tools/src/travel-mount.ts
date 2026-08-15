/** Mounts the Vue Travel palette and exposes its small lifecycle to the renderer. */
import { createApp, h, ref } from "vue";
import type { TravelGameState } from "../../../src/shared/travel-command";
import TravelPalette from "./components/TravelPalette.vue";
import type { TravelHost } from "./travel-host";

export type TravelPaletteHandle = Readonly<{
  show(): void;
  hide(): void;
  toggle(): void;
  update(state: TravelGameState): void;
  dispose(): void;
}>;

export function mountTravelPalette(
  target: HTMLElement,
  options: {
    host: TravelHost;
    initiallyVisible?: boolean;
    onVisibilityChange?: (visible: boolean) => void;
  },
): TravelPaletteHandle {
  const visible = ref(options.initiallyVisible ?? false);
  const setVisible = (next: boolean) => {
    if (visible.value === next) return;
    visible.value = next;
    options.onVisibilityChange?.(next);
  };
  const app = createApp({
    setup: () => () => h(TravelPalette, {
      host: options.host,
      visible: visible.value,
      onClose: () => setVisible(false),
    }),
  });
  app.mount(target);
  return Object.freeze({
    show: () => setVisible(true),
    hide: () => setVisible(false),
    toggle: () => setVisible(!visible.value),
    update(state) {
      options.host.state.value = state.status === "ready"
        ? {
            status: "ready",
            ...(typeof state.mapId === "number" ? { mapId: state.mapId } : {}),
          }
        : {
            status: "waiting",
            ...(typeof state.reason === "string" ? { reason: state.reason } : {}),
          };
    },
    dispose: () => app.unmount(),
  });
}
