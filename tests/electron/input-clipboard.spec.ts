import { expect, test, type ElectronApplication } from "@playwright/test";
import { closeOffline, launchPlayableClient } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

type InputObservation = {
  phase: "beforeinput" | "input";
  inputType: string;
  data: string | null;
  trusted: boolean;
};

type KeyObservation = {
  type: string;
  key: string;
  code: string;
  control: boolean;
  meta: boolean;
  trusted: boolean;
};

type OskWindow = typeof window & {
  Module: { oskActiveInput?: Element | null };
  __clipboardGameKeys?: KeyObservation[];
  __clipboardInputs?: InputObservation[];
  __passwordPasteEvents?: Array<Omit<InputObservation, "data">>;
};

const EDIT_ITEMS = {
  cut: "edit-cut",
  copy: "edit-copy",
  paste: "edit-paste",
  selectAll: "edit-select-all",
} as const;

async function clickEdit(
  app: ElectronApplication,
  id: (typeof EDIT_ITEMS)[keyof typeof EDIT_ITEMS],
): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const game = BrowserWindow.getAllWindows().find(
      (win) => win.webContents.getURL() === "gw://app/",
    );
    if (!game) throw new Error("game window is unavailable");
    game.show();
    electronApp.focus({ steal: true });
    game.focus();
  });
  await expect.poll(() => app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    return typeof item?.click === "function";
  }, id)).toBe(true);
  await app.evaluate(({ BrowserWindow, Menu }, itemId) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (!win || !item?.click) throw new Error(`${itemId} is unavailable`);
    item.click(item, win, {} as Electron.KeyboardEvent);
  }, id);
}

test.describe("renderer text editing", () => {
  test("uses custom Edit items and keeps app shortcuts off the native menu", async () => {
    const fixture = await launchPlayableClient("gw-edit-menu-contract-");
    try {
      expect(await fixture.app.evaluate(({ Menu }) => {
        const menu = Menu.getApplicationMenu();
        const edit = menu?.items.find((item) => item.label === "Edit");
        return {
          edit: edit?.submenu?.items.map((item) => ({
            id: item.id,
            label: item.label,
            role: item.role,
            accelerator: item.accelerator,
            hasClick: typeof item.click === "function",
          })),
          appAccelerators: [
            "toggle-tools",
            "toggle-trade",
            "open-xunlai-storage",
            "open-travel",
          ].map((id) => menu?.getMenuItemById(id)?.accelerator),
          toolsLabel: menu?.getMenuItemById("toggle-tools")?.label,
          tradeLabel: menu?.getMenuItemById("toggle-trade")?.label,
        };
      })).toEqual({
        edit: [
          { id: "edit-cut", label: "Cut", role: null, accelerator: "CmdOrCtrl+X", hasClick: true },
          { id: "edit-copy", label: "Copy", role: null, accelerator: "CmdOrCtrl+C", hasClick: true },
          { id: "edit-paste", label: "Paste", role: null, accelerator: "CmdOrCtrl+V", hasClick: true },
          { id: "edit-select-all", label: "Select All", role: null, accelerator: "CmdOrCtrl+A", hasClick: true },
        ],
        appAccelerators: [null, null, null, null],
        toolsLabel: "Build Library",
        tradeLabel: "Trade Chat",
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("copies, cuts, pastes Unicode, and selects through one game route", async () => {
    const fixture = await launchPlayableClient("gw-clipboard-e2e-", {
      GW_BACKGROUND_LAUNCH: "0",
    });
    try {
      const { app, page } = fixture;
      await startGameInput(page);
      const before = await app.evaluate(({ clipboard }) => clipboard.readText());
      try {
        await page.evaluate(() => {
          const field = document.getElementById("osk-input-text");
          const multiline = document.getElementById("osk-input-multiline");
          if (!(field instanceof HTMLInputElement) || !(multiline instanceof HTMLTextAreaElement)) {
            throw new Error("text proxies are missing");
          }
          const host = window as OskWindow;
          host.Module.oskActiveInput = field;
          host.__clipboardGameKeys = [];
          host.__clipboardInputs = [];
          for (const type of ["keydown", "keyup"] as const) {
            window.addEventListener(type, (event) => {
              if (!event.ctrlKey && !event.code.startsWith("Control")) return;
              host.__clipboardGameKeys?.push({
                type,
                key: event.key,
                code: event.code,
                control: event.ctrlKey,
                meta: event.metaKey,
                trusted: event.isTrusted,
              });
            }, true);
          }
          for (const target of [field, multiline]) {
            for (const phase of ["beforeinput", "input"] as const) {
              target.addEventListener(phase, (event) => {
                if (!(event instanceof InputEvent)) return;
                host.__clipboardInputs?.push({
                  phase,
                  inputType: event.inputType,
                  data: event.data,
                  trusted: event.isTrusted,
                });
              });
            }
          }
          field.value = "alpha beta";
          field.focus();
          field.setSelectionRange(0, 5);
        });

        await clickEdit(app, EDIT_ITEMS.copy);
        await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe("alpha");

        await page.evaluate(() => {
          const field = document.getElementById("osk-input-text") as HTMLInputElement;
          field.setSelectionRange(3, 3);
        });
        await clickEdit(app, EDIT_ITEMS.copy);
        await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe("alpha beta");

        await app.evaluate(({ clipboard }) => clipboard.writeText("old clipboard"));
        await page.evaluate(() => {
          const field = document.getElementById("osk-input-text") as HTMLInputElement;
          field.setSelectionRange(6, 10);
        });
        await clickEdit(app, EDIT_ITEMS.cut);
        await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe("beta");

        await app.evaluate(({ clipboard }) => clipboard.writeText("preserve me"));
        await page.evaluate(() => {
          const field = document.getElementById("osk-input-text") as HTMLInputElement;
          field.setSelectionRange(1, 1);
        });
        const keysBeforeCollapsedCut = await page.evaluate(() =>
          (window as OskWindow).__clipboardGameKeys?.length ?? 0);
        await clickEdit(app, EDIT_ITEMS.cut);
        await page.waitForTimeout(100);
        expect(await app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe("preserve me");
        expect(await page.evaluate(() =>
          (window as OskWindow).__clipboardGameKeys?.length ?? 0))
          .toBe(keysBeforeCollapsedCut);

        await app.evaluate(({ clipboard }) => clipboard.writeText("é🙂 line\nnext"));
        await page.evaluate(() => {
          const field = document.getElementById("osk-input-text") as HTMLInputElement;
          field.value = "";
          field.focus();
          field.setSelectionRange(0, 0);
          (window as OskWindow).Module.oskActiveInput = field;
          (window as OskWindow).__clipboardInputs = [];
        });
        await clickEdit(app, EDIT_ITEMS.paste);
        await expect(page.locator("#osk-input-text")).toHaveValue("é🙂 line next");
        expect(await page.evaluate(() => (window as OskWindow).__clipboardInputs))
          .toEqual([
            { phase: "beforeinput", inputType: "insertFromPaste", data: "é🙂 line\nnext", trusted: true },
            { phase: "input", inputType: "insertFromPaste", data: "é🙂 line next", trusted: true },
          ]);

        await page.evaluate(() => {
          const field = document.getElementById("osk-input-multiline") as HTMLTextAreaElement;
          field.value = "";
          field.focus();
          (window as OskWindow).Module.oskActiveInput = field;
          (window as OskWindow).__clipboardInputs = [];
        });
        await clickEdit(app, EDIT_ITEMS.paste);
        await expect(page.locator("#osk-input-multiline")).toHaveValue("é🙂 line\nnext");
        expect(await page.evaluate(() => (window as OskWindow).__clipboardInputs))
          .toEqual([
            { phase: "beforeinput", inputType: "insertFromPaste", data: "é🙂 line\nnext", trusted: true },
            { phase: "input", inputType: "insertFromPaste", data: "é🙂 line\nnext", trusted: true },
          ]);

        await clickEdit(app, EDIT_ITEMS.selectAll);
        expect(await page.evaluate(() => {
          const field = document.getElementById("osk-input-multiline") as HTMLTextAreaElement;
          return [field.selectionStart, field.selectionEnd];
        })).toEqual([0, "é🙂 line\nnext".length]);
        await clickEdit(app, EDIT_ITEMS.cut);
        await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe("é🙂 line\nnext");
        expect(await page.evaluate(() => (window as OskWindow).__clipboardGameKeys))
          .toEqual([
            { type: "keydown", key: "Control", code: "ControlLeft", control: true, meta: false, trusted: true },
            { type: "keydown", key: "x", code: "KeyX", control: true, meta: false, trusted: true },
            { type: "keyup", key: "x", code: "KeyX", control: true, meta: false, trusted: true },
            { type: "keyup", key: "Control", code: "ControlLeft", control: false, meta: false, trusted: true },
            { type: "keydown", key: "Control", code: "ControlLeft", control: true, meta: false, trusted: true },
            { type: "keydown", key: "v", code: "KeyV", control: true, meta: false, trusted: true },
            { type: "keyup", key: "v", code: "KeyV", control: true, meta: false, trusted: true },
            { type: "keyup", key: "Control", code: "ControlLeft", control: false, meta: false, trusted: true },
            { type: "keydown", key: "Control", code: "ControlLeft", control: true, meta: false, trusted: true },
            { type: "keydown", key: "v", code: "KeyV", control: true, meta: false, trusted: true },
            { type: "keyup", key: "v", code: "KeyV", control: true, meta: false, trusted: true },
            { type: "keyup", key: "Control", code: "ControlLeft", control: false, meta: false, trusted: true },
            { type: "keydown", key: "Control", code: "ControlLeft", control: true, meta: false, trusted: true },
            { type: "keydown", key: "a", code: "KeyA", control: true, meta: false, trusted: true },
            { type: "keyup", key: "a", code: "KeyA", control: true, meta: false, trusted: true },
            { type: "keyup", key: "Control", code: "ControlLeft", control: false, meta: false, trusted: true },
            { type: "keydown", key: "Control", code: "ControlLeft", control: true, meta: false, trusted: true },
            { type: "keydown", key: "x", code: "KeyX", control: true, meta: false, trusted: true },
            { type: "keyup", key: "x", code: "KeyX", control: true, meta: false, trusted: true },
            { type: "keyup", key: "Control", code: "ControlLeft", control: false, meta: false, trusted: true },
          ]);
      } finally {
        await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), before);
      }
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps password exports private and falls back for a Settings input", async () => {
    const fixture = await launchPlayableClient("gw-private-editing-e2e-");
    try {
      const { app, page } = fixture;
      await startGameInput(page);
      const before = await app.evaluate(({ clipboard }) => clipboard.readText());
      try {
        await app.evaluate(({ clipboard }) => clipboard.writeText("sentinel"));
        await page.evaluate(() => {
          const field = document.getElementById("osk-input-password");
          if (!(field instanceof HTMLInputElement)) throw new Error("password proxy missing");
          (window as OskWindow).Module.oskActiveInput = field;
          (window as OskWindow).__passwordPasteEvents = [];
          for (const phase of ["beforeinput", "input"] as const) {
            field.addEventListener(phase, (event) => {
              if (!(event instanceof InputEvent)) return;
              (window as OskWindow).__passwordPasteEvents?.push({
                phase,
                inputType: event.inputType,
                trusted: event.isTrusted,
              });
            });
          }
          field.value = "hunter2";
          field.focus();
          field.select();
        });
        await clickEdit(app, EDIT_ITEMS.copy);
        await clickEdit(app, EDIT_ITEMS.cut);
        await page.waitForTimeout(100);
        expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("sentinel");
        await expect(page.locator("#osk-input-password")).toHaveValue("hunter2");
        await clickEdit(app, EDIT_ITEMS.paste);
        await expect(page.locator("#osk-input-password")).toHaveValue("sentinel");
        expect(await page.evaluate(() => (window as OskWindow).__passwordPasteEvents))
          .toEqual([
            { phase: "beforeinput", inputType: "insertFromPaste", trusted: true },
            { phase: "input", inputType: "insertFromPaste", trusted: true },
          ]);

        await page.evaluate(() => {
          const input = document.createElement("input");
          input.id = "ordinary-chromium-input";
          document.body.append(input);
          input.value = "ordinary Chromium";
          (window as OskWindow).Module.oskActiveInput = null;
          input.focus();
          input.setSelectionRange(0, 8);
        });
        expect(await page.evaluate(() => document.activeElement?.id))
          .toBe("ordinary-chromium-input");
        await clickEdit(app, EDIT_ITEMS.copy);
        await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe("ordinary");
        await app.evaluate(({ clipboard }) => clipboard.writeText("normal"));
        await clickEdit(app, EDIT_ITEMS.paste);
        await expect(page.locator("#ordinary-chromium-input")).toHaveValue("normal Chromium");
        await clickEdit(app, EDIT_ITEMS.selectAll);
        await clickEdit(app, EDIT_ITEMS.cut);
        await expect(page.locator("#ordinary-chromium-input")).toHaveValue("");
        expect(await app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe("normal Chromium");
      } finally {
        await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), before);
      }
    } finally {
      await closeOffline(fixture);
    }
  });

  test("rejects every malformed game-edit request at IPC", async () => {
    const fixture = await launchPlayableClient("gw-edit-contract-e2e-");
    try {
      const rejected = await fixture.page.evaluate(async () => {
        const edit = window.gwNative.clipboard.edit as unknown as (
          request: unknown,
        ) => Promise<void>;
        const values: unknown[] = [
          null,
          "copy",
          {},
          { command: "copy" },
          { command: "copy", text: "" },
          { command: "copy", text: "x", extra: true },
          { command: "cut" },
          { command: "cut", text: "x".repeat(64 * 1024 + 1) },
          { command: "paste", text: "secret" },
          { command: "selectAll", text: "secret" },
          { command: "undo" },
        ];
        return Promise.all(values.map(async (value) => {
          try {
            await edit(value);
            return false;
          } catch {
            return true;
          }
        }));
      });
      expect(rejected).toEqual(Array.from({ length: 11 }, () => true));
    } finally {
      await closeOffline(fixture);
    }
  });
});
