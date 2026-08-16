import { expect, test } from "@playwright/test";
import { closeOffline, launchCachedClient } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

/** The page-side handle the OSK focus guard honours. */
type OskWindow = typeof window & {
  Module: { oskActiveInput?: Element | null };
  __clipboardGameKeys?: Array<{
    type: string;
    key: string;
    code: string;
    control: boolean;
    meta: boolean;
    trusted: boolean;
  }>;
  __clipboardInputTypes?: Array<{
    inputType: string;
    trusted: boolean;
    dataLength: number;
  }>;
  __clipboardTypedKeys?: Array<{ type: string; trusted: boolean }>;
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
          (window as OskWindow).__clipboardTypedKeys = [];
          for (const type of ["keydown", "keyup"] as const) {
            window.addEventListener(type, (event) => {
              if (
                (event.metaKey || event.ctrlKey || event.code.startsWith("Control"))
                && event.target instanceof HTMLInputElement
              ) {
                (window as OskWindow).__clipboardGameKeys?.push({
                  type,
                  key: event.key,
                  code: event.code,
                  control: event.ctrlKey,
                  meta: event.metaKey,
                  trusted: event.isTrusted,
                });
              }
              if (
                !event.metaKey && !event.ctrlKey && !event.altKey
                && !event.code.startsWith("Control")
                && event.target instanceof HTMLInputElement
              ) {
                (window as OskWindow).__clipboardTypedKeys?.push({
                  type,
                  trusted: event.isTrusted,
                });
              }
            }, true);
          }
          const recordInput = (event: Event) => {
            (window as OskWindow).__clipboardInputTypes?.push({
              inputType: event instanceof InputEvent ? event.inputType : event.type,
              trusted: event.isTrusted,
              dataLength: event instanceof InputEvent ? event.data?.length ?? 0 : 0,
            });
          };
          field.addEventListener("input", recordInput);
          document.getElementById("osk-input-password")
            ?.addEventListener("input", recordInput);
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
        // The real client owns selection and cut. Set up the independent paste
        // case explicitly instead of pretending the hidden proxy is the game.
        await app.evaluate(({ clipboard }) => clipboard.writeText("beta"));
        await page.evaluate(() => {
          const field = document.getElementById("osk-input-text") as HTMLInputElement;
          field.value = "alpha ";
          field.setSelectionRange(6, 6);
        });
        await page.keyboard.press("Meta+v");
        await expect.poll(() => page.locator("#osk-input-text").inputValue())
          .toBe("alpha beta");
        await page.keyboard.press("Meta+a");

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
        ).__clipboardGameKeys)).toEqual([
          {
            type: "keydown", key: "Control", code: "ControlLeft", control: true,
            meta: false, trusted: true,
          },
          {
            type: "keydown", key: "x", code: "KeyX", control: true,
            meta: false, trusted: true,
          },
          {
            type: "keyup", key: "x", code: "KeyX", control: true,
            meta: false, trusted: true,
          },
          {
            type: "keyup", key: "Control", code: "ControlLeft", control: false,
            meta: false, trusted: true,
          },
          {
            type: "keydown", key: "Control", code: "ControlLeft", control: true,
            meta: false, trusted: true,
          },
          {
            type: "keydown", key: "a", code: "KeyA", control: true,
            meta: false, trusted: true,
          },
          {
            type: "keyup", key: "a", code: "KeyA", control: true,
            meta: false, trusted: true,
          },
          {
            type: "keyup", key: "Control", code: "ControlLeft", control: false,
            meta: false, trusted: true,
          },
        ]);
        expect(await page.evaluate(() => (
          window as OskWindow
        ).__clipboardInputTypes)).toEqual([
          ...Array.from({ length: 4 }, () => (
            { inputType: "insertText", trusted: true, dataLength: 1 }
          )),
          ...Array.from({ length: 8 }, () => (
            { inputType: "insertText", trusted: true, dataLength: 1 }
          )),
        ]);
        expect(await page.evaluate(() => (
          window as OskWindow
        ).__clipboardTypedKeys)).toEqual(
          Array.from({ length: 12 }, () => [
            { type: "keydown", trusted: true },
            { type: "keyup", trusted: true },
          ]).flat(),
        );
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
