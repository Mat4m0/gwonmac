/**
 * Owns the Compass-local menu for enabling standard player ranges.
 * Range choices persist independently while the master visibility is off.
 */
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import {
  COMPASS_RANGE_INDICATORS,
  COMPASS_RANGE_OPACITY_MAX,
  COMPASS_RANGE_OPACITY_MIN,
  COMPASS_RANGE_THEMES,
  compassRangeColor,
  type CompassRangeId,
  type CompassRangeTheme,
} from "../../shared/compass-ranges.js";
import {
  COMPASS_CONTROL_GAP,
  COMPASS_CONTROL_OPEN_EVENT,
  COMPASS_CONTROL_SIZE,
  projectCompassControlPosition,
  type CompassControlPlacement,
} from "./compass-control-placement.js";
import {
  type CompassRangeSelection,
} from "./compass-range-layer.js";
import type { ScreenBox } from "./frame-placement.js";

const COLLAPSE_DELAY_MS = 600;
const PANEL_WIDTH = 220;
const PANEL_HEIGHT_ESTIMATE = 290;

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

export function visibleCompassRanges(
  settings: AppSettings,
  previewOpacity: (id: CompassRangeId) => number | null = () => null,
): readonly CompassRangeSelection[] {
  if (!settings.compassRangeIndicatorsEnabled) return [];
  return COMPASS_RANGE_INDICATORS
    .filter(({ enabledSetting }) => settings[enabledSetting] === true)
    .map(({ id, opacitySetting }) => ({
      id,
      opacity: previewOpacity(id) ?? settings[opacitySetting],
    }));
}

export function createCompassRangeControls(options: Readonly<{
  parent: HTMLElement;
  persist(patch: RendererSettingsPatch): Promise<AppSettings>;
  previewOpacity(id: CompassRangeId, opacity: number | null): void;
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
  trigger.setAttribute("aria-controls", "compass-range-control-panel");
  trigger.setAttribute("aria-expanded", "false");
  trigger.title = "Compass ranges";
  trigger.append(rangeIcon(document));
  const panel = document.createElement("div");
  panel.id = "compass-range-control-panel";
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
  const themeGroup = document.createElement("div");
  themeGroup.className = "compass-range-theme-options";
  themeGroup.setAttribute("role", "group");
  themeGroup.setAttribute("aria-label", "Range appearance");
  const themeButtons = new Map<CompassRangeTheme, HTMLButtonElement>();
  for (const theme of COMPASS_RANGE_THEMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = theme === "color" ? "Color" : "Monochrome";
    themeButtons.set(theme, button);
    themeGroup.append(button);
  }
  const rangeList = document.createElement("div");
  rangeList.className = "compass-range-control-list";
  const rangeControls = new Map<CompassRangeId, Readonly<{
    button: HTMLButtonElement;
    input: HTMLInputElement;
    output: HTMLOutputElement;
  }>>();
  for (const range of COMPASS_RANGE_INDICATORS) {
    const row = document.createElement("div");
    row.className = "compass-range-control-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "compass-range-control-range";
    button.dataset.range = range.id;
    const swatch = document.createElement("span");
    swatch.className = "compass-range-control-swatch";
    const label = document.createElement("span");
    label.textContent = range.label;
    button.append(swatch, label);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(COMPASS_RANGE_OPACITY_MIN);
    input.max = String(COMPASS_RANGE_OPACITY_MAX);
    input.step = "1";
    input.setAttribute("aria-label", `${range.label} opacity`);
    const output = document.createElement("output");
    output.setAttribute("aria-label", `${range.label} opacity value`);
    row.append(button, input, output);
    rangeControls.set(range.id, { button, input, output });
    rangeList.append(row);
  }
  const status = document.createElement("p");
  status.className = "compass-range-control-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  panel.append(heading, allButton, themeGroup, rangeList, status);
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
    for (const button of themeButtons.values()) button.disabled = saving;
    for (const { button, input } of rangeControls.values()) {
      button.disabled = saving;
      input.disabled = saving;
    }
  };
  const setSaving = (value: boolean): void => { saving = value; syncDisabled(); };
  const sync = (force = false): void => {
    const settings = canonical;
    if (settings === null || (!force && renderedSettings === settings)) return;
    renderedSettings = settings;
    const enabled = settings.compassRangeIndicatorsEnabled;
    trigger.setAttribute("aria-pressed", String(enabled));
    allButton.setAttribute("aria-pressed", String(enabled));
    allButton.textContent = enabled ? "Hide all ranges" : "Show all ranges";
    for (const [theme, button] of themeButtons) {
      button.setAttribute("aria-pressed", String(settings.compassRangeTheme === theme));
    }
    for (const range of COMPASS_RANGE_INDICATORS) {
      const controls = rangeControls.get(range.id);
      if (controls === undefined) continue;
      controls.button.setAttribute("aria-pressed", String(settings[range.enabledSetting]));
      controls.button.style.setProperty(
        "--compass-range-color",
        compassRangeColor(range, settings.compassRangeTheme),
      );
      if (document.activeElement !== controls.input) {
        controls.input.value = String(settings[range.opacitySetting]);
      }
      controls.output.value = `${controls.input.value}%`;
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
    else for (const { id } of COMPASS_RANGE_INDICATORS) options.previewOpacity(id, null);
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
  for (const [theme, button] of themeButtons) {
    button.addEventListener("click", () => apply({ compassRangeTheme: theme }));
  }
  for (const range of COMPASS_RANGE_INDICATORS) {
    const controls = rangeControls.get(range.id);
    if (controls === undefined) continue;
    controls.button.addEventListener("click", () => {
      if (canonical === null) return;
      apply({ [range.enabledSetting]: !canonical[range.enabledSetting] });
    });
    controls.input.addEventListener("input", () => {
      controls.output.value = `${controls.input.value}%`;
      options.previewOpacity(range.id, Number(controls.input.value));
    });
    controls.input.addEventListener("change", () => {
      options.previewOpacity(range.id, null);
      apply({ [range.opacitySetting]: Number(controls.input.value) });
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
