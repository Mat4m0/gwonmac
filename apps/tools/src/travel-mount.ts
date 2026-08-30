/** Mounts the Vue Travel palette and exposes its small lifecycle to the renderer. */
import { createApp, h, ref } from "vue";
import TravelPalette from "./components/TravelPalette.vue";
import type { TravelHost } from "./travel-host";
import type { TravelPaletteHandle } from "../../../src/shared/tools-bundle-contracts";

export function mountTravelPalette(
  target: HTMLElement,
  options: {
    host: TravelHost;
    nativeDialog?: boolean;
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
      ...(options.nativeDialog === undefined ? {} : { nativeDialog: options.nativeDialog }),
      onClose: () => setVisible(false),
    }),
  });
  app.mount(target);
  return Object.freeze({
    show: () => setVisible(true),
    hide: () => setVisible(false),
    toggle: () => setVisible(!visible.value),
    update(state) {
      options.host.updateGameState(state);
    },
    dispose: () => {
      options.host.dispose();
      app.unmount();
    },
  });
}
