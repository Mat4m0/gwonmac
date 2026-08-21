import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.ts";
import type { TravelUserPreferences } from "../../src/shared/travel.ts";
import { bindShortcutSettings } from "../../src/renderer/settings-shortcuts.ts";
import { bindTravelPreferenceSettings } from "../../src/renderer/settings-travel-preferences.ts";

type Listener = () => void;

class FakeElement {
  readonly listeners = new Map<string, Listener[]>();
  readonly dataset: Record<string, string> = {};
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
  const row = new FakeShortcutRow("tools.toggle");
  const restore = new FakeElement();
  const dialog = new FakeElement();
  let current = { ...DEFAULT_SETTINGS };
  let recovered!: () => void;
  const recovery = new Promise<void>((resolve) => { recovered = resolve; });
  const uninstall = installWindow({
    gwNative: {
      shortcuts: {
        cancelCapture: async () => {},
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
        querySelectorAll: () => [row],
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

    assert.equal(row.valueElement.textContent, "⌘B");
    assert.equal(row.change.textContent, "Change");
  } finally {
    uninstall();
  }
});

test("a failed Travel write and reload makes the pane unknown and disabled", async () => {
  const limit = new FakeElement();
  limit.value = "10";
  const clear = new FakeElement();
  let current: TravelUserPreferences | null = {
    shortcuts: [null, null, null, null, null, null, null, null, null],
    synonyms: [],
    recentLimit: 5,
    recentMapIds: [55],
  };
  let reconciled!: () => void;
  const reconciliation = new Promise<void>((resolve) => { reconciled = resolve; });
  let render!: () => void;
  const uninstall = installWindow({
    gwNative: {
      travelPreferences: {
        set: async () => { throw new Error("write failed"); },
        get: async () => { throw new Error("reload failed"); },
      },
    },
  });
  try {
    const binder = bindTravelPreferenceSettings({
      limit: limit as unknown as HTMLSelectElement,
      clear: clear as unknown as HTMLButtonElement,
      current: () => current,
      accept: (preferences) => { current = preferences; },
      renderSettings: () => {
        binder.render(true, current);
        render?.();
      },
      feedback: () => {},
    });
    render = reconciled;
    binder.render(true, current);
    assert.equal(limit.disabled, false);

    limit.value = "10";
    limit.dispatch("change");
    await reconciliation;

    assert.equal(current, null);
    assert.equal(limit.disabled, true);
    assert.equal(limit.selectedIndex, -1);
    assert.equal(clear.disabled, true);
  } finally {
    uninstall();
  }
});
