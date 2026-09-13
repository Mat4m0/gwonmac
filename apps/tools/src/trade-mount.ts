/** Vue mount and lifetime for the independent Trade Chat surface. */
import { createApp, h, ref } from "vue";
import TradeChatApp from "./TradeChatApp.vue";
import type { TradeHost } from "./trade-host";
import type { TradeChatHandle } from "../../../src/shared/tools-bundle-contracts";

export function mountTradeChat(
  target: HTMLElement,
  options: {
    host: TradeHost;
    mode: "standalone" | "embedded";
    initiallyVisible?: boolean;
    onVisibilityChange?: (visible: boolean) => void;
  },
): TradeChatHandle {
  const view = ref<InstanceType<typeof TradeChatApp> | null>(null);
  const visible = ref(options.initiallyVisible ?? options.mode === "standalone");
  const active = ref(options.mode === "standalone");
  const setVisible = (next: boolean) => {
    if (visible.value === next) return;
    visible.value = next;
    options.onVisibilityChange?.(next);
  };
  const app = createApp({
    setup: () => () => h(TradeChatApp, {
      ref: view,
      host: options.host,
      mode: options.mode,
      visible: visible.value,
      active: active.value,
      onClose: () => setVisible(false),
      onReady: () => { target.dataset.ready = "true"; },
    }),
  });
  app.mount(target);
  return Object.freeze({
    search: (query: string) => view.value?.search(query),
    show: () => setVisible(true),
    hide: () => setVisible(false),
    toggle: () => setVisible(!visible.value),
    setActive: (next: boolean) => { active.value = next; },
    dispose: () => app.unmount(),
  });
}
