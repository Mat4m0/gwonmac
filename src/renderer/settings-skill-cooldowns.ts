/**
 * Settings binder for the single canonical cooldown presentation choice.
 * The shared view remains the only owner of how that choice is drawn.
 */
import type { AppSettings } from "../shared/contracts.js";
import {
  isSkillCooldownColor,
  SKILL_COOLDOWN_PRESET_COLORS,
  type SkillCooldownColor,
  type SkillCooldownPreset,
} from "../shared/skill-cooldowns.js";
import { createSkillCooldownView } from "./skill-cooldown-view.js";
import { createSkillKeyBindingView } from "./skill-key-binding-view.js";

const HEX = /^#[0-9a-fA-F]{6}$/u;

export function bindSkillCooldownSettings(options: Readonly<{
  fieldset: HTMLFieldSetElement;
  settings: () => AppSettings | null;
  persist: (patch: Pick<AppSettings, "skillCooldownColor">) => Promise<unknown>;
  recoverAfterPersistFailure: (message: string) => Promise<void>;
}>) {
  const choices = [...options.fieldset.querySelectorAll<HTMLInputElement>(
    'input[name="skillCooldownColorChoice"]',
  )];
  const enabled = options.fieldset.querySelector<HTMLInputElement>(
    '[name="skillCooldownOverlayEnabled"]',
  );
  const picker = options.fieldset.querySelector<HTMLInputElement>('[name="skillCooldownCustomPicker"]');
  const text = options.fieldset.querySelector<HTMLInputElement>('[name="skillCooldownCustomHex"]');
  const preview = options.fieldset.querySelector<HTMLElement>('.settings-skill-cooldown-preview-slot');
  if (!enabled || !picker || !text || !preview) throw new Error("incomplete skill cooldown settings");
  const countdown = createSkillCooldownView(preview);
  countdown.element.style.setProperty("--skill-cooldown-slot-height", "72px");
  const key = createSkillKeyBindingView(preview);
  key.element.classList.add("settings-skill-cooldown-preview-key");
  key.update({
    input: { kind: "keyboard", code: "KeyC" },
    modifiers: { control: true, option: true, shift: true, command: true },
  });
  let customValue = "#e35a4f";

  const selected = (): SkillCooldownColor | null => {
    const value = choices.find((choice) => choice.checked)?.value;
    if (value === "custom") {
      return HEX.test(text.value)
        ? { kind: "custom", value: text.value as `#${string}` }
        : null;
    }
    return value === "red" || value === "cream" || value === "gold" || value === "blue"
      ? { kind: "preset", preset: value }
      : null;
  };
  const drawPreview = () => {
    const color = selected();
    if (color) {
      countdown.update(2_900, color);
      if (color.kind === "custom") {
        options.fieldset.querySelector<HTMLElement>(".settings-skill-cooldown-custom-swatch")
          ?.style.setProperty("--cooldown-swatch", color.value);
      }
    }
  };
  const validateText = () => {
    text.setCustomValidity(HEX.test(text.value) ? "" : "Enter a six-digit color such as #e35a4f.");
  };
  const save = async (color: SkillCooldownColor) => {
    if (!isSkillCooldownColor(color)) return;
    try {
      await options.persist({ skillCooldownColor: color });
    } catch {
      await options.recoverAfterPersistFailure(
        "Review the active cooldown color before trying again.",
      );
    }
  };

  choices.forEach((choice) => choice.addEventListener("change", () => {
    const color = selected();
    picker.disabled = choice.value !== "custom" && !choices.some((item) => item.value === "custom" && item.checked);
    text.disabled = picker.disabled;
    drawPreview();
    if (color) void save(color);
  }));
  picker.addEventListener("input", () => {
    customValue = picker.value;
    text.value = customValue;
    validateText();
    drawPreview();
  });
  picker.addEventListener("change", () => {
    const color = selected();
    if (color) void save(color);
  });
  text.addEventListener("input", () => {
    validateText();
    if (!HEX.test(text.value)) return;
    customValue = text.value;
    picker.value = customValue;
    drawPreview();
  });
  text.addEventListener("change", () => {
    const color = selected();
    if (color) void save(color);
  });

  return Object.freeze({
    render(settings: AppSettings) {
      options.fieldset.hidden = !settings.gwonmacTools;
      enabled.checked = settings.skillCooldownOverlayEnabled;
      enabled.disabled = !settings.gwonmacTools;
      const color = settings.skillCooldownColor;
      if (color.kind === "custom") customValue = color.value;
      const value = color.kind === "custom" ? "custom" : color.preset;
      choices.forEach((choice) => { choice.checked = choice.value === value; });
      picker.value = customValue;
      text.value = customValue;
      options.fieldset.querySelector<HTMLElement>(".settings-skill-cooldown-custom-swatch")
        ?.style.setProperty("--cooldown-swatch", customValue);
      const custom = value === "custom";
      picker.disabled = !custom;
      text.disabled = !custom;
      validateText();
      countdown.update(2_900, color);
      for (const [preset, cssColor] of Object.entries(SKILL_COOLDOWN_PRESET_COLORS)) {
        const swatch = options.fieldset.querySelector<HTMLElement>(`[data-cooldown-swatch="${preset as SkillCooldownPreset}"]`);
        swatch?.style.setProperty("--cooldown-swatch", cssColor);
      }
    },
  });
}
