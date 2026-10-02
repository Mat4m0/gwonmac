/** Shared drag, resize, and viewport fitting for independent in-game windows. */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";
import { installResizeGrip } from "../../../src/shared/ui/resize";
import {
  restoreFloatingWindowPlacement,
  serializeFloatingWindowPlacement,
} from "../../../src/shared/ui/window-placement";

export function useFloatingWindow(options: {
  mode: "standalone" | "embedded";
  visible: Ref<boolean>;
  initialPosition: { left: number; top: number };
  minWidth: number;
  minHeight: number;
  viewportMargin?: number;
  placementStorageKey?: string;
}) {
  const panel = ref<HTMLElement | null>(null);
  const resizeGrip = ref<HTMLButtonElement | null>(null);
  const margin = options.viewportMargin ?? 0;
  const storageKey = options.mode === "embedded"
    ? options.placementStorageKey
    : undefined;
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight, margin });
  let serialized: string | null = null;
  if (storageKey) {
    try {
      serialized = window.localStorage.getItem(storageKey);
    } catch {
      // Browser storage refusal leaves the window at its ordinary default.
    }
  }
  const restored = restoreFloatingWindowPlacement(
    serialized,
    viewport(),
    { width: options.minWidth, height: options.minHeight },
  );
  const position = ref(restored
    ? { left: restored.left, top: restored.top }
    : { ...options.initialPosition });
  const size = ref(restored
    ? { width: restored.width, height: restored.height }
    : null);
  const minimum = { width: options.minWidth, height: options.minHeight };
  /**
   * Where the player last put the window, normalized to the viewport. A resize derives the box
   * from it and only the player's own moves are saved, so a window that shrinks and grows back
   * returns the panel to that place and size (HUB-109).
   */
  let intent: string | null = restored ? serialized : null;
  const panelStyle = computed(() => options.mode === "embedded"
    ? {
        left: `${position.value.left}px`,
        top: `${position.value.top}px`,
        ...(size.value
          ? { width: `${size.value.width}px`, height: `${size.value.height}px` }
          : {}),
      }
    : undefined);

  const fitToViewport = async () => {
    if (options.mode !== "embedded" || !panel.value) return;
    const placed = restoreFloatingWindowPlacement(intent, viewport(), minimum);
    if (placed) {
      position.value = { left: placed.left, top: placed.top };
      size.value = { width: placed.width, height: placed.height };
      return;
    }
    // Never placed: the default position and natural size, squeezed only while the viewport is smaller.
    if (size.value) {
      size.value = null;
      await nextTick();
      if (!panel.value) return;
    }
    const availableWidth = Math.max(0, window.innerWidth - margin * 2);
    const availableHeight = Math.max(0, window.innerHeight - margin * 2);
    const width = Math.min(panel.value.offsetWidth, availableWidth);
    const height = Math.min(panel.value.offsetHeight, availableHeight);
    if (width !== panel.value.offsetWidth || height !== panel.value.offsetHeight) {
      size.value = { width, height };
    }
    position.value = {
      left: Math.max(margin, Math.min(window.innerWidth - width - margin, options.initialPosition.left)),
      top: Math.max(margin, Math.min(window.innerHeight - height - margin, options.initialPosition.top)),
    };
  };

  const fit = () => { void fitToViewport(); };

  const startDrag = (event: PointerEvent) => {
    if (event.button !== 0 || options.mode !== "embedded" || !panel.value) return;
    if ((event.target as Element).closest("button, input, select, textarea, a, summary, label")) return;
    const element = panel.value;
    const handle = event.currentTarget as HTMLElement;
    const box = element.getBoundingClientRect();
    const offsetX = event.clientX - box.left;
    const offsetY = event.clientY - box.top;
    handle.setPointerCapture(event.pointerId);
    element.dataset.dragging = "";
    const move = (next: PointerEvent) => {
      position.value = {
        left: Math.max(margin, Math.min(
          window.innerWidth - element.offsetWidth - margin,
          next.clientX - offsetX,
        )),
        top: Math.max(margin, Math.min(
          window.innerHeight - element.offsetHeight - margin,
          next.clientY - offsetY,
        )),
      };
    };
    const finish = () => {
      delete element.dataset.dragging;
      remember();
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      handle.removeEventListener("lostpointercapture", finish);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
  };

  let disposeResize: (() => void) | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const persistPlacement = () => {
    if (!storageKey || intent === null) return;
    try {
      window.localStorage.setItem(storageKey, intent);
    } catch {
      // A UI preference must not make the surface unusable when storage fails.
    }
  };
  const schedulePersistence = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistPlacement();
    }, 150);
  };
  /** The player moved or resized the window: that box is the placement to keep. */
  function remember() {
    if (!panel.value) return;
    intent = serializeFloatingWindowPlacement({
      ...position.value,
      width: size.value?.width ?? panel.value.offsetWidth,
      height: size.value?.height ?? panel.value.offsetHeight,
    }, viewport()) ?? intent;
    if (storageKey) schedulePersistence();
  }
  onMounted(() => {
    window.addEventListener("resize", fit);
    if (storageKey) window.addEventListener("pagehide", persistPlacement);
    requestAnimationFrame(fit);
    if (options.mode !== "embedded" || !panel.value || !resizeGrip.value) return;
    disposeResize = installResizeGrip(resizeGrip.value, {
      size: () => {
        const box = panel.value!.getBoundingClientRect();
        return { width: box.width, height: box.height };
      },
      limits: () => ({
        minWidth: Math.min(options.minWidth, window.innerWidth - position.value.left - margin),
        minHeight: Math.min(options.minHeight, window.innerHeight - position.value.top - margin),
        maxWidth: window.innerWidth - position.value.left - margin,
        maxHeight: window.innerHeight - position.value.top - margin,
      }),
      resize: (width, height) => { size.value = { width, height }; remember(); },
      setActive: (active) => {
        if (!panel.value) return;
        if (active) panel.value.dataset.resizing = "";
        else delete panel.value.dataset.resizing;
      },
    });
  });
  onBeforeUnmount(() => {
    window.removeEventListener("resize", fit);
    if (storageKey) {
      window.removeEventListener("pagehide", persistPlacement);
      if (persistTimer) clearTimeout(persistTimer);
      persistPlacement();
    }
    disposeResize?.();
  });
  watch(options.visible, (visible) => {
    if (visible) requestAnimationFrame(fit);
  });

  return { panel, resizeGrip, panelStyle, startDrag, fitToViewport };
}
