import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.ts";
import { bindShortcutSettings } from "../../src/renderer/settings-shortcuts.ts";
import { SHORTCUT_ACTIONS } from "../../src/shared/keyboard-shortcuts.ts";

type Listener = () => void;

class FakeElement {
  readonly listeners = new Map<string, Listener[]>();
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  textContent = "";
  value = "";
  selectedIndex = 0;
  hidden = false;
  disabled = false;

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  focus(): void {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeShortcutRow extends FakeElement {
  readonly valueElement = new FakeElement();
  readonly change = new FakeElement();
  readonly message = new FakeElement();
  readonly replace = new FakeElement();

  constructor(action: string) {
    super();
    this.dataset.shortcutAction = action;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === ".settings-shortcut-value") return this.valueElement;
    if (selector === ".settings-shortcut-change") return this.change;
    if (selector === ".settings-shortcut-message") return this.message;
    if (selector === ".settings-shortcut-replace") return this.replace;
    return null;
  }
}

function installWindow(value: object): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value });
  return () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

test("a failed shortcut write reconciles through Settings and leaves capture mode", async () => {
  const rows = SHORTCUT_ACTIONS.map((action) => new FakeShortcutRow(action));
  const row = rows[0]!;
  const restore = new FakeElement();
  const dialog = new FakeElement();
  let current = { ...DEFAULT_SETTINGS };
  let captureCancellations = 0;
  let recovered!: () => void;
  const recovery = new Promise<void>((resolve) => { recovered = resolve; });
  const uninstall = installWindow({
    gwNative: {
      shortcuts: {
        cancelCapture: async () => { captureCancellations += 1; },
        capture: async () => ({
          status: "captured",
          binding: { key: "k", shift: true, option: false },
        }),
      },
    },
  });
  try {
    bindShortcutSettings({
      form: {
        querySelectorAll: () => rows,
      } as unknown as HTMLFormElement,
      dialog: dialog as unknown as HTMLDialogElement,
      restore: restore as unknown as HTMLElement,
      settings: () => current,
      persist: async () => { throw new Error("write failed"); },
      recoverAfterPersistFailure: async () => {
        current = { ...DEFAULT_SETTINGS };
        recovered();
      },
      feedback: () => {},
    });

    row.change.dispatch("click");
    await recovery;
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(row.valueElement.textContent, "⌘R");
    assert.equal(row.change.textContent, "Change");
    assert.equal(row.change.attributes.get("aria-label"), "Change Switch Character shortcut");
    assert.equal(captureCancellations, 1);
  } finally {
    uninstall();
  }
});
