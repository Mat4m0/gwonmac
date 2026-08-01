import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test.describe("renderer Toolbox input", () => {
  test("stays interactive without handing input to the game", async () => {
    const fixture = await launchOffline("gw-toolbox-input-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(async () => {
        globalThis.document.getElementById("loading")?.classList.add("gone");
        const canvas = globalThis.document.getElementById("canvas");
        if (!(canvas instanceof globalThis.HTMLCanvasElement)) {
          throw new Error("#canvas is missing");
        }
        const specifier = "./toolbox-foundation.js";
        const module = (await import(specifier)) as {
          createToolboxFoundation(
            parent: HTMLElement,
            setPanel: (shown: boolean) => number,
          ): {
            update(state: object): void;
          };
        };
        let canvasBlurs = 0;
        let gameKeys = 0;
        let gameMouseDowns = 0;
        let inputResets = 0;
        canvas.addEventListener("blur", () => {
          canvasBlurs += 1;
          document.body.dataset.toolboxCanvasBlurs = String(canvasBlurs);
        });
        window.addEventListener("gw:input-reset", () => {
          inputResets += 1;
          document.body.dataset.toolboxInputResets = String(inputResets);
        });
        const toolbox = module.createToolboxFoundation(
          document.body,
          (shown) => {
            document.body.dataset.toolboxPanelRequest = shown ? "show" : "hide";
            return 1;
          },
        );
        toolbox.update({
          status: "ready",
          playerChatCount: 3,
          heroAvailable: true,
          heroCount: 1,
          firstHeroId: 7,
          panelState: 1,
          commandRequest: 1,
          commandComplete: 1,
          commandStatus: 1,
        });
        // Registered after the Toolbox capture/bubble boundary, standing in for
        // the game's global handlers. Interactive events must never reach it.
        window.addEventListener("keydown", () => {
          gameKeys += 1;
          document.body.dataset.toolboxGameKeys = String(gameKeys);
        });
        window.addEventListener("mousedown", () => {
          gameMouseDowns += 1;
          document.body.dataset.toolboxGameMouseDowns = String(gameMouseDowns);
        });
        Object.assign(document.body.dataset, {
          toolboxCanvasBlurs: "0",
          toolboxGameKeys: "0",
          toolboxGameMouseDowns: "0",
          toolboxInputResets: "0",
        });
        canvas.focus();
      });

      const root = page.locator("#toolbox-foundation");
      const panel = page.getByRole("dialog", { name: "Toolbox" });
      await expect(root).not.toHaveAttribute("data-open");
      await page.getByRole("button", { name: "Open Toolbox" }).click();
      await expect(root).toHaveAttribute("data-open", "true");
      await expect(panel).toBeVisible();
      await expect(page.getByRole("button", { name: "Close Toolbox" })).toBeFocused();
      await expect(page.locator("body")).toHaveAttribute("data-toolbox-canvas-blurs", "0");

      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Hide panel" })).toBeFocused();
      await page.keyboard.press("x");
      await expect(page.locator("body")).toHaveAttribute("data-toolbox-game-keys", "0");
      await page.getByRole("button", { name: "Show panel" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-toolbox-panel-request", "show");

      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(page.locator("#canvas")).toBeFocused();
      await expect(page.locator("body")).toHaveAttribute("data-toolbox-canvas-blurs", "0");

      await page.keyboard.press("Control+Shift+Space");
      await expect(panel).toBeVisible();
      await page.mouse.click(8, 8);
      await expect(panel).toBeHidden();
      await expect(page.locator("#canvas")).toBeFocused();
      await expect(page.locator("body")).toHaveAttribute("data-toolbox-game-mouse-downs", "0");
      expect(
        Number(await page.locator("body").getAttribute("data-toolbox-input-resets")),
      ).toBeGreaterThanOrEqual(4);
    } finally {
      await closeOffline(fixture);
    }
  });
});
