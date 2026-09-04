/**
 * Owns the Compass-local menu for enabling standard player ranges.
 * Range choices persist independently while the master visibility is off.
 */
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import {
  COMPASS_CONTROL_GAP,
  COMPASS_CONTROL_OPEN_EVENT,
  COMPASS_CONTROL_SIZE,
  projectCompassControlPosition,
  type CompassControlPlacement,
} from "./compass-control-placement.js";
import {
  COMPASS_RANGE_INDICATORS,
  type CompassRangeId,
} from "./compass-range-layer.js";
import type { ScreenBox } from "./frame-placement.js";

const COLLAPSE_DELAY_MS = 600;
const PANEL_WIDTH = 170;
const PANEL_HEIGHT_ESTIMATE = 184;

const RANGE_SETTING_KEYS = Object.freeze({
  earshot: "compassRangeEarshotEnabled",
  cast: "compassRangeCastEnabled",
  spirit: "compassRangeSpiritEnabled",
  "spirit-extended": "compassRangeSpiritExtendedEnabled",
} satisfies Record<CompassRangeId, keyof AppSettings>);

export type CompassRangeControls = Readonly<{
  update(
    box: ScreenBox,
    settings: AppSettings,
    placement: CompassControlPlacement,
  ): void;
  hide(): void;
  dispose(): void;
}>;

function rangeIcon(document: Document): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("compass-range-control-icon");
  for (const radius of [2.25, 4.5, 6.75]) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "8");
    circle.setAttribute("cy", "8");
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "1.25");
    svg.append(circle);
  }
  return svg;
}

export function visibleCompassRangeIds(settings: AppSettings): readonly CompassRangeId[] {
  if (!settings.compassRangeIndicatorsEnabled) return [];
  return COMPASS_RANGE_INDICATORS
    .filter(({ id }) => settings[RANGE_SETTING_KEYS[id]] === true)
    .map(({ id }) => id);
}

export function createCompassRangeControls(options: Readonly<{
  parent: HTMLElement;
  persist(patch: RendererSettingsPatch): Promise<AppSettings>;
}>): CompassRangeControls {
  const document = options.parent.ownerDocument;
  const view = document.defaultView;
  if (view === null) throw new Error("Compass range controls require a live document");
  const root = document.createElement("div");
  root.id = "compass-range-controls";
  root.hidden = true;
  root.style.setProperty("--compass-range-control-size", `${COMPASS_CONTROL_SIZE}px`);
  root.style.setProperty("--compass-range-panel-width", `${PANEL_WIDTH}px`);
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "compass-range-control-trigger";
  trigger.setAttribute("aria-label", "Toggle Compass ranges");
  trigger.setAttribute("aria-expanded", "false");
  trigger.title = "Compass ranges";
  trigger.append(rangeIcon(document));
  const panel = document.createElement("div");
  panel.className = "compass-range-control-panel";
  panel.hidden = true;
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Compass ranges");
  const heading = document.createElement("strong");
  heading.className = "compass-range-control-heading";
  heading.textContent = "Compass ranges";
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = "compass-range-control-all";
  allButton.textContent = "All ranges";
  const rangeList = document.createElement("div");
  rangeList.className = "compass-range-control-list";
  const rangeButtons = new Map<CompassRangeId, HTMLButtonElement>();
  for (const range of COMPASS_RANGE_INDICATORS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "compass-range-control-range";
    button.dataset.range = range.id;
    const swatch = document.createElement("span");
    swatch.className = "compass-range-control-swatch";
    swatch.style.setProperty("--compass-range-color", range.color);
    const label = document.createElement("span");
    label.textContent = range.label;
    button.append(swatch, label);
    rangeButtons.set(range.id, button);
    rangeList.append(button);
  }
  const status = document.createElement("p");
  status.className = "compass-range-control-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  panel.append(heading, allButton, rangeList, status);
  root.append(trigger, panel);
  options.parent.append(root);

  let canonical: AppSettings | null = null;
  let saving = false;
  let disposed = false;
  let open = false;
  let collapseTimer = 0;
  let latestBox: ScreenBox | null = null;
  let latestPlacement: CompassControlPlacement = { index: 0, count: 1 };
  let renderedSettings: AppSettings | null = null;
  let panelHeight = PANEL_HEIGHT_ESTIMATE;

  const syncDisabled = (): void => {
    trigger.disabled = saving;
    allButton.disabled = saving;
    const enabled = canonical?.compassRangeIndicatorsEnabled === true;
    for (const button of rangeButtons.values()) button.disabled = saving || !enabled;
  };
  const setSaving = (value: boolean): void => { saving = value; syncDisabled(); };
  const sync = (force = false): void => {
    const settings = canonical;
    if (settings === null || (!force && renderedSettings === settings)) return;
    renderedSettings = settings;
    const enabled = settings.compassRangeIndicatorsEnabled;
    trigger.setAttribute("aria-pressed", String(enabled));
    allButton.setAttribute("aria-pressed", String(enabled));
    for (const [id, button] of rangeButtons) {
      button.setAttribute("aria-pressed", String(settings[RANGE_SETTING_KEYS[id]]));
    }
    syncDisabled();
    if (!open) root.style.opacity = String(settings.cartographyControlIdleOpacity / 100);
  };
  const positionPanel = (): void => {
    if (latestBox === null || !open) return;
    const margin = 6;
    const rootTop = Number.parseFloat(root.style.top) || margin;
    const top = Math.max(
      margin,
      Math.min(view.innerHeight - panelHeight - margin,
        rootTop + (COMPASS_CONTROL_SIZE - panelHeight) / 2),
    );
    panel.style.top = `${Math.round(top - rootTop)}px`;
  };
  const setOpen = (value: boolean): void => {
    if (value && !open) {
      document.dispatchEvent(new CustomEvent(COMPASS_CONTROL_OPEN_EVENT, {
        detail: "ranges",
      }));
    }
    open = value;
    panel.hidden = !value;
    trigger.setAttribute("aria-expanded", String(value));
    root.style.opacity = value
      ? "1"
      : String((canonical?.cartographyControlIdleOpacity ?? 35) / 100);
    if (value) positionPanel();
  };
  const observer = typeof view.ResizeObserver === "function"
    ? new view.ResizeObserver((entries) => {
      const entry = entries[0];
      const measured = entry?.borderBoxSize[0]?.blockSize ?? entry?.contentRect.height;
      if (measured !== undefined && measured > 0 && measured !== panelHeight) {
        panelHeight = measured;
        positionPanel();
      }
    })
    : null;
  observer?.observe(panel);
  const cancelCollapse = (): void => {
    if (collapseTimer !== 0) view.clearTimeout(collapseTimer);
    collapseTimer = 0;
  };
  const scheduleCollapse = (): void => {
    cancelCollapse();
    collapseTimer = view.setTimeout(() => {
      collapseTimer = 0;
      if (!root.matches(":hover") && !root.contains(document.activeElement)) setOpen(false);
    }, COLLAPSE_DELAY_MS);
  };
  const apply = (patch: RendererSettingsPatch): void => {
    if (canonical === null || saving) return;
    setSaving(true);
    status.textContent = "Saving…";
    void options.persist(patch).then((saved) => {
      if (disposed) return;
      canonical = saved;
      status.textContent = "";
      setSaving(false);
      sync(true);
    }, () => {
      if (disposed) return;
      status.textContent = "Could not save";
      setSaving(false);
      sync(true);
    });
  };
  const toggleAll = (): void => {
    if (canonical !== null) apply({
      compassRangeIndicatorsEnabled: !canonical.compassRangeIndicatorsEnabled,
    });
  };
  for (const type of ["pointerdown", "pointerup", "click", "wheel", "keydown", "keyup"]) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }
  root.addEventListener("pointerenter", () => { cancelCollapse(); setOpen(true); });
  root.addEventListener("pointerleave", scheduleCollapse);
  root.addEventListener("focusin", () => { cancelCollapse(); setOpen(true); });
  root.addEventListener("focusout", scheduleCollapse);
  const otherControlOpened = (event: Event): void => {
    if (event instanceof CustomEvent && event.detail !== "ranges") setOpen(false);
  };
  document.addEventListener(COMPASS_CONTROL_OPEN_EVENT, otherControlOpened);
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    setOpen(false);
    trigger.focus();
  });
  trigger.addEventListener("click", toggleAll);
  allButton.addEventListener("click", toggleAll);
  for (const [id, button] of rangeButtons) {
    button.addEventListener("click", () => {
      if (canonical === null) return;
      const key = RANGE_SETTING_KEYS[id];
      apply({ [key]: !canonical[key] });
    });
  }

  const positionRoot = (): void => {
    if (latestBox === null) return;
    const position = projectCompassControlPosition(
      latestBox,
      { width: view.innerWidth, height: view.innerHeight },
      PANEL_WIDTH,
      latestPlacement,
    );
    if (position === null) return;
    panel.style.left = position.panelSide === "right"
      ? `${COMPASS_CONTROL_SIZE + COMPASS_CONTROL_GAP}px` : "auto";
    panel.style.right = position.panelSide === "left"
      ? `${COMPASS_CONTROL_SIZE + COMPASS_CONTROL_GAP}px` : "auto";
    root.style.left = `${position.left}px`;
    root.style.top = `${position.top}px`;
    positionPanel();
  };
  const viewportResize = (): void => positionRoot();
  view.addEventListener("resize", viewportResize);

  return Object.freeze({
    update(box, settings, placement) {
      const boxChanged = latestBox === null
        || latestBox.left !== box.left || latestBox.top !== box.top
        || latestBox.width !== box.width || latestBox.height !== box.height;
      const placementChanged = latestPlacement.index !== placement.index
        || latestPlacement.count !== placement.count;
      if (boxChanged) latestBox = { ...box };
      if (placementChanged) latestPlacement = { ...placement };
      if (canonical !== settings) { canonical = settings; sync(); }
      const becameVisible = root.hidden;
      root.hidden = false;
      if (boxChanged || placementChanged || becameVisible) positionRoot();
    },
    hide() {
      cancelCollapse();
      setOpen(false);
      root.hidden = true;
      latestBox = null;
      canonical = null;
      renderedSettings = null;
    },
    dispose() {
      disposed = true;
      cancelCollapse();
      observer?.disconnect();
      view.removeEventListener("resize", viewportResize);
      document.removeEventListener(COMPASS_CONTROL_OPEN_EVENT, otherControlOpened);
      root.remove();
    },
  });
}
