import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bindMemoryWarning } from "../../src/renderer/memory-warning.js";

class FakeClassList {
  readonly values = new Set<string>();
  toggle(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(name);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  hidden = false;
  open = false;
  textContent = "";
  readonly classList = new FakeClassList();
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<() => void>>();
  focused = false;
  checked = false;
  disabled = false;
  addEventListener(name: string, listener: () => void): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }
  change(): void {
    for (const listener of this.listeners.get("change") ?? []) listener();
  }
  focus(): void { this.focused = true; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
}

function memoryDom(complete = true) {
  const ids = [
    "memory-notice",
    "memory-notice-text",
    "memory-notice-label",
    "memory-notice-detail",
    "memory-notice-explanation",
    "memory-notice-details",
    "memory-notice-reload",
    "memory-notice-later",
    "memory-notice-auto-relog",
    "canvas",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  if (!complete) elements.delete("memory-notice-label");
  return {
    document: {
      getElementById: (id: string) => elements.get(id) ?? null,
    } as unknown as Document,
    element: (id: string) => elements.get(id)!,
  };
}

const warningActions = (
  autoRelogAfterReload = false,
  reload: () => void | Promise<void> = () => {},
) => ({
  autoRelogAfterReload,
  async saveAutoRelog() {},
  reload,
});

describe("memory warning presenter", () => {
  it("does nothing when the single warning surface is incomplete", () => {
    assert.equal(
      bindMemoryWarning(memoryDom(false).document, warningActions()),
      null,
    );
  });

  it("keeps Low dismissed until Critical reopens the same notice", () => {
    const dom = memoryDom();
    const presenter = bindMemoryWarning(dom.document, warningActions());
    assert.ok(presenter);
    presenter.present("low", 2_147_483_648);
    assert.equal(dom.element("memory-notice").hidden, false);
    assert.match(dom.element("memory-notice-explanation").textContent, /2 GB/);
    dom.element("memory-notice-details").open = true;
    dom.element("memory-notice-later").click();
    assert.equal(dom.element("memory-notice").hidden, true);
    assert.equal(dom.element("memory-notice-details").open, false);
    assert.equal(dom.element("canvas").focused, true);
    presenter.present("low", 2_147_483_648);
    assert.equal(dom.element("memory-notice").hidden, true);
    presenter.present("critical", 4_294_901_760);
    assert.equal(dom.element("memory-notice").hidden, false);
    assert.equal(dom.element("memory-notice-text").attributes.get("aria-live"), "assertive");
    assert.match(dom.element("memory-notice-explanation").textContent, /4 GB/);
  });

  it("reloads without adding another warning state", async () => {
    const dom = memoryDom();
    let reloads = 0;
    const presenter = bindMemoryWarning(
      dom.document,
      warningActions(true, () => { reloads += 1; }),
    );
    assert.ok(presenter);
    presenter.present("critical", 2_147_483_648);
    dom.element("memory-notice-reload").click();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(reloads, 1);
    assert.equal(dom.element("memory-notice").hidden, true);
  });

  it("registers as a dismissible keyboard surface while visible", () => {
    const dom = memoryDom();
    const open: boolean[] = [];
    let dismiss = () => {};
    const surfaces: GwonmacSurfaceController = {
      register(surface) {
        dismiss = surface.dismiss;
        return {
          setOpen(value) { open.push(value); },
          raise() {},
          dispose() {},
        };
      },
    };
    const presenter = bindMemoryWarning(dom.document, warningActions(), surfaces);
    assert.ok(presenter);

    presenter.present("low", 2_147_483_648);
    assert.deepEqual(open, [true]);
    dismiss();
    assert.equal(dom.element("memory-notice").hidden, true);
    assert.equal(dom.element("canvas").focused, true);
    assert.deepEqual(open, [true, false]);
  });

  it("shares and saves the automatic-return preference", async () => {
    const dom = memoryDom();
    const saved: boolean[] = [];
    let reloads = 0;
    const presenter = bindMemoryWarning(
      dom.document,
      {
        autoRelogAfterReload: false,
        async saveAutoRelog(enabled) { saved.push(enabled); },
        reload() { reloads += 1; },
      },
    );
    assert.ok(presenter);
    const checkbox = dom.element("memory-notice-auto-relog");
    checkbox.checked = true;
    checkbox.change();
    await Promise.resolve();
    assert.deepEqual(saved, [true]);
    presenter.setAutoRelog(true);
    assert.equal(dom.element("memory-notice-auto-relog").checked, true);
    presenter.present("low", 2_147_483_648);
    dom.element("memory-notice-reload").click();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(saved, [true, true]);
    assert.equal(reloads, 1);
  });
});
