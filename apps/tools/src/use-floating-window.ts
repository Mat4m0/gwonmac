/** Shared drag, resize, and viewport fitting for independent in-game windows. */
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";
import { installResizeGrip } from "../../../src/shared/ui/resize";

export function useFloatingWindow(options: {
  mode: "standalone" | "embedded";
  visible: Ref<boolean>;
  initialPosition: { left: number; top: number };
  minWidth: number;
  minHeight: number;
  viewportMargin?: number;
}) {
  const panel = ref<HTMLElement | null>(null);
  const resizeGrip = ref<HTMLButtonElement | null>(null);
  const position = ref({ ...options.initialPosition });
  const size = ref<{ width: number; height: number } | null>(null);
  const margin = options.viewportMargin ?? 0;
  const panelStyle = computed(() => options.mode === "embedded"
    ? {
        left: `${position.value.left}px`,
        top: `${position.value.top}px`,
        ...(size.value
          ? { width: `${size.value.width}px`, height: `${size.value.height}px` }
          : {}),
      }
    : undefined);

  const fitToViewport = () => {
    if (options.mode !== "embedded" || !panel.value) return;
    const availableWidth = Math.max(0, window.innerWidth - margin * 2);
    const availableHeight = Math.max(0, window.innerHeight - margin * 2);
    const width = Math.min(panel.value.offsetWidth, availableWidth);
    const height = Math.min(panel.value.offsetHeight, availableHeight);
    if (width !== panel.value.offsetWidth || height !== panel.value.offsetHeight) {
      size.value = { width, height };
    }
    position.value = {
      left: Math.max(margin, Math.min(window.innerWidth - width - margin, position.value.left)),
      top: Math.max(margin, Math.min(window.innerHeight - height - margin, position.value.top)),
    };
  };

  const startDrag = (event: PointerEvent) => {
    if (options.mode !== "embedded" || !panel.value) return;
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
  onMounted(() => {
    window.addEventListener("resize", fitToViewport);
    requestAnimationFrame(fitToViewport);
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
      resize: (width, height) => { size.value = { width, height }; },
      setActive: (active) => {
        if (!panel.value) return;
        if (active) panel.value.dataset.resizing = "";
        else delete panel.value.dataset.resizing;
      },
    });
  });
  onBeforeUnmount(() => {
    window.removeEventListener("resize", fitToViewport);
    disposeResize?.();
  });
  watch(options.visible, (visible) => {
    if (visible) requestAnimationFrame(fitToViewport);
  });

  return { panel, resizeGrip, panelStyle, startDrag, fitToViewport };
}
