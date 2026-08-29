/**
 * Owns the Compass-edge cartography menu. The collapsed button stays available
 * even when both layers are off; the expanded menu exposes the two primary
 * layer toggles before secondary appearance controls.
 */
import {
  CARTOGRAPHY_OVERLAY_STYLE_IDS,
  cartographyOverlayStyle,
  type CartographyOverlayStyleId,
} from "../../shared/cartography-overlay.js";
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import type { ScreenBox } from "./frame-placement.js";

const COLLAPSE_DELAY_MS = 1_200;
const CONTROL_SIZE = 24;
const PANEL_WIDTH = 178;
const PANEL_HEIGHT = 154;

const STYLE_NAMES: Readonly<Record<CartographyOverlayStyleId, string>> = Object.freeze({
  contrast: "Contrast",
  soft: "Soft",
  monochrome: "Monochrome",
  custom: "Custom",
});

export type CartographyOverlayControls = Readonly<{
  update(box: ScreenBox, settings: AppSettings): void;
  hide(): void;
  dispose(): void;
}>;

function layerIcon(document: Document): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "display:block;width:14px;height:14px";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M8 2 14 5 8 8 2 5Zm-6 6 6 3 6-3M2 11l6 3 6-3");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function makeLayerButton(document: Document, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText = [
    "height:28px", "padding:0 9px", "border:1px solid rgba(255,255,255,.2)",
    "border-radius:6px", "background:rgba(255,255,255,.06)", "color:#f4f1e7",
    "cursor:pointer", "font:650 11px/1 system-ui,sans-serif",
  ].join(";");
  return button;
}

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
    `height:${CONTROL_SIZE}px`, "box-sizing:border-box", "pointer-events:auto",
    "font:600 11px/1 system-ui,sans-serif", "color:#f4f1e7",
    "transition:opacity 140ms ease-out",
  ].join(";");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.setAttribute("aria-label", "Cartography layers");
  trigger.setAttribute("aria-expanded", "false");
  trigger.title = "Cartography layers";
  trigger.style.cssText = [
    `display:grid;place-items:center;width:${CONTROL_SIZE}px;height:${CONTROL_SIZE}px`,
    "padding:0", "border:1px solid rgba(255,255,255,.5)", "border-radius:50%",
    "background:rgba(15,18,17,.72)", "color:#f4f1e7", "cursor:pointer",
    "box-shadow:0 1px 4px rgba(0,0,0,.68)",
  ].join(";");
  trigger.append(layerIcon(document));

  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:absolute", "display:none", `width:${PANEL_WIDTH}px`,
    `min-height:${PANEL_HEIGHT}px`, "box-sizing:border-box", "padding:9px",
    "border:1px solid rgba(255,255,255,.24)", "border-radius:9px",
    "background:rgba(13,16,15,.93)", "box-shadow:0 4px 16px rgba(0,0,0,.6)",
    "backdrop-filter:blur(5px)", "color:#f4f1e7",
  ].join(";");

  const heading = document.createElement("div");
  heading.textContent = "Map layers";
  heading.style.cssText = "margin:0 0 7px;font:700 11px/1 system-ui,sans-serif;color:rgba(244,241,231,.75)";

  const layerRow = document.createElement("div");
  layerRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:9px";
  const gridButton = makeLayerButton(document, "Grid");
  const walkableButton = makeLayerButton(document, "Walkable");
  layerRow.append(gridButton, walkableButton);

  const settingsGrid = document.createElement("div");
  settingsGrid.style.cssText = "display:grid;grid-template-columns:48px 1fr;align-items:center;gap:7px 8px";

  const rangeLabel = document.createElement("label");
  rangeLabel.textContent = "Range";
  const revealRange = document.createElement("select");
  revealRange.setAttribute("aria-label", "Grid reveal range");
  for (const [optionValue, label] of [["off", "Shift hover"], ["normal", "3×3"], ["birds-eye", "7×7"]] as const) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    revealRange.append(option);
  }

  const opacityLabel = document.createElement("label");
  opacityLabel.textContent = "Opacity";
  const opacityWrap = document.createElement("div");
  opacityWrap.style.cssText = "display:grid;grid-template-columns:1fr 29px;align-items:center;gap:5px";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  slider.setAttribute("aria-label", "Map overlay opacity");
  slider.style.cssText = "width:100%;margin:0;accent-color:#d8c580;cursor:pointer";
  const value = document.createElement("output");
  value.style.cssText = "text-align:right;font-variant-numeric:tabular-nums;color:rgba(244,241,231,.72)";
  opacityWrap.append(slider, value);

  const presetLabel = document.createElement("label");
  presetLabel.textContent = "Colors";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Map color preset");
  for (const id of CARTOGRAPHY_OVERLAY_STYLE_IDS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = STYLE_NAMES[id];
    select.append(option);
  }
  for (const control of [revealRange, select]) {
    control.style.cssText = [
      "width:100%", "height:26px", "padding:0 5px", "border:1px solid rgba(255,255,255,.2)",
      "border-radius:5px", "background:#222725", "color:#f4f1e7", "cursor:pointer",
      "font:600 11px/1 system-ui,sans-serif",
    ].join(";");
  }
  for (const label of [rangeLabel, opacityLabel, presetLabel]) {
    label.style.cssText = "color:rgba(244,241,231,.7)";
  }
  settingsGrid.append(rangeLabel, revealRange, opacityLabel, opacityWrap, presetLabel, select);
  panel.append(heading, layerRow, settingsGrid);
  root.append(trigger, panel);
  options.parent.append(root);

  let canonical: AppSettings | null = null;
  let optimistic: AppSettings | null = null;
  let pendingWrites = 0;
  let expanded = false;
  let collapseTimer = 0;
  let write: Promise<unknown> = Promise.resolve();

  const persist = (patch: RendererSettingsPatch) => {
    const next = write.then(() => options.persist(patch));
    write = next.catch(() => undefined);
    return next;
  };
  const settings = (): AppSettings | null => optimistic ?? canonical;
  const syncLayerButton = (button: HTMLButtonElement, enabled: boolean): void => {
    button.setAttribute("aria-pressed", String(enabled));
    button.style.background = enabled ? "rgba(216,197,128,.22)" : "rgba(255,255,255,.06)";
    button.style.borderColor = enabled ? "rgba(232,214,151,.78)" : "rgba(255,255,255,.2)";
    button.style.color = enabled ? "#fff5c9" : "rgba(244,241,231,.72)";
  };
  const sync = (): void => {
    const current = settings();
    if (current === null) return;
    syncLayerButton(gridButton, current.cartographyGridEnabled);
    syncLayerButton(walkableButton, current.cartographyOverlayEnabled);
    revealRange.value = current.cartographyRevealMode;
    revealRange.disabled = !current.cartographyGridEnabled;
    revealRange.style.opacity = current.cartographyGridEnabled ? "1" : ".42";
    select.value = current.cartographyOverlayStyle;
    if (document.activeElement !== slider) slider.value = String(current.cartographyOverlayOpacity);
    value.value = `${slider.value}%`;
    const style = cartographyOverlayStyle(
      current.cartographyOverlayStyle,
      current.cartographyOverlayCustomStyle,
    );
    trigger.style.borderColor = style.outlineColor;
    trigger.style.color = style.currentColor;
  };
  const setExpanded = (next: boolean): void => {
    expanded = next;
    panel.style.display = next ? "block" : "none";
    trigger.setAttribute("aria-expanded", String(next));
    if (!next) options.previewOpacity(null);
    root.style.opacity = next
      ? "1"
      : String((settings()?.cartographyControlIdleOpacity ?? 35) / 100);
  };
  const cancelCollapse = (): void => {
    if (collapseTimer !== 0) view.clearTimeout(collapseTimer);
    collapseTimer = 0;
  };
  const scheduleCollapse = (): void => {
    cancelCollapse();
    collapseTimer = view.setTimeout(() => {
      collapseTimer = 0;
      if (!root.matches(":hover") && !root.contains(document.activeElement)) setExpanded(false);
    }, COLLAPSE_DELAY_MS);
  };
  const apply = (patch: RendererSettingsPatch): void => {
    const current = settings();
    if (current === null) return;
    optimistic = { ...current, ...patch };
    pendingWrites += 1;
    sync();
    void persist(patch).then(
      (saved) => {
        canonical = saved;
        pendingWrites -= 1;
        if (pendingWrites === 0) optimistic = null;
        sync();
      },
      () => {
        pendingWrites -= 1;
        if (pendingWrites === 0) optimistic = null;
        sync();
      },
    );
  };
  const stop = (event: Event): void => event.stopPropagation();
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
  trigger.addEventListener("click", () => setExpanded(!expanded));
  gridButton.addEventListener("click", () => {
    const current = settings();
    if (current !== null) apply({ cartographyGridEnabled: !current.cartographyGridEnabled });
  });
  walkableButton.addEventListener("click", () => {
    const current = settings();
    if (current !== null) apply({ cartographyOverlayEnabled: !current.cartographyOverlayEnabled });
  });
  revealRange.addEventListener("change", () => {
    if (revealRange.value === "off" || revealRange.value === "normal" || revealRange.value === "birds-eye") {
      apply({ cartographyRevealMode: revealRange.value });
    }
  });
  slider.addEventListener("input", () => {
    const opacity = Number(slider.value);
    value.value = `${opacity}%`;
    options.previewOpacity(opacity);
  });
  slider.addEventListener("change", () => {
    options.previewOpacity(null);
    apply({ cartographyOverlayOpacity: Number(slider.value) });
  });
  select.addEventListener("change", () => {
    const style = CARTOGRAPHY_OVERLAY_STYLE_IDS.find((id) => id === select.value);
    if (style !== undefined) apply({ cartographyOverlayStyle: style });
  });

  return Object.freeze({
    update(box, settings) {
      canonical = settings;
      if (pendingWrites === 0) optimistic = null;
      sync();
      if (!expanded) root.style.opacity = String(settings.cartographyControlIdleOpacity / 100);

      const gap = 4;
      const margin = 6;
      const roomLeft = box.left >= CONTROL_SIZE + gap + margin;
      const roomRight = box.left + box.width + CONTROL_SIZE + gap + margin <= view.innerWidth;
      const onLeft = roomLeft || !roomRight;
      const left = onLeft
        ? Math.max(margin, box.left - CONTROL_SIZE - gap)
        : Math.min(view.innerWidth - CONTROL_SIZE - margin, box.left + box.width + gap);
      const top = Math.max(margin, Math.min(
        view.innerHeight - CONTROL_SIZE - margin,
        box.top + Math.max(0, (box.height - CONTROL_SIZE) / 2),
      ));
      const preferredPanelTop = top + (CONTROL_SIZE - PANEL_HEIGHT) / 2;
      const panelTop = Math.max(margin, Math.min(
        view.innerHeight - PANEL_HEIGHT - margin,
        preferredPanelTop,
      ));
      panel.style.left = onLeft ? "auto" : `${CONTROL_SIZE + gap}px`;
      panel.style.right = onLeft ? `${CONTROL_SIZE + gap}px` : "auto";
      panel.style.top = `${Math.round(panelTop - top)}px`;
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.display = "block";
    },
    hide() {
      cancelCollapse();
      root.style.display = "none";
      canonical = null;
      optimistic = null;
      setExpanded(false);
    },
    dispose() {
      cancelCollapse();
      root.remove();
    },
  });
}
