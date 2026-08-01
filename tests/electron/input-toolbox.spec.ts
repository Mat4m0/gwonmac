import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test.describe("renderer Tools input", () => {
  test("floats over the game without stealing it", async () => {
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
          ): {
            update(state: object): void;
          };
        };
        let gameKeys = 0;
        let gameKeyUps = 0;
        let gameMouseDowns = 0;
        let inputResets = 0;
        window.addEventListener("gw:input-reset", () => {
          inputResets += 1;
          document.body.dataset.toolboxInputResets = String(inputResets);
        });
        const toolbox = module.createToolboxFoundation(document.body);
        toolbox.update({
          status: "ready",
          playerChatCount: 3,
          heroAvailable: true,
          heroCount: 1,
          firstHeroId: 7,
          panelState: 1,
        });
        // Registered after the Tools capture/bubble boundary, standing in for
        // the game's global handlers. Events on Tools chrome must never reach
        // them; events on the game canvas always must, and a release for a
        // press the canvas received must arrive even when it lands elsewhere.
        window.addEventListener("keydown", () => {
          gameKeys += 1;
          document.body.dataset.toolboxGameKeys = String(gameKeys);
        });
        window.addEventListener("keyup", (event) => {
          gameKeyUps += 1;
          document.body.dataset.toolboxGameKeyUps = String(gameKeyUps);
          document.body.dataset.toolboxLastKeyUp = event.code;
        });
        window.addEventListener("mousedown", () => {
          gameMouseDowns += 1;
          document.body.dataset.toolboxGameMouseDowns = String(gameMouseDowns);
        });
        Object.assign(document.body.dataset, {
          toolboxGameKeys: "0",
          toolboxGameKeyUps: "0",
          toolboxGameMouseDowns: "0",
          toolboxInputResets: "0",
        });
        canvas.focus();
      });

      const body = page.locator("body");
      const root = page.locator("#toolbox-foundation");
      const panel = page.getByRole("dialog", { name: "Tools" });
      await expect(root).not.toHaveAttribute("data-open");

      // The game owns canvas clicks while the palette is closed.
      await page.locator("#canvas").click({ position: { x: 64, y: 64 } });
      await expect(body).toHaveAttribute("data-toolbox-game-mouse-downs", "1");

      // A movement key held across opening keeps acting: opening neither
      // resets game input nor swallows the eventual release. The release
      // lands on the focused panel, and the input host replays it at the
      // canvas so the game lets go of the key.
      await page.keyboard.down("KeyW");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "1");
      await page.getByRole("button", { name: "Open Tools" }).click();
      await expect(root).toHaveAttribute("data-open", "true");
      await expect(panel).toBeVisible();
      await expect(panel).toBeFocused();
      await expect(body).toHaveAttribute("data-toolbox-input-resets", "0");
      await page.keyboard.up("KeyW");
      await expect(body).toHaveAttribute("data-toolbox-game-key-ups", "1");
      await expect(body).toHaveAttribute("data-toolbox-last-key-up", "KeyW");

      // Keys pressed inside the panel stay inside it — including their
      // releases, which the replay must not forward.
      await page.keyboard.press("x");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "1");
      await expect(body).toHaveAttribute("data-toolbox-game-key-ups", "1");
      await expect(page.getByText("Hero panel observed · hidden")).toBeVisible();

      // Non-modal: a game click lands in the game, the palette stays open,
      // and keyboard focus follows the click back to the canvas.
      await page.locator("#canvas").click({ position: { x: 64, y: 64 } });
      await expect(panel).toBeVisible();
      await expect(body).toHaveAttribute("data-toolbox-game-mouse-downs", "2");
      await expect(page.locator("#canvas")).toBeFocused();
      await page.keyboard.press("x");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "2");

      // Clicking the palette takes keyboard focus back without leaking the
      // click or subsequent keys into the game.
      await panel.click({ position: { x: 8, y: 60 } });
      await expect(body).toHaveAttribute("data-toolbox-game-mouse-downs", "2");
      await page.keyboard.press("x");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "2");

      // Dragging the titlebar moves the panel and the position survives
      // closing and reopening.
      const before = await panel.boundingBox();
      if (!before) throw new Error("panel bounding box is missing");
      await page.mouse.move(before.x + 120, before.y + 14);
      await page.mouse.down();
      await page.mouse.move(before.x + 40, before.y - 106, { steps: 4 });
      await page.mouse.up();
      const after = await panel.boundingBox();
      if (!after) throw new Error("panel bounding box is missing");
      expect(after.x).toBeCloseTo(before.x - 80, 0);
      expect(after.y).toBeCloseTo(before.y - 120, 0);
      await expect(body).toHaveAttribute("data-toolbox-game-mouse-downs", "2");
      await page.getByRole("button", { name: "Close Tools" }).click();
      await expect(panel).toBeHidden();
      await page.getByRole("button", { name: "Open Tools" }).click();
      const reopened = await panel.boundingBox();
      if (!reopened) throw new Error("panel bounding box is missing");
      expect(reopened.x).toBeCloseTo(after.x, 0);
      expect(reopened.y).toBeCloseTo(after.y, 0);

      // Escape closes only from palette focus and hands the game back.
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(page.locator("#canvas")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "3");

      // The chord toggles from anywhere.
      await page.keyboard.press("Control+Shift+Space");
      await expect(panel).toBeVisible();
      await page.keyboard.press("Control+Shift+Space");
      await expect(panel).toBeHidden();
      await expect(page.locator("#canvas")).toBeFocused();

      // The palette never reset game input during any of the above.
      await expect(body).toHaveAttribute("data-toolbox-input-resets", "0");
    } finally {
      await closeOffline(fixture);
    }
  });
});
