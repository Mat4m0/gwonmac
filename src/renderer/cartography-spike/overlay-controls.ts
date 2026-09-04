/**
 * Owns the compact, progressively disclosed Cartography controls beside the Compass.
 * It persists layer settings and semantic preset selections without owning the library.
 */
import { resolveCartographyPreset } from "../../shared/cartography-presets.js";
import type { CartographyEvidenceExportResult } from "../../shared/cartography-evidence.js";
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import type { WorldMapFrameSpikeDiagnostic } from "../../shared/cartography-spike.js";
import {
  encodeCartographyPresetRef,
  parseCartographyPresetRef,
  renderCartographyPresetOptions,
} from "../cartography-preset-select.js";
import type { CartographyReachabilityDiagnostic } from "./reachability-kernel.js";
import type { ScreenBox } from "./frame-placement.js";
import {
  COMPASS_CONTROL_GAP,
  COMPASS_CONTROL_OPEN_EVENT,
  COMPASS_CONTROL_SIZE,
  projectCompassControlPosition,
  type CompassControlPlacement,
} from "./compass-control-placement.js";

const PANEL_WIDTH = 204;
const PANEL_HEIGHT_ESTIMATE = 230;
const SAVE_CONFIRMATION_MS = 1_200;
type Layer = "grid" | "walkability";

export type CartographyQaStatus = Readonly<{
  continent:
    | Readonly<{ status: "unavailable"; reason: string }>
    | Readonly<{
        status: "ready";
        continentId: number;
        exploredCreditableCells: number;
        remainingCells: number;
      }>;
  currentInstance:
    | Readonly<{ status: "unavailable"; reason: string }>
    | Readonly<{
        status: "ready";
        sequence: number;
        mapId: number;
        areaEpoch: number;
        resourceGeneration: number;
        terrain: Readonly<{ width: number; height: number; mapUnitsPerPixel: number }>;
        reachableCells: number;
        guidance:
          | Readonly<{ status: "unavailable"; reason: string }>
          | Readonly<{ status: "ready"; actionableCells: number }>;
      }>;
  compassReady: boolean;
  missionMapReady: boolean;
  worldMapReady: boolean;
  worldMapObserver: WorldMapFrameSpikeDiagnostic;
  kernel: CartographyReachabilityDiagnostic | null;
}>;

type QaPresentation = Readonly<{
  tone: "ready" | "limited" | "loading" | "unavailable";
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

const WORLD_MAP_STATUS = Object.freeze({
  0: "not-published",
  1: "ready",
  2: "event-owner",
  3: "context-owner",
  4: "world-context",
  5: "frame-index",
  7: "continent",
  8: "viewport-values",
  9: "viewport-span",
  10: "frame-pointer",
}) satisfies Readonly<Record<number, string>>;

function worldMapStatus(value: WorldMapFrameSpikeDiagnostic): string {
  const reason = WORLD_MAP_STATUS[value.status as keyof typeof WORLD_MAP_STATUS]
    ?? `status-${value.status ?? "missing"}`;
  return `${reason} · frame ${value.frameId ?? "?"} · generation ${value.generation ?? "?"}`;
}

export function describeCartographyQaStatus(status: CartographyQaStatus): QaPresentation {
  const continent = status.continent;
  const current = status.currentInstance;
  const limited = continent.status === "unavailable"
    && continent.reason === "unsupported-area";
  if (continent.status === "unavailable" && current.status === "unavailable") {
    const reason = limited ? current.reason : continent.reason;
    const loading = reason === "loading";
    const kernel = status.kernel;
    const exactReason = reason === "kernel" && kernel !== null
      ? `kernel/${kernelStatus(kernel.status)}`
      : reason;
    const rows: (readonly [string, string])[] = [
      ...(limited ? [["Grid", "Unavailable in this area"]] as const : []),
      ["Reason", exactReason],
      ["World observer", worldMapStatus(status.worldMapObserver)],
    ];
    if (kernel !== null) {
      rows.push(
        ["Map", String(kernel.mapId)],
        ["Epoch", `${kernel.areaEpoch} · resource ${kernel.resourceGeneration}`],
        ["Geometry", `${kernel.reachableTrapezoids}/${kernel.totalTrapezoids} reachable`],
      );
    }
    return Object.freeze({
      tone: loading ? "loading" : "unavailable",
      summary: loading ? "Loading" : limited
        ? "Limited · Walkable unavailable"
        : `Unavailable · ${exactReason}`,
      rows: Object.freeze(rows),
    });
  }
  const rows: (readonly [string, string])[] = [];
  if (continent.status === "ready") {
    rows.push(
      ["Continent", `${continent.continentId} · ${continent.remainingCells} estimated remaining`],
      ["Coverage", `${continent.exploredCreditableCells} explored creditable`],
    );
  } else rows.push(["Grid", "Unavailable in this area"]);
  if (current.status === "ready") {
    rows.push(
      ["Map", String(current.mapId)],
      ["Epoch", `${current.areaEpoch} · resource ${current.resourceGeneration}`],
      ["Terrain", `${current.terrain.width}×${current.terrain.height} @ ${current.terrain.mapUnitsPerPixel}`],
    );
    rows.push(current.guidance.status === "ready"
      ? ["Guidance", `${current.guidance.actionableCells} targets here · ${current.reachableCells} reachable cells`]
      : ["Guidance", `Unavailable · ${current.guidance.reason}`]);
  } else rows.push(["Walkable", `Unavailable · ${current.reason}`]);
  rows.push([
    "Surfaces",
    `Compass ${status.compassReady ? "ready" : "off"} · Mission ${status.missionMapReady ? "ready" : "off"} · World ${status.worldMapReady ? "ready" : "off"}`,
  ]);
  rows.push(["World observer", worldMapStatus(status.worldMapObserver)]);
  return Object.freeze({
    tone: limited ? "limited" : "ready",
    summary: limited
      ? "Limited · Walkable terrain ready"
      : current.status === "ready" && current.guidance.status === "ready"
        ? `Ready · ${current.guidance.actionableCells} targets here`
        : continent.status === "ready"
          ? `Continent ready · ${continent.remainingCells} remaining`
          : "Walkable terrain ready",
    rows: Object.freeze(rows),
  });
}

export type CartographyOverlayControls = Readonly<{
  update(
    box: ScreenBox,
    settings: AppSettings,
    placement: CompassControlPlacement,
  ): void;
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
  root.style.setProperty("--cartography-control-size", `${COMPASS_CONTROL_SIZE}px`);
  root.style.setProperty("--cartography-panel-width", `${PANEL_WIDTH}px`);
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cartography-overlay-trigger";
  trigger.setAttribute("aria-label", "Cartography layers");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "cartography-overlay-panel");
  trigger.title = "Cartography layers";
  trigger.append(layerIcon(document));
  const panel = document.createElement("div");
  panel.id = "cartography-overlay-panel";
  panel.className = "cartography-overlay-panel";
  panel.hidden = true;
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Cartography settings");
  const heading = document.createElement("strong");
  heading.className = "cartography-overlay-heading";
  heading.textContent = "Map layers";
  const availabilityNotice = document.createElement("p");
  availabilityNotice.className = "cartography-overlay-availability";
  availabilityNotice.hidden = true;
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
  panel.append(heading, availabilityNotice, layers, fields, saveStatus, qa);
  root.append(trigger, panel);
  options.parent.append(root);

  let canonical: AppSettings | null = null;
  let saving = false;
  let gridAvailable = false;
  let exporting = false;
  let disposed = false;
  let open = false;
  let saveStatusTimer = 0;
  let latestBox: ScreenBox | null = null;
  let latestPlacement: CompassControlPlacement = { index: 0, count: 1 };
  let renderedLibrary: AppSettings["cartographyPresetLibrary"] | null = null;
  let renderedSettings: AppSettings | null = null;
  let panelHeight = PANEL_HEIGHT_ESTIMATE;
  const currentSettings = (): AppSettings | null => canonical;
  const syncDisabled = (): void => {
    gridButton.disabled = saving || !gridAvailable;
    gridOpacity.input.disabled = saving || !gridAvailable;
    for (const control of [walkabilityButton, walkabilityOpacity.input, preset]) {
      control.disabled = saving;
    }
  };
  const setSaving = (value: boolean): void => {
    saving = value;
    syncDisabled();
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
    if (latestBox === null || !open) return;
    const margin = 6;
    const rootTop = Number.parseFloat(root.style.top) || margin;
    panel.style.top = `${Math.round(Math.max(margin, Math.min(view.innerHeight - panelHeight - margin, rootTop + (COMPASS_CONTROL_SIZE - panelHeight) / 2)) - rootTop)}px`;
  };
  const setOpen = (next: boolean): void => {
    if (next && !open) {
      document.dispatchEvent(new CustomEvent(COMPASS_CONTROL_OPEN_EVENT, {
        detail: "cartography",
      }));
    }
    open = next;
    panel.hidden = !next;
    trigger.setAttribute("aria-expanded", String(next));
    if (!next) {
      options.previewOpacity("grid", null);
      options.previewOpacity("walkability", null);
    } else positionPanel();
    root.style.opacity = !next
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
  const clearSaveStatusTimer = (): void => {
    if (saveStatusTimer !== 0) view.clearTimeout(saveStatusTimer);
    saveStatusTimer = 0;
  };
  const apply = (patch: RendererSettingsPatch): void => {
    const current = currentSettings();
    if (current === null || saving) return;
    clearSaveStatusTimer();
    setSaving(true);
    saveStatus.textContent = "Saving…";
    void options.persist(patch).then((saved) => {
      if (disposed) return;
      canonical = saved;
      saveStatus.textContent = "Saved";
      saveStatusTimer = view.setTimeout(() => {
        saveStatusTimer = 0;
        saveStatus.textContent = "";
      }, SAVE_CONFIRMATION_MS);
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
  trigger.addEventListener("click", () => setOpen(!open));
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    setOpen(false);
    trigger.focus();
  });
  const outsidePointerDown = (event: Event): void => {
    if (open && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
  };
  document.addEventListener("pointerdown", outsidePointerDown);
  const otherControlOpened = (event: Event): void => {
    if (event instanceof CustomEvent && event.detail !== "cartography") setOpen(false);
  };
  document.addEventListener(COMPASS_CONTROL_OPEN_EVENT, otherControlOpened);
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
    setOpen(false);
    root.hidden = true;
    latestBox = null;
    canonical = null;
    renderedLibrary = null;
    renderedSettings = null;
  };
  const positionRoot = (): void => {
    const box = latestBox;
    if (box === null) return;
    const position = projectCompassControlPosition(
      box,
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
      if (resolveCartographyPreset(settings.cartographyPresetLibrary) === null) {
        hide();
        return;
      }
      const boxChanged = latestBox === null
        || latestBox.left !== box.left || latestBox.top !== box.top
        || latestBox.width !== box.width || latestBox.height !== box.height;
      if (boxChanged) latestBox = { ...box };
      const placementChanged = latestPlacement.index !== placement.index
        || latestPlacement.count !== placement.count;
      if (placementChanged) latestPlacement = { ...placement };
      if (canonical !== settings) {
        canonical = settings;
        sync();
        if (!open) {
          root.style.opacity = String(settings.cartographyControlIdleOpacity / 100);
        }
      }
      const becameVisible = root.hidden;
      root.hidden = false;
      if (boxChanged || placementChanged || becameVisible) positionRoot();
    },
    updateQaStatus(status) {
      const presentation = describeCartographyQaStatus(status);
      gridAvailable = status.continent.status === "ready";
      const limited = status.continent.status === "unavailable"
        && status.continent.reason === "unsupported-area";
      availabilityNotice.hidden = !limited;
      availabilityNotice.textContent = limited
        ? status.currentInstance.status === "ready"
          ? "Limited in this area. Cartography progress and guidance are unavailable. Walkable terrain is still available."
          : "Limited in this area. Cartography progress and guidance are unavailable, and walkable terrain could not be loaded."
        : "";
      gridButton.title = gridAvailable ? "" : limited
        ? "Grid and progress are unavailable in this area"
        : "Grid is temporarily unavailable";
      gridOpacity.input.title = gridButton.title;
      syncDisabled();
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
      clearSaveStatusTimer();
      panelResizeObserver?.disconnect();
      document.removeEventListener("pointerdown", outsidePointerDown);
      document.removeEventListener(COMPASS_CONTROL_OPEN_EVENT, otherControlOpened);
      view.removeEventListener("resize", viewportResize);
      root.remove();
    },
  });
}
