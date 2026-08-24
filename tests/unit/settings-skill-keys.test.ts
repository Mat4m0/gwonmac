/**
 * Headless behavior coverage for the display-only skill-key settings binder.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { bindSkillKeySettings } from "../../src/renderer/settings-skill-keys.ts";
import { DEFAULT_SETTINGS, type AppSettings } from "../../src/shared/contracts.ts";
import {
  EMPTY_SKILL_KEY_MODIFIERS,
  withSkillKeyBinding,
  type SkillKeyBindings,
  type SkillKeyCaptureResult,
} from "../../src/shared/skill-key-bindings.ts";

type Listener = (event: Event) => void;

class FakeDocument {
  readonly head = new FakeElement(this);

  createElement(): FakeElement {
    return new FakeElement(this);
  }

  createElementNS(): FakeElement {
    return new FakeElement(this);
  }

  getElementById(id: string): FakeElement | null {
    return this.head.children.find((child) => child.id === id) ?? null;
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  readonly dataset: Record<string, string> = {};
  readonly style = { cssText: "" };
  readonly classList = { add: (...names: string[]) => { this.className += names.join(" "); } };
  id = "";
  className = "";
  textContent = "";
  hidden = false;
  disabled = false;
  readonly ownerDocument: FakeDocument;

  constructor(ownerDocument: FakeDocument) {
    this.ownerDocument = ownerDocument;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }

  focus(): void {}
}

class FakeRow extends FakeElement {
  readonly preview = new FakeElement(this.ownerDocument);
  readonly change = new FakeElement(this.ownerDocument);
  readonly clear = new FakeElement(this.ownerDocument);
  readonly message = new FakeElement(this.ownerDocument);

  querySelector(selector: string): FakeElement | null {
    if (selector === ".settings-skill-key-preview") return this.preview;
    if (selector === ".settings-skill-key-change") return this.change;
    if (selector === ".settings-skill-key-clear") return this.clear;
    if (selector === ".settings-skill-key-message") return this.message;
    return null;
  }
}

class FakeWindow extends EventTarget {
  readonly gwNative: {
    skillKeys: {
      capture: () => Promise<SkillKeyCaptureResult>;
      submitPointer: () => Promise<boolean>;
      cancelCapture: () => Promise<void>;
    };
  };

  constructor(capture: () => Promise<SkillKeyCaptureResult>, cancel: () => void) {
    super();
    this.gwNative = {
      skillKeys: {
        capture,
        submitPointer: async () => true,
        cancelCapture: async () => { cancel(); },
      },
    };
  }
}

function installWindow(value: FakeWindow): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value });
  return () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

function fixture(settings: AppSettings, capture: () => Promise<SkillKeyCaptureResult>) {
  const document = new FakeDocument();
  const rows = Array.from({ length: 8 }, () => new FakeRow(document));
  const fieldset = new FakeElement(document) as FakeElement & {
    querySelectorAll: () => FakeRow[];
  };
  fieldset.querySelectorAll = () => rows;
  const dialog = new FakeElement(document);
  const clearAll = new FakeElement(document);
  const saved: SkillKeyBindings[] = [];
  let cancellations = 0;
  const fakeWindow = new FakeWindow(capture, () => { cancellations += 1; });
  const uninstall = installWindow(fakeWindow);
  const binder = bindSkillKeySettings({
    fieldset: fieldset as unknown as HTMLFieldSetElement,
    dialog: dialog as unknown as HTMLDialogElement,
    clearAll: clearAll as unknown as HTMLButtonElement,
    settings: () => settings,
    persist: async (bindings) => { saved.push(bindings); },
    recoverAfterPersistFailure: async () => {},
    feedback: () => {},
  });
  return { binder, clearAll, rows, saved, uninstall, fakeWindow, cancellations: () => cancellations };
}

test("skill-key previews expose the same canonical label as their visual plate", () => {
  const binding = {
    input: { kind: "keyboard" as const, code: "KeyC" },
    modifiers: { ...EMPTY_SKILL_KEY_MODIFIERS, shift: true },
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    gwonmacTools: true,
    skillKeyBindings: withSkillKeyBinding(DEFAULT_SETTINGS.skillKeyBindings, 0, binding),
  };
  const view = fixture(settings, async () => ({ status: "cancelled" }));
  try {
    view.binder.render(settings);
    assert.equal(view.rows[0]!.preview.attributes.get("role"), "img");
    assert.equal(
      view.rows[0]!.preview.attributes.get("aria-label"),
      "Skill 1: Shift + C",
    );
    assert.equal(
      view.rows[1]!.preview.attributes.get("aria-label"),
      "Skill 2: native key 2",
    );
  } finally {
    view.uninstall();
  }
});

test("blur cancels recording and a captured chord persists only the display setting", async () => {
  let finishCapture!: (result: SkillKeyCaptureResult) => void;
  const capture = new Promise<SkillKeyCaptureResult>((resolve) => { finishCapture = resolve; });
  const settings = { ...DEFAULT_SETTINGS, gwonmacTools: true };
  const view = fixture(settings, () => capture);
  try {
    view.binder.render(settings);
    view.rows[0]!.change.dispatch("click");
    view.fakeWindow.dispatchEvent(new Event("blur"));
    assert.equal(view.cancellations(), 1);
    finishCapture({
      status: "captured",
      binding: {
        input: { kind: "keyboard", code: "KeyC" },
        modifiers: EMPTY_SKILL_KEY_MODIFIERS,
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(view.saved.length, 0);
  } finally {
    view.uninstall();
  }
});
