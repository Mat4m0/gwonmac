import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

/**
 * The overlay's boundary, driven through the configuration the app actually
 * ships: an overlay with a tool mounted in it.
 *
 * The tool here is a stub, not the Tools bundle. The subject of this file is
 * the boundary — what reaches the game, what stops at the overlay, and who
 * holds the keyboard — and the tool is a collaborator behind a two-method
 * interface. Mounting the real Vue application would test Vue, make this suite
 * fail for reasons that have nothing to do with input, and duplicate
 * apps/tools/tests/workbench.spec.ts, which owns that.
 *
 * What the stub is not allowed to be is a *different* configuration. It draws
 * its own window with its own controls, including a text field, because that is
 * what a real tool does and the non-activating rule turns on exactly that
 * distinction: you operate a button, you type in a field.
 */
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
            options: {
              mountTool(host: HTMLElement): Promise<{
                setVisible(visible: boolean): void;
                dispose(): void;
              } | null>;
            },
          ): {
            update(state: object): void;
            readonly state: { playerChatCount?: number };
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
        const toolbox = module.createToolboxFoundation(document.body, {
          // A tool draws its own window against the viewport and is handed the
          // overlay's layer to attach to. Everything else — the event stops,
          // the cursor mirror, the non-activating surface — it inherits.
          mountTool: (host: HTMLElement) => {
            const panel = document.createElement("div");
            panel.dataset.testid = "stub-tool";
            panel.style.cssText =
              "position:fixed;left:24px;top:24px;width:280px;height:160px;"
              + "padding:12px;background:#141414;pointer-events:auto;display:none";
            const action = document.createElement("button");
            action.type = "button";
            action.textContent = "Tool action";
            const field = document.createElement("input");
            field.type = "text";
            field.setAttribute("aria-label", "Tool field");
            panel.append(action, field);
            host.append(panel);
            return Promise.resolve({
              setVisible: (visible: boolean) => {
                panel.style.display = visible ? "block" : "none";
              },
              dispose: () => panel.remove(),
            });
          },
        });
        toolbox.update({
          status: "ready",
          playerChatCount: 3,
          heroAvailable: true,
          heroCount: 1,
          firstHeroId: 7,
          panelState: 1,
        });
        // The companion projection outlives the readout that used to draw it.
        (globalThis as unknown as Record<string, unknown>).gwToolboxUnderTest =
          toolbox;
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
      const tool = page.getByTestId("stub-tool");
      await expect(root).not.toHaveAttribute("data-open");
      await expect(tool).toBeHidden();

      // The game owns canvas clicks while the palette is closed.
      await page.locator("#canvas").click({ position: { x: 64, y: 64 } });
      await expect(body).toHaveAttribute("data-toolbox-game-mouse-downs", "1");

      // Opening Tools is not a statement that you have stopped playing. The
      // keyboard stays with the game, so a held movement key keeps acting and
      // the player can still press more of them.
      await page.keyboard.down("KeyW");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "1");
      await page.getByRole("button", { name: "Open Tools" }).click();
      await expect(root).toHaveAttribute("data-open", "true");
      await expect(tool).toBeVisible();
      await expect(page.locator("#canvas")).toBeFocused();
      await expect(body).toHaveAttribute("data-toolbox-input-resets", "0");
      await page.keyboard.up("KeyW");
      await expect(body).toHaveAttribute("data-toolbox-game-key-ups", "1");
      await expect(body).toHaveAttribute("data-toolbox-last-key-up", "KeyW");

      // The tool is open and the game still has the keyboard.
      await page.keyboard.press("x");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "2");

      // The HUD chip gives way to the tool rather than sitting on top of it.
      await expect(page.getByRole("button", { name: "Open Tools" })).toBeHidden();

      // Non-modal: a game click lands in the game and the tool stays open.
      await page.locator("#canvas").click({ position: { x: 64, y: 64 } });
      await expect(tool).toBeVisible();
      await expect(body).toHaveAttribute("data-toolbox-game-mouse-downs", "2");
      await expect(page.locator("#canvas")).toBeFocused();

      // Non-activating: operating a tool control does not take the keyboard,
      // and does not leak the click into the game. This is the whole point —
      // the player clicks the panel and can still run.
      await page.getByRole("button", { name: "Tool action" }).click();
      await expect(body).toHaveAttribute("data-toolbox-game-mouse-downs", "2");
      await expect(page.locator("#canvas")).toBeFocused();
      await page.keyboard.press("x");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "3");

      // Clicking into a text field is the one gesture that means "I want to
      // type", so it hands the keyboard over — and what is typed stays inside
      // the overlay rather than reaching the game.
      await page.getByLabel("Tool field").click();
      await expect(page.getByLabel("Tool field")).toBeFocused();
      await page.keyboard.type("aggro");
      await expect(page.getByLabel("Tool field")).toHaveValue("aggro");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "3");

      // Escape means "stop typing" and gives the game back. It never reaches
      // Guild Wars from here, and it does not close the tool: closing is the
      // chord, the menu, or the tool's own control.
      await page.keyboard.press("Escape");
      await expect(page.locator("#canvas")).toBeFocused();
      await expect(tool).toBeVisible();
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "3");

      // With the game holding the keyboard again, Escape belongs to Guild Wars.
      await page.keyboard.press("Escape");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "4");
      await expect(tool).toBeVisible();

      // The chord toggles from anywhere.
      await page.keyboard.press("Control+Shift+Space");
      await expect(tool).toBeHidden();
      await expect(page.getByRole("button", { name: "Open Tools" })).toBeVisible();
      await page.keyboard.press("Control+Shift+Space");
      await expect(tool).toBeVisible();

      // The menu route: the main process sends `tools.toggle`, and the renderer
      // command handler needs to know whether anything was listening. The
      // overlay answers by cancelling the event — an uncancelled one is how
      // `commands.ts` tells a player the capability is not installed.
      const claimed = await page.evaluate(() =>
        !window.dispatchEvent(
          new CustomEvent("gw:tools-toggle", { cancelable: true }),
        ),
      );
      expect(claimed).toBe(true);
      await expect(tool).toBeHidden();

      // The palette never reset game input during any of the above.
      await expect(body).toHaveAttribute("data-toolbox-input-resets", "0");

      // The companion's toolbox projection is still published for a live
      // console session, even though nothing draws it any more.
      const projected = await page.evaluate(
        () =>
          (
            globalThis as unknown as {
              gwToolboxUnderTest: { state: { playerChatCount?: number } };
            }
          ).gwToolboxUnderTest.state.playerChatCount,
      );
      expect(projected).toBe(3);

      // The native game cursor published on the canvas is mirrored over
      // Tools chrome, and clears back to the system arrow with it.
      const cursors = await page.evaluate(async () => {
        const canvas = globalThis.document.getElementById("canvas");
        const root = globalThis.document.getElementById("toolbox-foundation");
        if (!(canvas instanceof globalThis.HTMLElement) || !root) {
          throw new Error("cursor mirror targets are missing");
        }
        const observed = () =>
          new Promise<string>((resolve) => {
            requestAnimationFrame(() => resolve(root.style.cursor));
          });
        canvas.style.cursor = "crosshair";
        const mirrored = await observed();
        canvas.style.cursor = "";
        const cleared = await observed();
        return { cleared, mirrored };
      });
      expect(cursors.mirrored).toBe("crosshair");
      expect(cursors.cleared).toBe("");
    } finally {
      await closeOffline(fixture);
    }
  });
});
