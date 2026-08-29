/**
 * Owns the progressively disclosed editor for one player-owned map preset.
 * It derives every line and marker control from the shared closed vocabularies.
 */
import {
  CARTOGRAPHY_LINE_PATTERNS,
  CARTOGRAPHY_UNSEEN_MARKERS,
  normaliseCartographyPresetStyle,
  type CartographyColor,
  type CartographyGridStyle,
  type CartographyLineStyle,
  type CartographyPresetStyle,
  type CartographyUnseenMarker,
} from "../shared/cartography-overlay.js";

type LineKey = keyof Pick<
  CartographyGridStyle,
  "lattice" | "current" | "hover" | "normalRange" | "birdsEyeRange"
>;

type LineControls = Readonly<{
  colorPicker: HTMLInputElement;
  color: HTMLInputElement;
  width: HTMLInputElement;
  widthValue: HTMLOutputElement;
  pattern: HTMLSelectElement;
}>;

const LINE_DESCRIPTORS = [
  ["lattice", "Grid lines"],
  ["current", "Current cell"],
  ["hover", "Hovered cell"],
  ["normalRange", "Normal 3×3 range"],
  ["birdsEyeRange", "Bird’s Eye 7×7 range"],
] as const satisfies readonly (readonly [LineKey, string])[];
const PATTERN_LABELS = Object.freeze({
  solid: "Solid",
  dashed: "Dashed",
  dotted: "Dotted",
  "dash-dot": "Dash-dot",
}) satisfies Readonly<Record<(typeof CARTOGRAPHY_LINE_PATTERNS)[number], string>>;
const MARKER_PRESENTATION = Object.freeze({
  corners: { symbol: "⌜⌟", label: "Corners" },
  cross: { symbol: "×", label: "Cross" },
  diamond: { symbol: "◇", label: "Diamond" },
  stipple: { symbol: "•••", label: "Stipple" },
  hatch: { symbol: "╱╱", label: "Hatch" },
}) satisfies Readonly<Record<CartographyUnseenMarker, Readonly<{
  symbol: string;
  label: string;
}>>>;

export type CartographyPresetEditor = Readonly<{
  render(style: CartographyPresetStyle): void;
}>;

const HEX = /^#[0-9A-F]{6}$/;

function element<T extends Element>(root: ParentNode, selector: string): T {
  const value = root.querySelector<T>(selector);
  if (value === null) throw new Error(`missing cartography editor control: ${selector}`);
  return value;
}

function byName<T extends HTMLElement>(form: HTMLFormElement, name: string): T {
  const value = form.elements.namedItem(name);
  if (!(value instanceof HTMLElement)) throw new Error(`missing cartography control: ${name}`);
  return value as T;
}

function lineControls(root: HTMLElement): LineControls {
  return Object.freeze({
    colorPicker: element<HTMLInputElement>(root, "[data-line-color-picker]"),
    color: element<HTMLInputElement>(root, "[data-line-color]"),
    width: element<HTMLInputElement>(root, "[data-line-width]"),
    widthValue: element<HTMLOutputElement>(root, "[data-line-width-value]"),
    pattern: element<HTMLSelectElement>(root, "[data-line-pattern]"),
  });
}

function setColorValidity(input: HTMLInputElement): CartographyColor | null {
  const value = input.value.trim().toUpperCase();
  const valid = HEX.test(value);
  input.setCustomValidity(valid ? "" : "Use a six-digit color, for example #56B4E9.");
  input.toggleAttribute("aria-invalid", !valid);
  return valid ? value as CartographyColor : null;
}

export function createCartographyPresetEditor(options: Readonly<{
  form: HTMLFormElement;
  change(style: CartographyPresetStyle, commit: boolean): void;
}>): CartographyPresetEditor {
  const lineTemplate = element<HTMLTemplateElement>(
    options.form,
    "#settings-cartography-line-template",
  );
  const lines = new Map<LineKey, LineControls>();
  for (const [key, title] of LINE_DESCRIPTORS) {
    const root = element<HTMLElement>(options.form, `[data-cartography-line="${key}"]`);
    root.append(lineTemplate.content.cloneNode(true));
    element<HTMLElement>(root, "[data-line-title]").textContent = title;
    const controls = lineControls(root);
    for (const pattern of CARTOGRAPHY_LINE_PATTERNS) {
      const option = options.form.ownerDocument.createElement("option");
      option.value = pattern;
      option.textContent = PATTERN_LABELS[pattern];
      controls.pattern.append(option);
    }
    lines.set(key, controls);
  }

  const gridCasingPicker = byName<HTMLInputElement>(options.form, "cartographyGridCasingColorPicker");
  const gridCasing = byName<HTMLInputElement>(options.form, "cartographyGridCasingColor");
  const unseenPicker = byName<HTMLInputElement>(options.form, "cartographyUnseenColorPicker");
  const unseenColor = byName<HTMLInputElement>(options.form, "cartographyUnseenColor");
  const markerList = element<HTMLElement>(options.form, ".settings-cartography-marker-list");
  for (const marker of CARTOGRAPHY_UNSEEN_MARKERS) {
    const label = options.form.ownerDocument.createElement("label");
    const input = options.form.ownerDocument.createElement("input");
    input.type = "radio";
    input.name = "cartographyUnseenMarker";
    input.value = marker;
    const symbol = options.form.ownerDocument.createElement("span");
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = MARKER_PRESENTATION[marker].symbol;
    const name = options.form.ownerDocument.createElement("strong");
    name.textContent = MARKER_PRESENTATION[marker].label;
    label.append(input, symbol, name);
    markerList.append(label);
  }
  const markerChoices = [...markerList.querySelectorAll<HTMLInputElement>(
    'input[name="cartographyUnseenMarker"]',
  )];
  const veilPicker = byName<HTMLInputElement>(options.form, "cartographyVeilColorPicker");
  const veil = byName<HTMLInputElement>(options.form, "cartographyVeilColor");
  const boundaryPicker = byName<HTMLInputElement>(options.form, "cartographyBoundaryColorPicker");
  const boundary = byName<HTMLInputElement>(options.form, "cartographyBoundaryColor");
  const boundaryCasingPicker = byName<HTMLInputElement>(
    options.form,
    "cartographyBoundaryCasingColorPicker",
  );
  const boundaryCasing = byName<HTMLInputElement>(options.form, "cartographyBoundaryCasingColor");
  const boundaryWidth = byName<HTMLInputElement>(options.form, "cartographyBoundaryWidth");
  const boundaryWidthValue = byName<HTMLOutputElement>(
    options.form,
    "cartographyBoundaryWidthValue",
  );
  let draft: CartographyPresetStyle | null = null;

  const publish = (candidate: CartographyPresetStyle, commit: boolean): void => {
    const normalised = normaliseCartographyPresetStyle(candidate);
    if (normalised === null) return;
    draft = normalised;
    options.change(normalised, commit);
  };
  const updateLine = (
    key: LineKey,
    patch: Partial<CartographyLineStyle>,
    commit: boolean,
  ): void => {
    if (draft === null) return;
    publish({
      ...draft,
      grid: { ...draft.grid, [key]: { ...draft.grid[key], ...patch } },
    }, commit);
  };
  const updateGrid = (patch: Partial<CartographyGridStyle>, commit: boolean): void => {
    if (draft === null) return;
    publish({ ...draft, grid: { ...draft.grid, ...patch } }, commit);
  };
  const updateWalkability = (
    patch: Partial<CartographyPresetStyle["walkability"]>,
    commit: boolean,
  ): void => {
    if (draft === null) return;
    publish({ ...draft, walkability: { ...draft.walkability, ...patch } }, commit);
  };
  for (const [key, controls] of lines) {
    controls.colorPicker.addEventListener("input", () => {
      controls.color.value = controls.colorPicker.value.toUpperCase();
      updateLine(key, { color: controls.color.value as CartographyColor }, false);
    });
    controls.colorPicker.addEventListener("change", () => {
      updateLine(key, { color: controls.colorPicker.value.toUpperCase() as CartographyColor }, true);
    });
    controls.color.addEventListener("input", () => {
      const color = setColorValidity(controls.color);
      if (color !== null) {
        controls.colorPicker.value = color;
        updateLine(key, { color }, false);
      }
    });
    controls.color.addEventListener("change", () => {
      const color = setColorValidity(controls.color);
      if (color !== null) updateLine(key, { color }, true);
    });
    controls.width.addEventListener("input", () => {
      controls.widthValue.value = `${controls.width.value} px`;
      updateLine(key, { width: Number(controls.width.value) }, false);
    });
    controls.width.addEventListener("change", () => {
      updateLine(key, { width: Number(controls.width.value) }, true);
    });
    controls.pattern.addEventListener("change", () => {
      const pattern = CARTOGRAPHY_LINE_PATTERNS.find((value) => value === controls.pattern.value);
      if (pattern !== undefined) updateLine(key, { pattern }, true);
    });
  }

  const bindColor = (
    picker: HTMLInputElement,
    text: HTMLInputElement,
    change: (color: CartographyColor, commit: boolean) => void,
  ): void => {
    picker.addEventListener("input", () => {
      text.value = picker.value.toUpperCase();
      change(text.value as CartographyColor, false);
    });
    picker.addEventListener("change", () => change(picker.value.toUpperCase() as CartographyColor, true));
    text.addEventListener("input", () => {
      const color = setColorValidity(text);
      if (color !== null) {
        picker.value = color;
        change(color, false);
      }
    });
    text.addEventListener("change", () => {
      const color = setColorValidity(text);
      if (color !== null) change(color, true);
    });
  };
  bindColor(gridCasingPicker, gridCasing, (casingColor, commit) => {
    updateGrid({ casingColor }, commit);
  });
  bindColor(unseenPicker, unseenColor, (color, commit) => {
    if (draft !== null) updateGrid({ unseen: { ...draft.grid.unseen, color } }, commit);
  });
  bindColor(veilPicker, veil, (veilColor, commit) => updateWalkability({ veilColor }, commit));
  bindColor(boundaryPicker, boundary, (boundaryColor, commit) => {
    updateWalkability({ boundaryColor }, commit);
  });
  bindColor(boundaryCasingPicker, boundaryCasing, (boundaryCasingColor, commit) => {
    updateWalkability({ boundaryCasingColor }, commit);
  });
  markerChoices.forEach((choice) => choice.addEventListener("change", () => {
    if (!choice.checked || draft === null) return;
    const marker = CARTOGRAPHY_UNSEEN_MARKERS.find((value) => value === choice.value);
    if (marker !== undefined) {
      updateGrid({ unseen: { ...draft.grid.unseen, marker } }, true);
    }
  }));
  boundaryWidth.addEventListener("input", () => {
    boundaryWidthValue.value = `${boundaryWidth.value} px`;
    updateWalkability({ boundaryWidth: Number(boundaryWidth.value) }, false);
  });
  boundaryWidth.addEventListener("change", () => {
    updateWalkability({ boundaryWidth: Number(boundaryWidth.value) }, true);
  });

  const renderColor = (picker: HTMLInputElement, text: HTMLInputElement, color: string): void => {
    picker.value = color;
    text.value = color;
    setColorValidity(text);
  };
  return Object.freeze({
    render(style) {
      draft = style;
      for (const [key, controls] of lines) {
        const line = style.grid[key];
        renderColor(controls.colorPicker, controls.color, line.color);
        controls.width.value = String(line.width);
        controls.widthValue.value = `${line.width} px`;
        controls.pattern.value = line.pattern;
      }
      renderColor(gridCasingPicker, gridCasing, style.grid.casingColor);
      renderColor(unseenPicker, unseenColor, style.grid.unseen.color);
      markerChoices.forEach((choice) => {
        choice.checked = choice.value === style.grid.unseen.marker;
      });
      renderColor(veilPicker, veil, style.walkability.veilColor);
      renderColor(boundaryPicker, boundary, style.walkability.boundaryColor);
      renderColor(
        boundaryCasingPicker,
        boundaryCasing,
        style.walkability.boundaryCasingColor,
      );
      boundaryWidth.value = String(style.walkability.boundaryWidth);
      boundaryWidthValue.value = `${style.walkability.boundaryWidth} px`;
    },
  });
}
