/**
 * Owns the collapsible Compass-edge style selector and shared opacity control.
 * Isolates only its visible controls while leaving the surrounding game clickable.
 */
import {
  CARTOGRAPHY_OVERLAY_STYLE_IDS,
  cartographyOverlayStyle,
  type CartographyOverlayStyleId,
} from "../../shared/cartography-overlay.js";
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import type { ScreenBox } from "./frame-placement.js";

const COLLAPSE_DELAY_MS = 1_500;
const CONTROL_SIZE = 22;
const EXPANDED_HEIGHT = 112;

const STYLE_NAMES: Readonly<Record<CartographyOverlayStyleId, string>> = Object.freeze({
  black: "Black",
  white: "White",
  green: "Green",
  pink: "Pink",
  custom: "Custom",
});

export type CartographyOverlayControls = Readonly<{
  update(box: ScreenBox, settings: AppSettings): void;
  hide(): void;
  dispose(): void;
}>;

/** Compact controls that expand only while the player is using them. */
export function createCartographyOverlayControls(options: Readonly<{
  parent: HTMLElement;
  persist(patch: RendererSettingsPatch): Promise<AppSettings>;
  previewOpacity(opacity: number | null): void;
}>): CartographyOverlayControls {
  const document = options.parent.ownerDocument;
  const view = document.defaultView;
  if (view === null) throw new Error("cartography controls require a live document");

  const root = document.createElement("div");
  root.id = "cartography-overlay-controls";
  root.style.cssText = [
    "position:fixed", "z-index:10", "display:none", `width:${CONTROL_SIZE}px`,
    "box-sizing:border-box", "pointer-events:auto", "font:600 11px/1 system-ui,sans-serif",
    "color:#f5f0df", "transition:opacity 140ms ease-out",
  ].join(";");

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Map overlay style");
  select.style.cssText = [
    `display:block;width:${CONTROL_SIZE}px;height:${CONTROL_SIZE}px`, "padding:0",
    "border:2px solid rgba(255,255,255,.82)", "border-radius:50%",
    "appearance:none", "color:transparent", "cursor:pointer",
    "box-shadow:0 1px 3px rgba(0,0,0,.68)",
  ].join(";");
  for (const id of CARTOGRAPHY_OVERLAY_STYLE_IDS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = STYLE_NAMES[id];
    option.style.color = "#111111";
    select.append(option);
  }

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  slider.setAttribute("aria-label", "Map overlay opacity");
  slider.style.cssText = [
    "display:none", "width:18px", "height:80px", "margin:6px auto 0",
    "writing-mode:vertical-lr", "direction:rtl", "accent-color:#d8c580",
    "cursor:pointer", "filter:drop-shadow(0 1px 2px rgba(0,0,0,.75))",
  ].join(";");
  const value = document.createElement("output");
  value.style.cssText = [
    "position:absolute", "display:none", "left:26px", "top:46px",
    "font-variant-numeric:tabular-nums", "text-shadow:0 1px 3px #000,0 0 3px #000",
  ].join(";");
  root.append(select, slider, value);
  options.parent.append(root);

  let current: AppSettings | null = null;
  let expanded = false;
  let collapseTimer = 0;
  let write: Promise<unknown> = Promise.resolve();

  const persist = (patch: RendererSettingsPatch) => {
    const next = write.then(() => options.persist(patch));
    write = next.catch(() => undefined);
    return next;
  };
  const setExpanded = (next: boolean) => {
    expanded = next;
    slider.style.display = next ? "block" : "none";
    if (!next) {
      value.style.display = "none";
      options.previewOpacity(null);
    }
    root.style.opacity = next
      ? "1"
      : String((current?.cartographyControlIdleOpacity ?? 35) / 100);
  };
  const cancelCollapse = () => {
    if (collapseTimer !== 0) view.clearTimeout(collapseTimer);
    collapseTimer = 0;
  };
  const scheduleCollapse = () => {
    cancelCollapse();
    collapseTimer = view.setTimeout(() => {
      collapseTimer = 0;
      if (!root.matches(":hover") && !root.contains(document.activeElement)) {
        setExpanded(false);
      }
    }, COLLAPSE_DELAY_MS);
  };
  const stop = (event: Event) => event.stopPropagation();
  for (const type of ["pointerdown", "pointerup", "click", "wheel", "keydown", "keyup"]) {
    root.addEventListener(type, stop);
  }
  root.addEventListener("pointerenter", () => {
    cancelCollapse();
    setExpanded(true);
  });
  root.addEventListener("pointerleave", scheduleCollapse);
  root.addEventListener("focusin", () => {
    cancelCollapse();
    setExpanded(true);
  });
  root.addEventListener("focusout", scheduleCollapse);
  slider.addEventListener("input", () => {
    const opacity = Number(slider.value);
    value.value = `${opacity}%`;
    value.style.display = "block";
    options.previewOpacity(opacity);
  });
  slider.addEventListener("change", () => {
    const opacity = Number(slider.value);
    value.style.display = "none";
    options.previewOpacity(null);
    void persist({ cartographyOverlayOpacity: opacity });
  });
  select.addEventListener("change", () => {
    const style = CARTOGRAPHY_OVERLAY_STYLE_IDS.find((id) => id === select.value);
    if (style !== undefined) void persist({ cartographyOverlayStyle: style });
  });

  return Object.freeze({
    update(box, settings) {
      current = settings;
      select.value = settings.cartographyOverlayStyle;
      const style = cartographyOverlayStyle(
        settings.cartographyOverlayStyle,
        settings.cartographyOverlayCustomStyle,
      );
      select.style.background = style.veilColor;
      select.style.borderColor = style.outlineColor;
      select.title = `Overlay style: ${STYLE_NAMES[settings.cartographyOverlayStyle]}`;
      if (document.activeElement !== slider) slider.value = String(settings.cartographyOverlayOpacity);
      if (!expanded) root.style.opacity = String(settings.cartographyControlIdleOpacity / 100);

      const height = expanded ? EXPANDED_HEIGHT : CONTROL_SIZE;
      const gap = 3;
      const margin = 6;
      const roomLeft = box.left >= CONTROL_SIZE + gap + margin;
      const roomRight = box.left + box.width + CONTROL_SIZE + gap + margin <= view.innerWidth;
      const left = roomLeft
        ? box.left - CONTROL_SIZE - gap
        : roomRight
          ? box.left + box.width + gap
          : Math.max(margin, Math.min(view.innerWidth - CONTROL_SIZE - margin, box.left + margin));
      const top = Math.max(margin, Math.min(
        view.innerHeight - height - margin,
        box.top + Math.max(0, (box.height - height) / 2),
      ));
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.display = "block";
    },
    hide() {
      cancelCollapse();
      root.style.display = "none";
      current = null;
      setExpanded(false);
    },
    dispose() {
      cancelCollapse();
      root.remove();
    },
  });
}
