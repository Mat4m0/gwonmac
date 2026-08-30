/**
 * Owns the compact, progressively disclosed Cartography controls beside the Compass.
 * It persists layer settings and semantic preset selections without owning the library.
 */
import { resolveCartographyPreset } from "../../shared/cartography-presets.js";
import type { CartographyEvidenceExportResult } from "../../shared/cartography-evidence.js";
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import {
  encodeCartographyPresetRef,
  parseCartographyPresetRef,
  renderCartographyPresetOptions,
} from "../cartography-preset-select.js";
import type { CartographyReachabilityDiagnostic } from "./reachability-kernel.js";
import type { ScreenBox } from "./frame-placement.js";

const COLLAPSE_DELAY_MS = 700;
const CONTROL_SIZE = 30;
const PANEL_WIDTH = 232;
const PANEL_HEIGHT_ESTIMATE = 330;
type OpenMode = "closed" | "transient" | "pinned";
type Layer = "grid" | "walkability";

export type CartographyQaStatus =
  | Readonly<{
      status: "unavailable";
      reason: string;
      kernel: CartographyReachabilityDiagnostic | null;
    }>
  | Readonly<{
      status: "ready";
      continentId: number;
      exploredCreditableCells: number;
      remainingCells: number;
      compassReady: boolean;
      missionMapReady: boolean;
      worldMapReady: boolean;
      currentInstance:
        | Readonly<{ status: "unavailable"; reason: string }>
        | Readonly<{
            status: "ready";
            mapId: number;
            areaEpoch: number;
            resourceGeneration: number;
            terrain: Readonly<{ width: number; height: number; mapUnitsPerPixel: number }>;
            reachableCells: number;
            actionableCells: number;
          }>;
      kernel: CartographyReachabilityDiagnostic | null;
    }>;

type QaPresentation = Readonly<{
  tone: "ready" | "loading" | "unavailable";
  summary: string;
  rows: readonly (readonly [label: string, value: string])[];
}>;

const KERNEL_STATUS = Object.freeze({
  0: "not-published",
  1: "ready",
  2: "invalid-input",
  3: "native-unavailable",
  4: "limit",
  5: "no-start-trapezoid",
  6: "ambiguous-layout",
  7: "plane-limit",
  8: "trapezoid-limit",
  9: "doorway-limit",
  10: "terrain-raster-limit",
}) satisfies Readonly<Record<number, string>>;

function kernelStatus(status: number): string {
  return KERNEL_STATUS[status as keyof typeof KERNEL_STATUS] ?? `status-${status}`;
}

export function describeCartographyQaStatus(status: CartographyQaStatus): QaPresentation {
  if (status.status === "unavailable") {
    const loading = status.reason === "loading";
    const kernel = status.kernel;
    const exactReason = status.reason === "kernel" && kernel !== null
      ? `kernel/${kernelStatus(kernel.status)}`
      : status.reason;
    const rows: (readonly [string, string])[] = [["Reason", exactReason]];
    if (kernel !== null) {
      rows.push(
        ["Map", String(kernel.mapId)],
        ["Epoch", `${kernel.areaEpoch} · resource ${kernel.resourceGeneration}`],
        ["Geometry", `${kernel.reachableTrapezoids}/${kernel.totalTrapezoids} reachable`],
      );
    }
    return Object.freeze({
      tone: loading ? "loading" : "unavailable",
      summary: loading ? "Loading" : `Unavailable · ${exactReason}`,
      rows: Object.freeze(rows),
    });
  }
  const rows: (readonly [string, string])[] = [
    ["Continent", `${status.continentId} · ${status.remainingCells} estimated remaining`],
    ["Coverage", `${status.exploredCreditableCells} explored creditable`],
  ];
  if (status.currentInstance.status === "ready") {
    const current = status.currentInstance;
    rows.push(
      ["Map", String(current.mapId)],
      ["Epoch", `${current.areaEpoch} · resource ${current.resourceGeneration}`],
      ["Cells", `${current.actionableCells} actionable · ${current.reachableCells} reachable`],
      ["Terrain", `${current.terrain.width}×${current.terrain.height} @ ${current.terrain.mapUnitsPerPixel}`],
    );
  } else rows.push(["Current guidance", `Unavailable · ${status.currentInstance.reason}`]);
  rows.push([
    "Surfaces",
    `Compass ${status.compassReady ? "ready" : "off"} · Mission ${status.missionMapReady ? "ready" : "off"} · World ${status.worldMapReady ? "ready" : "off"}`,
  ]);
  return Object.freeze({
    tone: "ready",
    summary: status.currentInstance.status === "ready"
      ? `Ready · ${status.currentInstance.actionableCells} actionable`
      : `Continent ready · ${status.remainingCells} remaining`,
    rows: Object.freeze(rows),
  });
}

export type CartographyOverlayControls = Readonly<{
  update(box: ScreenBox, settings: AppSettings): void;
  updateQaStatus(status: CartographyQaStatus): void;
  hide(): void;
  dispose(): void;
}>;

function layerIcon(document: Document): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("cartography-overlay-icon");
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

export function createCartographyOverlayControls(options: Readonly<{
  parent: HTMLElement;
  persist(patch: RendererSettingsPatch): Promise<AppSettings>;
  previewOpacity(layer: Layer, opacity: number | null): void;
  exportEvidence: (() => Promise<CartographyEvidenceExportResult>) | null;
}>): CartographyOverlayControls {
  const document = options.parent.ownerDocument;
  const view = document.defaultView;
  if (view === null) throw new Error("cartography controls require a live document");
  const root = document.createElement("div");
  root.id = "cartography-overlay-controls";
  root.hidden = true;
  root.style.setProperty("--cartography-control-size", `${CONTROL_SIZE}px`);
  root.style.setProperty("--cartography-panel-width", `${PANEL_WIDTH}px`);
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cartography-overlay-trigger";
  trigger.setAttribute("aria-label", "Cartography layers");
  trigger.setAttribute("aria-expanded", "false");
  trigger.title = "Cartography layers";
  trigger.append(layerIcon(document));
  const panel = document.createElement("div");
  panel.className = "cartography-overlay-panel";
  panel.hidden = true;
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Cartography settings");
  const heading = document.createElement("strong");
  heading.className = "cartography-overlay-heading";
  heading.textContent = "Map layers";
  const layers = document.createElement("div");
  layers.className = "cartography-overlay-layers";
  const layerButton = (label: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cartography-overlay-layer";
    button.textContent = label;
    return button;
  };
  const gridButton = layerButton("Grid");
  const walkabilityButton = layerButton("Walkable");
  layers.append(gridButton, walkabilityButton);
  const fields = document.createElement("div");
  fields.className = "cartography-overlay-fields";
  const makeSlider = (labelText: string) => {
    const row = document.createElement("label");
    row.className = "cartography-overlay-field";
    const label = document.createElement("span");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "range"; input.min = "0"; input.max = "100"; input.step = "1";
    input.setAttribute("aria-label", `${labelText} opacity`);
    const output = document.createElement("output");
    row.append(label, input, output);
    fields.append(row);
    return { input, output };
  };
  const gridOpacity = makeSlider("Grid");
  const walkabilityOpacity = makeSlider("Walkable");
  const presetRow = document.createElement("label");
  presetRow.className = "cartography-overlay-field";
  presetRow.dataset.kind = "preset";
  const presetLabel = document.createElement("span");
  presetLabel.textContent = "Preset";
  const preset = document.createElement("select");
  preset.setAttribute("aria-label", "Cartography preset");
  presetRow.append(presetLabel, preset);
  fields.append(presetRow);
  const hint = document.createElement("p");
  hint.className = "cartography-overlay-hint";
  hint.innerHTML = "Hold <kbd>Shift</kbd> to inspect 3×3. Add <kbd>Option</kbd> for 7×7.";
  const saveStatus = document.createElement("p");
  saveStatus.className = "cartography-overlay-status";
  saveStatus.setAttribute("role", "status");
  saveStatus.setAttribute("aria-live", "polite");
  const qa = document.createElement("details");
  qa.className = "cartography-overlay-qa";
  const qaSummary = document.createElement("summary");
  const qaIndicator = document.createElement("span");
  qaIndicator.className = "cartography-overlay-qa-indicator";
  qaIndicator.setAttribute("aria-hidden", "true");
  const qaLabel = document.createElement("span");
  qaLabel.textContent = "Live evidence";
  const qaValue = document.createElement("strong");
  qaValue.textContent = "Waiting";
  qaSummary.append(qaIndicator, qaLabel, qaValue);
  const qaRows = document.createElement("dl");
  qaRows.className = "cartography-overlay-qa-rows";
  const exportButton = document.createElement("button");
  const exportEvidence = options.exportEvidence;
  exportButton.type = "button";
  exportButton.className = "cartography-overlay-export";
  exportButton.textContent = "Export Cartography Evidence";
  exportButton.hidden = exportEvidence === null;
  const exportStatus = document.createElement("p");
  exportStatus.className = "cartography-overlay-export-status";
  exportStatus.setAttribute("role", "status");
  exportStatus.setAttribute("aria-live", "polite");
  qa.append(qaSummary, qaRows, exportButton, exportStatus);
  panel.append(heading, layers, fields, hint, saveStatus, qa);
  root.append(trigger, panel);
  options.parent.append(root);

  let canonical: AppSettings | null = null;
  let saving = false;
  let exporting = false;
  let disposed = false;
  let mode: OpenMode = "closed";
  let collapseTimer = 0;
  let latestBox: ScreenBox | null = null;
  let renderedLibrary: AppSettings["cartographyPresetLibrary"] | null = null;
  let renderedSettings: AppSettings | null = null;
  let panelHeight = PANEL_HEIGHT_ESTIMATE;
  const currentSettings = (): AppSettings | null => canonical;
  const setSaving = (value: boolean): void => {
    saving = value;
    for (const control of [gridButton, walkabilityButton, gridOpacity.input,
      walkabilityOpacity.input, preset]) control.disabled = value;
  };
  const renderPresetOptions = (settings: AppSettings): void => {
    if (renderedLibrary === settings.cartographyPresetLibrary) return;
    renderedLibrary = settings.cartographyPresetLibrary;
    renderCartographyPresetOptions(preset, settings.cartographyPresetLibrary);
  };
  const sync = (force = false): void => {
    const settings = currentSettings();
    if (settings === null || (!force && renderedSettings === settings)) return;
    renderedSettings = settings;
    gridButton.setAttribute("aria-pressed", String(settings.cartographyGridEnabled));
    walkabilityButton.setAttribute("aria-pressed", String(settings.cartographyOverlayEnabled));
    if (document.activeElement !== gridOpacity.input) gridOpacity.input.value = String(settings.cartographyGridOpacity);
    if (document.activeElement !== walkabilityOpacity.input) walkabilityOpacity.input.value = String(settings.cartographyWalkabilityOpacity);
    gridOpacity.output.value = `${gridOpacity.input.value}%`;
    walkabilityOpacity.output.value = `${walkabilityOpacity.input.value}%`;
    renderPresetOptions(settings);
    preset.value = encodeCartographyPresetRef(settings.cartographyPresetLibrary.activePreset);
    const style = resolveCartographyPreset(settings.cartographyPresetLibrary);
    if (style === null) return;
    root.style.setProperty("--cartography-trigger-border", style.walkability.boundaryColor);
    root.style.setProperty("--cartography-trigger-color", style.grid.current.color);
  };
  const positionPanel = (): void => {
    if (latestBox === null || mode === "closed") return;
    const margin = 6;
    const rootTop = Number.parseFloat(root.style.top) || margin;
    panel.style.top = `${Math.round(Math.max(margin, Math.min(view.innerHeight - panelHeight - margin, rootTop + (CONTROL_SIZE - panelHeight) / 2)) - rootTop)}px`;
  };
  const setMode = (next: OpenMode): void => {
    mode = next;
    panel.hidden = next === "closed";
    trigger.setAttribute("aria-expanded", String(next !== "closed"));
    if (next === "closed") {
      options.previewOpacity("grid", null);
      options.previewOpacity("walkability", null);
    } else positionPanel();
    root.style.opacity = next === "closed"
      ? String((currentSettings()?.cartographyControlIdleOpacity ?? 35) / 100) : "1";
  };
  const panelResizeObserver = typeof view.ResizeObserver === "function"
    ? new view.ResizeObserver((entries) => {
      const entry = entries[0];
      const measured = entry?.borderBoxSize[0]?.blockSize
        ?? entry?.contentRect.height;
      if (measured !== undefined && measured > 0 && measured !== panelHeight) {
        panelHeight = measured;
        positionPanel();
      }
    })
    : null;
  panelResizeObserver?.observe(panel);
  const cancelCollapse = (): void => {
    if (collapseTimer !== 0) view.clearTimeout(collapseTimer);
    collapseTimer = 0;
  };
  const scheduleCollapse = (): void => {
    if (mode !== "transient") return;
    cancelCollapse();
    collapseTimer = view.setTimeout(() => {
      collapseTimer = 0;
      if (!root.matches(":hover") && !root.contains(document.activeElement)) setMode("closed");
    }, COLLAPSE_DELAY_MS);
  };
  const apply = (patch: RendererSettingsPatch): void => {
    const current = currentSettings();
    if (current === null || saving) return;
    setSaving(true);
    saveStatus.textContent = "Saving…";
    void options.persist(patch).then((saved) => {
      if (disposed) return;
      canonical = saved;
      saveStatus.textContent = "Saved";
      setSaving(false);
      sync(true);
    }, () => {
      if (disposed) return;
      saveStatus.textContent = "Could not save";
      setSaving(false);
      sync(true);
    });
  };
  for (const type of ["pointerdown", "pointerup", "click", "wheel", "keydown", "keyup"]) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }
  root.addEventListener("pointerenter", () => {
    cancelCollapse();
    if (mode === "closed") setMode("transient");
  });
  root.addEventListener("pointerleave", scheduleCollapse);
  root.addEventListener("focusin", () => {
    cancelCollapse();
    if (mode === "closed") setMode("transient");
  });
  root.addEventListener("focusout", scheduleCollapse);
  trigger.addEventListener("click", () => setMode(mode === "pinned" ? "closed" : "pinned"));
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || mode === "closed") return;
    event.preventDefault();
    setMode("closed");
    trigger.focus();
  });
  const outsidePointerDown = (event: Event): void => {
    if (mode === "pinned" && event.target instanceof Node && !root.contains(event.target)) setMode("closed");
  };
  document.addEventListener("pointerdown", outsidePointerDown);
  gridButton.addEventListener("click", () => {
    const settings = currentSettings();
    if (settings !== null) apply({ cartographyGridEnabled: !settings.cartographyGridEnabled });
  });
  walkabilityButton.addEventListener("click", () => {
    const settings = currentSettings();
    if (settings !== null) apply({ cartographyOverlayEnabled: !settings.cartographyOverlayEnabled });
  });
  const bindSlider = (layer: Layer, controls: ReturnType<typeof makeSlider>, key: "cartographyGridOpacity" | "cartographyWalkabilityOpacity") => {
    controls.input.addEventListener("input", () => {
      controls.output.value = `${controls.input.value}%`;
      options.previewOpacity(layer, Number(controls.input.value));
    });
    controls.input.addEventListener("change", () => {
      options.previewOpacity(layer, null);
      apply({ [key]: Number(controls.input.value) });
    });
  };
  bindSlider("grid", gridOpacity, "cartographyGridOpacity");
  bindSlider("walkability", walkabilityOpacity, "cartographyWalkabilityOpacity");
  preset.addEventListener("change", () => {
    const settings = currentSettings();
    const activePreset = settings === null ? null
      : parseCartographyPresetRef(preset.value, settings.cartographyPresetLibrary);
    if (settings !== null && activePreset !== null) {
      apply({ cartographyPresetSelection: activePreset });
    }
  });
  exportButton.addEventListener("click", () => {
    if (exportEvidence === null || exporting) return;
    exporting = true;
    exportButton.disabled = true;
    exportStatus.textContent = "Preparing evidence…";
    void exportEvidence().then((result) => {
      if (disposed) return;
      exportStatus.textContent = result.status === "written"
        ? "Evidence exported"
        : result.status === "cancelled"
          ? "Export cancelled"
          : `Export unavailable · ${result.reason}`;
    }, () => {
      if (!disposed) exportStatus.textContent = "Could not export evidence";
    }).finally(() => {
      if (disposed) return;
      exporting = false;
      exportButton.disabled = false;
    });
  });
  const hide = (): void => {
    cancelCollapse();
    setMode("closed");
    root.hidden = true;
    latestBox = null;
    canonical = null;
    renderedLibrary = null;
    renderedSettings = null;
  };
  const positionRoot = (): void => {
    const box = latestBox;
    if (box === null) return;
    const gap = 5;
    const margin = 6;
    const roomLeft = box.left >= PANEL_WIDTH + CONTROL_SIZE + gap + margin;
    const roomRight = box.left + box.width + PANEL_WIDTH + CONTROL_SIZE + gap + margin <= view.innerWidth;
    const onLeft = roomLeft || !roomRight;
    const left = onLeft ? Math.max(margin, box.left - CONTROL_SIZE - gap)
      : Math.min(view.innerWidth - CONTROL_SIZE - margin, box.left + box.width + gap);
    const top = Math.max(margin, Math.min(view.innerHeight - CONTROL_SIZE - margin,
      box.top + Math.max(0, (box.height - CONTROL_SIZE) / 2)));
    panel.style.left = onLeft ? "auto" : `${CONTROL_SIZE + gap}px`;
    panel.style.right = onLeft ? `${CONTROL_SIZE + gap}px` : "auto";
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    positionPanel();
  };
  const viewportResize = (): void => positionRoot();
  view.addEventListener("resize", viewportResize);

  return Object.freeze({
    update(box, settings) {
      if (resolveCartographyPreset(settings.cartographyPresetLibrary) === null) {
        hide();
        return;
      }
      const boxChanged = latestBox === null
        || latestBox.left !== box.left || latestBox.top !== box.top
        || latestBox.width !== box.width || latestBox.height !== box.height;
      if (boxChanged) latestBox = { ...box };
      if (canonical !== settings) {
        canonical = settings;
        sync();
        if (mode === "closed") {
          root.style.opacity = String(settings.cartographyControlIdleOpacity / 100);
        }
      }
      const becameVisible = root.hidden;
      root.hidden = false;
      if (boxChanged || becameVisible) positionRoot();
    },
    updateQaStatus(status) {
      const presentation = describeCartographyQaStatus(status);
      qa.dataset.tone = presentation.tone;
      qaValue.textContent = presentation.summary;
      qaRows.replaceChildren(...presentation.rows.flatMap(([label, value]) => {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = value;
        return [term, description];
      }));
    },
    hide,
    dispose() {
      disposed = true;
      cancelCollapse();
      panelResizeObserver?.disconnect();
      document.removeEventListener("pointerdown", outsidePointerDown);
      view.removeEventListener("resize", viewportResize);
      root.remove();
    },
  });
}
