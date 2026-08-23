/** Headless behavior coverage for the canonical cooldown color setting. */
import assert from "node:assert/strict";
import test from "node:test";
import { bindSkillCooldownSettings } from "../../src/renderer/settings-skill-cooldowns.ts";
import { DEFAULT_SETTINGS, type AppSettings } from "../../src/shared/contracts.ts";
import type { SkillCooldownColor } from "../../src/shared/skill-cooldowns.ts";

type Listener = () => void;

class FakeStyle {
  readonly values = new Map<string, string>();
  setProperty(name: string, value: string): void { this.values.set(name, value); }
}

class FakeDocument {
  readonly head = new FakeElement(this);
  createElement(): FakeElement { return new FakeElement(this); }
  createElementNS(): FakeElement { return new FakeElement(this); }
  getElementById(id: string): FakeElement | null {
    return this.head.children.find((child) => child.id === id) ?? null;
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  readonly style = new FakeStyle();
  readonly dataset: Record<string, string> = {};
  readonly classList = { add: (...names: string[]) => { this.className += ` ${names.join(" ")}`; } };
  id = "";
  className = "";
  textContent = "";
  hidden = false;
  disabled = false;
  checked = false;
  value = "";
  validationMessage = "";
  readonly ownerDocument: FakeDocument;

  constructor(ownerDocument: FakeDocument) { this.ownerDocument = ownerDocument; }
  append(...children: FakeElement[]): void { this.children.push(...children); }
  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }
  setAttribute(): void {}
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  setCustomValidity(message: string): void { this.validationMessage = message; }
}

class FakeFieldset extends FakeElement {
  readonly enabled = new FakeElement(this.ownerDocument);
  readonly picker = new FakeElement(this.ownerDocument);
  readonly text = new FakeElement(this.ownerDocument);
  readonly preview = new FakeElement(this.ownerDocument);
  readonly customSwatch = new FakeElement(this.ownerDocument);
  readonly presetSwatches = new Map<string, FakeElement>();
  readonly choices = ["red", "cream", "gold", "blue", "custom"].map((value) => {
    const choice = new FakeElement(this.ownerDocument);
    choice.value = value;
    return choice;
  });

  constructor(document: FakeDocument) {
    super(document);
    for (const preset of ["red", "cream", "gold", "blue"]) {
      this.presetSwatches.set(preset, new FakeElement(document));
    }
  }

  querySelectorAll(): FakeElement[] { return this.choices; }
  querySelector(selector: string): FakeElement | null {
    if (selector === '[name="skillCooldownOverlayEnabled"]') return this.enabled;
    if (selector === '[name="skillCooldownCustomPicker"]') return this.picker;
    if (selector === '[name="skillCooldownCustomHex"]') return this.text;
    if (selector === ".settings-skill-cooldown-preview-slot") return this.preview;
    if (selector === ".settings-skill-cooldown-custom-swatch") return this.customSwatch;
    const preset = selector.match(/^\[data-cooldown-swatch="(.+)"\]$/u)?.[1];
    return preset ? this.presetSwatches.get(preset) ?? null : null;
  }
}

function fixture(settings: AppSettings, fail = false) {
  const document = new FakeDocument();
  const fieldset = new FakeFieldset(document);
  const saved: SkillCooldownColor[] = [];
  const feedback: string[] = [];
  let recoveries = 0;
  const binder = bindSkillCooldownSettings({
    fieldset: fieldset as unknown as HTMLFieldSetElement,
    settings: () => settings,
    persist: async ({ skillCooldownColor }) => {
      if (fail) throw new Error("disk full");
      saved.push(skillCooldownColor);
    },
    recoverAfterPersistFailure: async () => { recoveries += 1; },
    feedback: (message) => { feedback.push(message); },
  });
  return { binder, fieldset, saved, feedback, recoveries: () => recoveries };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("cooldown settings render the canonical choice and shared preview", () => {
  const settings = { ...DEFAULT_SETTINGS, gwonmacTools: true };
  const view = fixture(settings);
  view.binder.render(settings);
  assert.equal(view.fieldset.hidden, false);
  assert.equal(view.fieldset.enabled.checked, settings.skillCooldownOverlayEnabled);
  assert.equal(view.fieldset.choices[0]!.checked, true);
  assert.equal(view.fieldset.picker.disabled, true);
  assert.equal(view.fieldset.preview.children.length, 2);
});

test("cooldown settings reject malformed custom colors and persist valid colors", async () => {
  const settings = { ...DEFAULT_SETTINGS, gwonmacTools: true };
  const view = fixture(settings);
  view.binder.render(settings);
  view.fieldset.choices.forEach((choice) => { choice.checked = choice.value === "custom"; });
  view.fieldset.choices[4]!.dispatch("change");
  await flush();
  assert.equal(view.fieldset.picker.disabled, false);
  assert.deepEqual(view.saved, [{ kind: "custom", value: "#e35a4f" }]);

  view.fieldset.text.value = "#bad";
  view.fieldset.text.dispatch("input");
  view.fieldset.text.dispatch("change");
  await flush();
  assert.match(view.fieldset.text.validationMessage, /six-digit/u);
  assert.equal(view.saved.length, 1);

  view.fieldset.text.value = "#12aBcF";
  view.fieldset.text.dispatch("input");
  view.fieldset.text.dispatch("change");
  await flush();
  assert.deepEqual(view.saved, [
    { kind: "custom", value: "#e35a4f" },
    { kind: "custom", value: "#12aBcF" },
  ]);
  assert.deepEqual(view.feedback, [
    "Saving…", "Cooldown color saved.",
    "Saving…", "Cooldown color saved.",
  ]);
});

test("cooldown settings recover the active state after a failed write", async () => {
  const settings = { ...DEFAULT_SETTINGS, gwonmacTools: true };
  const view = fixture(settings, true);
  view.binder.render(settings);
  view.fieldset.choices.forEach((choice) => { choice.checked = choice.value === "gold"; });
  view.fieldset.choices[2]!.dispatch("change");
  await flush();
  assert.equal(view.recoveries(), 1);
  assert.deepEqual(view.feedback, ["Saving…"]);
});
