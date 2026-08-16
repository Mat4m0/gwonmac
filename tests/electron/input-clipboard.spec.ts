import { expect, test } from "@playwright/test";
import { closeOffline, launchCachedClient } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

/** The page-side handle the OSK focus guard honours. */
type OskWindow = typeof window & {
  Module: { oskActiveInput?: Element | null };
  __clipboardGameKeys?: string[];
  __clipboardInputTypes?: Array<{ inputType: string; trusted: boolean }>;
};

test.describe("renderer text editing", () => {
  test("uses macOS copy, cut, paste, and select-all without leaking game keys", async () => {
    const fixture = await launchCachedClient("gw-clipboard-e2e-");
    try {
      const { app, page } = fixture;
      await startGameInput(page);
      expect(await app.evaluate(({ Menu }) => {
        const edit = Menu.getApplicationMenu()?.items.find((item) => item.label === "Edit");
        return edit?.submenu?.items.map((item) => ({
          role: item.role,
          registerAccelerator: item.registerAccelerator,
        }));
      })).toEqual([
        { role: "cut", registerAccelerator: false },
        { role: "copy", registerAccelerator: false },
        { role: "paste", registerAccelerator: false },
        { role: "selectall", registerAccelerator: false },
      ]);
      const before = await app.evaluate(({ clipboard }) => clipboard.readText());
      try {
        // The client marks the field it is editing through as the active OSK
        // input; the harness focus guard bounces any other focus off. Editing
        // state, not test scaffolding.
        await page.evaluate(() => {
          const field = globalThis.document.getElementById("osk-input-text");
          if (!(field instanceof globalThis.HTMLInputElement)) {
            throw new Error("the text proxy is missing");
          }
          (window as OskWindow).Module.oskActiveInput = field;
          (window as OskWindow).__clipboardGameKeys = [];
          (window as OskWindow).__clipboardInputTypes = [];
          for (const type of ["keydown", "keyup"] as const) {
            window.addEventListener(type, (event) => {
              if (["KeyA", "KeyC", "KeyV", "KeyX"].includes(event.code)) {
                (window as OskWindow).__clipboardGameKeys?.push(`${type}:${event.code}`);
              }
            }, true);
          }
          field.addEventListener("input", (event) => {
            (window as OskWindow).__clipboardInputTypes?.push({
              inputType: event instanceof InputEvent ? event.inputType : event.type,
              trusted: event.isTrusted,
            });
          });
          field.value = "alpha beta";
          field.focus();
          field.setSelectionRange(0, 5);
        });
        await page.keyboard.press("Meta+c");
        await expect
          .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe("alpha");

        // A collapsed selection copies the whole field: the client keeps its
        // in-field selection to itself, and "nothing" would be the one answer
        // the player can see is wrong.
        await page.evaluate(() => {
          const field = globalThis.document.getElementById("osk-input-text");
          if (!(field instanceof globalThis.HTMLInputElement)) {
            throw new Error("the text proxy is missing");
          }
          field.setSelectionRange(3, 3);
        });
        await page.keyboard.press("Meta+c");
        await expect
          .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe("alpha beta");

        await page.evaluate(() => {
          const field = document.getElementById("osk-input-text") as HTMLInputElement;
          field.setSelectionRange(6, 10);
        });
        await page.keyboard.press("Meta+x");
        await expect.poll(() => page.locator("#osk-input-text").inputValue())
          .toBe("alpha ");
        await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe("beta");

        await page.keyboard.press("Meta+v");
        await expect.poll(() => page.locator("#osk-input-text").inputValue())
          .toBe("alpha beta");
        await page.keyboard.press("Meta+a");
        expect(await page.evaluate(() => {
          const field = document.getElementById("osk-input-text") as HTMLInputElement;
          return [field.selectionStart, field.selectionEnd];
        })).toEqual([0, 10]);

        // Secrets do not leave through this path.
        await app.evaluate(({ clipboard }) => clipboard.writeText("sentinel"));
        await page.evaluate(() => {
          const field = globalThis.document.getElementById("osk-input-password");
          if (!(field instanceof globalThis.HTMLInputElement)) {
            throw new Error("the password proxy is missing");
          }
          (window as OskWindow).Module.oskActiveInput = field;
          field.value = "hunter2";
          field.focus();
          field.select();
        });
        await page.keyboard.press("Meta+c");
        await page.keyboard.press("Meta+x");
        // A negative can only be observed by outlasting the positive path's
        // round trip several times over.
        await page.waitForTimeout(250);
        expect(
          await app.evaluate(({ clipboard }) => clipboard.readText()),
        ).toBe("sentinel");
        await expect(page.locator("#osk-input-password")).toHaveValue("hunter2");
        await page.keyboard.press("Meta+v");
        await expect(page.locator("#osk-input-password")).toHaveValue("sentinel");
        expect(await page.evaluate(() => (
          window as OskWindow
        ).__clipboardGameKeys)).toEqual([]);
        expect(await page.evaluate(() => (
          window as OskWindow
        ).__clipboardInputTypes)).toEqual([
          { inputType: "deleteByCut", trusted: true },
          { inputType: "insertFromPaste", trusted: true },
        ]);
      } finally {
        await app.evaluate(
          ({ clipboard }, text) => clipboard.writeText(text),
          before,
        );
      }
    } finally {
      await closeOffline(fixture);
    }
  });
});
