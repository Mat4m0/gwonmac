import { expect, test } from "@playwright/test";
import { closeOffline, launchCachedClient } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

/** The page-side handle the OSK focus guard honours. */
type OskWindow = typeof window & {
  Module: { oskActiveInput?: Element | null };
  __clipboardGameKeys?: string[];
};

test.describe("renderer clipboard copy", () => {
  test("Cmd+C copies the active game text proxy, and never the password proxy", async () => {
    const fixture = await launchCachedClient("gw-clipboard-e2e-");
    try {
      const { app, page } = fixture;
      await startGameInput(page);
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
          for (const type of ["keydown", "keyup"] as const) {
            window.addEventListener(type, (event) => {
              if (event.code === "KeyC") {
                (window as OskWindow).__clipboardGameKeys?.push(type);
              }
            }, true);
          }
          field.value = "gw copy proof";
          field.focus();
          field.setSelectionRange(0, 2);
        });
        await page.keyboard.press("Meta+c");
        await expect
          .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe("gw");

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
          .toBe("gw copy proof");

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
        // A negative can only be observed by outlasting the positive path's
        // round trip several times over.
        await page.waitForTimeout(250);
        expect(
          await app.evaluate(({ clipboard }) => clipboard.readText()),
        ).toBe("sentinel");
        expect(await page.evaluate(() => (
          window as OskWindow
        ).__clipboardGameKeys)).toEqual([]);
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
