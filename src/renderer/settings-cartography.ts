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
  const outlineWidth = byName<HTMLInputElement>("cartographyOutlineWidth");
  const outlineWidthValue = byName<HTMLOutputElement>("cartographyOutlineWidthValue");
  let current: AppSettings | null = null;

  const selectedStyle = (): CartographyOverlayStyleId | null => {
    const value = choices.find((choice) => choice.checked)?.value;
    return CARTOGRAPHY_OVERLAY_STYLE_IDS.find((id) => id === value) ?? null;
  };
  const editedStyle = (): CartographyOverlayStyle | null => normaliseCartographyOverlayStyle({
    veilColor: veilHex.value.toUpperCase(),
    outlineColor: outlineHex.value.toUpperCase(),
    outlineWidth: Number(outlineWidth.value),
  });
  const draw = (style: CartographyOverlayStyle, opacityPercent: number) => {
    preview.style.setProperty("--cartography-veil", style.veilColor);
    preview.style.setProperty("--cartography-outline", style.outlineColor);
    preview.style.setProperty("--cartography-outline-width", `${style.outlineWidth}px`);
    preview.style.setProperty("--cartography-opacity", String(opacityPercent / 100));
    opacityValue.value = `${opacityPercent}%`;
    outlineWidthValue.value = `${style.outlineWidth} px`;
    const customSwatch = options.form.querySelector<HTMLElement>(
      '[data-cartography-style-swatch="custom"]',
    );
    customSwatch?.style.setProperty("--cartography-veil", current?.cartographyOverlayCustomStyle.veilColor ?? style.veilColor);
    customSwatch?.style.setProperty("--cartography-outline", current?.cartographyOverlayCustomStyle.outlineColor ?? style.outlineColor);
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
      options.feedback("Custom overlay style saved.", "success", 2200);
    } catch {
      await options.recoverAfterPersistFailure("Review the active map style before trying again.");
    }
  };

  for (const [id, style] of Object.entries(CARTOGRAPHY_OVERLAY_BUILTIN_STYLES)) {
    const swatch = options.form.querySelector<HTMLElement>(`[data-cartography-style-swatch="${id}"]`);
    swatch?.style.setProperty("--cartography-veil", style.veilColor);
    swatch?.style.setProperty("--cartography-outline", style.outlineColor);
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
  bindColor(veilPicker, veilHex);
  bindColor(outlinePicker, outlineHex);
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
      veilPicker.value = style.veilColor;
      veilHex.value = style.veilColor;
      outlinePicker.value = style.outlineColor;
      outlineHex.value = style.outlineColor;
      outlineWidth.value = String(style.outlineWidth);
      validateHex(veilHex);
      validateHex(outlineHex);
      custom.hidden = settings.cartographyOverlayStyle !== "custom";
      editCustom.hidden = settings.cartographyOverlayStyle === "custom";
      draw(
        cartographyOverlayStyle(settings.cartographyOverlayStyle, style),
        settings.cartographyOverlayOpacity,
      );
    },
  });
}
