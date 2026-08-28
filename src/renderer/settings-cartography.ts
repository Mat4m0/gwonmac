/**
 * Binds the canonical Maps settings to previews and strict persisted values.
 * Keeps custom-color editing and preset selection on that single settings contract.
 */
import {
  CARTOGRAPHY_OVERLAY_BUILTIN_STYLES,
  CARTOGRAPHY_OVERLAY_STYLE_IDS,
  cartographyOverlayStyle,
  isCartographyOverlayHex,
  normaliseCartographyOverlayStyle,
  type CartographyOverlayStyle,
  type CartographyOverlayStyleId,
} from "../shared/cartography-overlay.js";
import type { AppSettings } from "../shared/contracts.js";

type FeedbackTone = "neutral" | "progress" | "success" | "warning" | "error";

export function bindCartographySettings(options: Readonly<{
  form: HTMLFormElement;
  persist(patch: Partial<Pick<
    AppSettings,
    | "cartographyOverlayStyle"
    | "cartographyOverlayOpacity"
    | "cartographyControlIdleOpacity"
    | "cartographyOverlayCustomStyle"
  >>): Promise<unknown>;
  recoverAfterPersistFailure(message: string): Promise<void>;
  feedback(message: string, tone: FeedbackTone, resetAfter?: number): void;
}>) {
  const byName = <T extends HTMLElement>(name: string): T => {
    const element = options.form.elements.namedItem(name);
    if (!(element instanceof HTMLElement)) throw new Error(`missing cartography control: ${name}`);
    return element as T;
  };
  const panel = options.form.querySelector<HTMLElement>("#settings-cartography-options");
  const custom = options.form.querySelector<HTMLFieldSetElement>("#settings-cartography-custom");
  const editCustom = options.form.querySelector<HTMLButtonElement>("#settings-cartography-edit-custom");
  const preview = options.form.querySelector<HTMLElement>(".settings-cartography-preview");
  if (!panel || !custom || !editCustom || !preview) throw new Error("incomplete cartography settings");
  const choices = [...options.form.querySelectorAll<HTMLInputElement>(
    'input[name="cartographyOverlayStyleChoice"]',
  )];
  const opacity = byName<HTMLInputElement>("cartographyOverlayOpacity");
  const opacityValue = byName<HTMLOutputElement>("cartographyOverlayOpacityValue");
  const controlOpacity = byName<HTMLInputElement>("cartographyControlIdleOpacity");
  const controlOpacityValue = byName<HTMLOutputElement>("cartographyControlIdleOpacityValue");
  const veilPicker = byName<HTMLInputElement>("cartographyVeilPicker");
  const veilHex = byName<HTMLInputElement>("cartographyVeilHex");
  const outlinePicker = byName<HTMLInputElement>("cartographyOutlinePicker");
  const outlineHex = byName<HTMLInputElement>("cartographyOutlineHex");
  const gridPicker = byName<HTMLInputElement>("cartographyGridPicker");
  const gridHex = byName<HTMLInputElement>("cartographyGridHex");
  const missingPicker = byName<HTMLInputElement>("cartographyMissingPicker");
  const missingHex = byName<HTMLInputElement>("cartographyMissingHex");
  const currentPicker = byName<HTMLInputElement>("cartographyCurrentPicker");
  const currentHex = byName<HTMLInputElement>("cartographyCurrentHex");
  const hoverPicker = byName<HTMLInputElement>("cartographyHoverPicker");
  const hoverHex = byName<HTMLInputElement>("cartographyHoverHex");
  const normalRangePicker = byName<HTMLInputElement>("cartographyNormalRangePicker");
  const normalRangeHex = byName<HTMLInputElement>("cartographyNormalRangeHex");
  const birdsEyeRangePicker = byName<HTMLInputElement>("cartographyBirdsEyeRangePicker");
  const birdsEyeRangeHex = byName<HTMLInputElement>("cartographyBirdsEyeRangeHex");
  const outlineWidth = byName<HTMLInputElement>("cartographyOutlineWidth");
  const outlineWidthValue = byName<HTMLOutputElement>("cartographyOutlineWidthValue");
  const colorControls = [
    [veilPicker, veilHex],
    [outlinePicker, outlineHex],
    [gridPicker, gridHex],
    [missingPicker, missingHex],
    [currentPicker, currentHex],
    [hoverPicker, hoverHex],
    [normalRangePicker, normalRangeHex],
    [birdsEyeRangePicker, birdsEyeRangeHex],
  ] as const;
  let current: AppSettings | null = null;

  const selectedStyle = (): CartographyOverlayStyleId | null => {
    const value = choices.find((choice) => choice.checked)?.value;
    return CARTOGRAPHY_OVERLAY_STYLE_IDS.find((id) => id === value) ?? null;
  };
  const editedStyle = (): CartographyOverlayStyle | null => normaliseCartographyOverlayStyle({
    veilColor: veilHex.value.toUpperCase(),
    outlineColor: outlineHex.value.toUpperCase(),
    outlineWidth: Number(outlineWidth.value),
    gridColor: gridHex.value.toUpperCase(),
    missingColor: missingHex.value.toUpperCase(),
    currentColor: currentHex.value.toUpperCase(),
    hoverColor: hoverHex.value.toUpperCase(),
    normalRangeColor: normalRangeHex.value.toUpperCase(),
    birdsEyeRangeColor: birdsEyeRangeHex.value.toUpperCase(),
  });
  const draw = (style: CartographyOverlayStyle, opacityPercent: number) => {
    preview.style.setProperty("--cartography-veil", style.veilColor);
    preview.style.setProperty("--cartography-outline", style.outlineColor);
    preview.style.setProperty("--cartography-outline-width", `${style.outlineWidth}px`);
    preview.style.setProperty("--cartography-opacity", String(opacityPercent / 100));
    preview.style.setProperty("--cartography-grid", style.gridColor);
    preview.style.setProperty("--cartography-missing", style.missingColor);
    preview.style.setProperty("--cartography-current", style.currentColor);
    preview.style.setProperty("--cartography-hover", style.hoverColor);
    preview.style.setProperty("--cartography-normal-range", style.normalRangeColor);
    preview.style.setProperty("--cartography-birds-eye-range", style.birdsEyeRangeColor);
    opacityValue.value = `${opacityPercent}%`;
    outlineWidthValue.value = `${style.outlineWidth} px`;
    const customSwatch = options.form.querySelector<HTMLElement>(
      '[data-cartography-style-swatch="custom"]',
    );
    if (customSwatch !== null && customSwatch !== undefined) {
      const saved = current?.cartographyOverlayCustomStyle ?? style;
      setSwatch(customSwatch, saved);
    }
  };
  const drawSelected = () => {
    if (current === null) return;
    const id = selectedStyle() ?? current.cartographyOverlayStyle;
    const style = id === "custom" ? editedStyle() : CARTOGRAPHY_OVERLAY_BUILTIN_STYLES[id];
    if (style !== null) draw(style, Number(opacity.value));
  };
  const validateHex = (input: HTMLInputElement) => {
    input.setCustomValidity(isCartographyOverlayHex(input.value.toUpperCase())
      ? ""
      : "Enter a six-digit color such as #171A1C.");
  };
  const saveCustom = async () => {
    const style = editedStyle();
    if (style === null) return;
    options.feedback("Saving…", "progress");
    try {
      await options.persist({
        cartographyOverlayStyle: "custom",
        cartographyOverlayCustomStyle: style,
      });
      options.feedback("Custom map palette saved.", "success", 2200);
    } catch {
      await options.recoverAfterPersistFailure("Review the active map style before trying again.");
    }
  };

  const setSwatch = (swatch: HTMLElement, style: CartographyOverlayStyle) => {
    swatch.style.setProperty("--cartography-veil", style.veilColor);
    swatch.style.setProperty("--cartography-outline", style.outlineColor);
    swatch.style.setProperty("--cartography-missing", style.missingColor);
    swatch.style.setProperty("--cartography-current", style.currentColor);
    swatch.style.setProperty("--cartography-range", style.birdsEyeRangeColor);
  };
  for (const [id, style] of Object.entries(CARTOGRAPHY_OVERLAY_BUILTIN_STYLES)) {
    const swatch = options.form.querySelector<HTMLElement>(`[data-cartography-style-swatch="${id}"]`);
    if (swatch !== null) setSwatch(swatch, style);
  }
  choices.forEach((choice) => choice.addEventListener("change", () => {
    const style = selectedStyle();
    if (style === null) return;
    custom.hidden = style !== "custom";
    editCustom.hidden = style === "custom";
    drawSelected();
    void options.persist({ cartographyOverlayStyle: style });
  }));
  opacity.addEventListener("input", drawSelected);
  opacity.addEventListener("change", () => {
    void options.persist({ cartographyOverlayOpacity: Number(opacity.value) });
  });
  controlOpacity.addEventListener("input", () => {
    controlOpacityValue.value = `${controlOpacity.value}%`;
  });
  controlOpacity.addEventListener("change", () => {
    void options.persist({ cartographyControlIdleOpacity: Number(controlOpacity.value) });
  });
  editCustom.addEventListener("click", () => {
    if (current === null) return;
    const source = cartographyOverlayStyle(
      current.cartographyOverlayStyle,
      current.cartographyOverlayCustomStyle,
    );
    veilPicker.value = source.veilColor;
    veilHex.value = source.veilColor;
    outlinePicker.value = source.outlineColor;
    outlineHex.value = source.outlineColor;
    gridPicker.value = source.gridColor;
    gridHex.value = source.gridColor;
    missingPicker.value = source.missingColor;
    missingHex.value = source.missingColor;
    currentPicker.value = source.currentColor;
    currentHex.value = source.currentColor;
    hoverPicker.value = source.hoverColor;
    hoverHex.value = source.hoverColor;
    normalRangePicker.value = source.normalRangeColor;
    normalRangeHex.value = source.normalRangeColor;
    birdsEyeRangePicker.value = source.birdsEyeRangeColor;
    birdsEyeRangeHex.value = source.birdsEyeRangeColor;
    outlineWidth.value = String(source.outlineWidth);
    choices.forEach((choice) => { choice.checked = choice.value === "custom"; });
    custom.hidden = false;
    editCustom.hidden = true;
    draw(source, Number(opacity.value));
    void saveCustom();
  });

  const bindColor = (picker: HTMLInputElement, text: HTMLInputElement) => {
    picker.addEventListener("input", () => {
      text.value = picker.value.toUpperCase();
      validateHex(text);
      drawSelected();
    });
    picker.addEventListener("change", () => { void saveCustom(); });
    text.addEventListener("input", () => {
      text.value = text.value.toUpperCase();
      validateHex(text);
      if (isCartographyOverlayHex(text.value)) picker.value = text.value;
      drawSelected();
    });
    text.addEventListener("change", () => { void saveCustom(); });
  };
  colorControls.forEach(([picker, text]) => bindColor(picker, text));
  outlineWidth.addEventListener("input", drawSelected);
  outlineWidth.addEventListener("change", () => { void saveCustom(); });

  return Object.freeze({
    render(settings: AppSettings) {
      current = settings;
      const appearanceEnabled = settings.cartographyOverlayEnabled
        || settings.cartographyGridEnabled;
      panel.setAttribute("aria-disabled", String(!appearanceEnabled));
      for (const control of panel.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        "input, button",
      )) control.disabled = !appearanceEnabled;
      choices.forEach((choice) => {
        choice.checked = choice.value === settings.cartographyOverlayStyle;
      });
      opacity.value = String(settings.cartographyOverlayOpacity);
      controlOpacity.value = String(settings.cartographyControlIdleOpacity);
      controlOpacityValue.value = `${settings.cartographyControlIdleOpacity}%`;
      const style = settings.cartographyOverlayCustomStyle;
      const values = [
        style.veilColor,
        style.outlineColor,
        style.gridColor,
        style.missingColor,
        style.currentColor,
        style.hoverColor,
        style.normalRangeColor,
        style.birdsEyeRangeColor,
      ] as const;
      colorControls.forEach(([picker, text], index) => {
        const value = values[index]!;
        picker.value = value;
        text.value = value;
        validateHex(text);
      });
      outlineWidth.value = String(style.outlineWidth);
      custom.hidden = settings.cartographyOverlayStyle !== "custom";
      editCustom.hidden = settings.cartographyOverlayStyle === "custom";
      draw(
        cartographyOverlayStyle(settings.cartographyOverlayStyle, style),
        settings.cartographyOverlayOpacity,
      );
    },
  });
}
