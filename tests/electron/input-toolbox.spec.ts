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
 * interface. Mounting the real Vue application would test Vue and make this
 * suite fail for reasons that have nothing to do with input.
 *
 * Be clear about what the stub does and does not prove. The focused smoke below
 * mounts the shipped Vue bundle through `tools-host.ts` and owns its embedded
 * window furniture and native-library seam. This test stays a stub because it
 * exhausts the renderer input boundary without duplicating the Tools workbench
 * flows or making each input assertion depend on Vue rendering.
 *
 * What the stub is not allowed to be is a *different* configuration. It draws
 * its own window with its own controls, including a text field, because that is
 * what a real tool does and the non-activating rule turns on exactly that
 * distinction: you operate a button, you type in a field.
 */
/**
 * Where the stub tool draws its window, in viewport pixels.
 *
 * The game click below is derived from this rather than written out again. A
 * tool draws a real window, and a window covering a pixel is entitled to that
 * pixel — so a game click aimed *through* the tool does not fail, it hangs on
 * Playwright's actionability check until the test times out. Deriving the point
 * is what stops the two from silently drifting on top of each other.
 */
const TOOL_WINDOW = { left: 24, top: 24, width: 280, height: 160 } as const;

/** A point on the canvas that the tool's window does not cover. */
const GAME_POINT = {
  x: 64,
  y: TOOL_WINDOW.top + TOOL_WINDOW.height + 80,
} as const;

test.describe("renderer Tools input", () => {
  test("floats over the game without stealing it", async () => {
    const fixture = await launchOffline("gw-toolbox-input-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(async (toolWindow) => {
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
              mountTool(
                host: HTMLElement,
                onVisibilityChange: (visible: boolean) => void,
              ): Promise<{
                setVisible(visible: boolean): void;
                update(state: object): void;
                dispose(): void;
              } | null>;
            },
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
        const toolbox = module.createToolboxFoundation(document.body, {
          // A tool draws its own window against the viewport and is handed the
          // overlay's layer to attach to. Everything else — the event stops,
          // the cursor mirror, the non-activating surface — it inherits.
          mountTool: (
            host: HTMLElement,
            onVisibilityChange: (visible: boolean) => void,
          ) => {
            const panel = document.createElement("div");
            panel.dataset.testid = "stub-tool";
            panel.style.cssText =
              `position:fixed;left:${toolWindow.left}px;top:${toolWindow.top}px;`
              + `width:${toolWindow.width}px;height:${toolWindow.height}px;`
              + "padding:12px;background:#141414;pointer-events:auto;display:none";
            const action = document.createElement("button");
            action.type = "button";
            action.textContent = "Tool action";
            const field = document.createElement("input");
            field.type = "text";
            field.setAttribute("aria-label", "Tool field");
            // A real tool draws its own close control and hides itself. The
            // overlay learns about it only through the callback.
            const close = document.createElement("button");
            close.type = "button";
            close.textContent = "Close tool";
            close.addEventListener("click", () => {
              panel.style.display = "none";
              onVisibilityChange(false);
            });
            panel.append(action, field, close);
            host.append(panel);
            let observations = 0;
            return Promise.resolve({
              setVisible: (visible: boolean) => {
                panel.style.display = visible ? "block" : "none";
              },
              // A real tool draws the party from this. The stub records what
              // arrived and when, which is the part the overlay is responsible
              // for; what the values mean is pinned elsewhere.
              update: (state: object) => {
                observations += 1;
                panel.dataset.observations = String(observations);
                panel.dataset.heroId = String(
                  (state as { firstHeroId?: number }).firstHeroId ?? "",
                );
              },
              dispose: () => panel.remove(),
            });
          },
        });
        // The observer publishes from the moment the game runs; a tool mounts on
        // first open, which is minutes later. Exposed so the test can publish
        // again once the tool exists.
        (globalThis as unknown as { publishToolbox(state: object): void })
          .publishToolbox = (state: object) => toolbox.update(state);
        // The projection still takes what the observer feeds it. What those
        // values mean is pinned at the real boundary by
        // tests/packaged-enhancement-runtime.ts, which reads them back through
        // window.gwCompanionRuntime.toolbox after a real kernel wrote them.
        // Asserting them here would only prove that an assignment assigns.
        toolbox.update({
          status: "ready",
          playerChatCount: 3,
          heroAvailable: true,
          heroCount: 1,
          firstHeroId: 7,
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
      }, TOOL_WINDOW);

      const body = page.locator("body");
      const root = page.locator("#toolbox-foundation");
      const tool = page.getByTestId("stub-tool");
      await expect(root).not.toHaveAttribute("data-open");
      await expect(tool).toBeHidden();

      // The game owns canvas clicks while the palette is closed.
      await page.locator("#canvas").click({ position: GAME_POINT });
      await expect(body).toHaveAttribute("data-toolbox-game-mouse-downs", "1");

      // Opening Tools is not a statement that you have stopped playing. The
      // keyboard stays with the game, so a held movement key keeps acting and
      // the player can still press more of them.
      await page.keyboard.down("KeyW");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "1");
      await page.getByRole("button", { name: "Open Tools" }).click();
      await expect(root).toHaveAttribute("data-open", "true");
      await expect(tool).toBeVisible();

      // The companion published before this tool existed. A tool that only
      // heard about the game from the *next* publish would sit blank until the
      // party happened to change, which on a quiet map is indefinitely — so the
      // overlay holds the last projection and replays it on mount.
      await expect(tool).toHaveAttribute("data-observations", "1");
      await expect(tool).toHaveAttribute("data-hero-id", "7");

      // And from here it follows the game live.
      await page.evaluate(() => {
        (globalThis as unknown as { publishToolbox(state: object): void })
          .publishToolbox({
            status: "ready",
            heroAvailable: true,
            heroCount: 2,
            firstHeroId: 24,
          });
      });
      await expect(tool).toHaveAttribute("data-observations", "2");
      await expect(tool).toHaveAttribute("data-hero-id", "24");

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

      // Non-modal: a game click outside the tool lands in the game, and the
      // tool stays open rather than dismissing itself.
      await page.locator("#canvas").click({ position: GAME_POINT });
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
      // chord, the menu, or the tool's own close control.
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

      // A tool that hides itself has to say so, because the overlay cannot see
      // it happen. Left unreported, the overlay goes on believing it is open:
      // the HUD chip stays hidden and the next toggle spends itself restoring
      // the chip instead of reopening the tool.
      await page.getByRole("button", { name: "Close tool" }).click();
      await expect(tool).toBeHidden();
      await expect(page.getByRole("button", { name: "Open Tools" }))
        .toBeVisible();
      await page.getByRole("button", { name: "Open Tools" }).click();
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

      // The chip says what it controls, and what it names exists. Two spellings
      // with nothing tying them together is how an aria reference goes dangling
      // in a rename; the projection it used to point at was `display: none` for
      // the whole life of every shipped launch.
      await expect(
        page.getByRole("button", { name: "Open Tools" }),
      ).toHaveAttribute("aria-controls", "toolbox-tool");
      await expect(page.locator("#toolbox-tool")).toHaveCount(1);

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

  test("mounts the shipped embedded Tools window and persists one library change", async () => {
    const fixture = await launchOffline("gw-toolbox-embedded-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(async () => {
        globalThis.document.getElementById("loading")?.classList.add("gone");
        const foundationSpecifier = "./toolbox-foundation.js";
        const hostSpecifier = "./tools-host.js";
        const [foundation, toolsHost] = await Promise.all([
          import(foundationSpecifier) as Promise<
            typeof import("../../src/renderer/toolbox-foundation.js")
          >,
          import(hostSpecifier) as Promise<
            typeof import("../../src/renderer/tools-host.js")
          >,
        ]);
        foundation.createToolboxFoundation(document.body, {
          mountTool: (host, onVisibilityChange) =>
            toolsHost.mountToolsInto(host, onVisibilityChange, null),
        });
      });

      const root = page.locator("#toolbox-foundation");
      const panel = page.locator(".tools-window");
      await page.getByRole("button", { name: "Open Tools" }).click();
      await expect(root).toHaveAttribute("data-open", "true");
      await expect(page.locator("#toolbox-tool")).toHaveAttribute("data-ready", "true");
      await expect(page.locator('.tools-stage[data-mode="embedded"]')).toBeVisible();
      await expect(page.getByRole("heading", { name: "GWonMac Tools" })).toBeVisible();
      await expect(page.getByText("Saved on this Mac")).toBeVisible();

      await page.getByRole("button", { name: "New team", exact: true }).click();
      await page.getByLabel("Name optional").fill("Embedded smoke team");
      await page.getByRole("button", { name: "Create team" }).click();
      await expect(page.locator(".library-row").filter({ hasText: "Embedded smoke team" }))
        .toHaveCount(1);
      const storedTeams = await page.evaluate(async () =>
        (await window.gwNative.buildLibrary.get()).library.teams.map((team) => team.name),
      );
      expect(storedTeams).toContain("Embedded smoke team");

      const before = await panel.boundingBox();
      expect(before).not.toBeNull();
      if (!before) throw new Error("The embedded Tools window has no bounds");
      await page.mouse.move(before.x + 80, before.y + 20);
      await page.mouse.down();
      await page.mouse.move(before.x + 60, before.y, { steps: 4 });
      await page.mouse.up();
      const after = await panel.boundingBox();
      expect(after).not.toBeNull();
      if (!after) throw new Error("The dragged Tools window has no bounds");
      expect(after.x).toBeLessThan(before.x - 10);
      expect(after.y).toBeLessThan(before.y - 10);

      await page.getByRole("button", { name: "Close GWonMac Tools" }).click();
      await expect(root).toHaveAttribute("data-open", "false");
      await expect(panel).toBeHidden();
      await page.getByRole("button", { name: "Open Tools" }).click();
      await expect(panel).toBeVisible();
      await expect(page.locator(".library-row").filter({ hasText: "Embedded smoke team" }))
        .toHaveCount(1);

      // Establish the boundary explicitly: Escape from a Tools field returns
      // the keyboard to Guild Wars without spending the in-game Escape or
      // closing the window. Reopening intentionally leaves focus on the game.
      const search = page.getByPlaceholder("Search names, tags, heroes, skills");
      await search.focus();
      await expect(search).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(panel).toBeVisible();
      await expect(page.locator("#canvas")).toBeFocused();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("disposes a lazy tool that resolves after its overlay was removed", async () => {
    const fixture = await launchOffline("gw-toolbox-late-mount-e2e-");
    try {
      const disposed = await fixture.page.evaluate(async () => {
        const specifier = "./toolbox-foundation.js";
        const module = await import(specifier) as {
          createToolboxFoundation(
            parent: HTMLElement,
            options: { mountTool(): Promise<{
              setVisible(visible: boolean): void;
              update(state: object): void;
              dispose(): void;
            }> },
          ): { dispose(): void };
        };
        let resolveMount!: (tool: {
          setVisible(visible: boolean): void;
          update(state: object): void;
          dispose(): void;
        }) => void;
        let count = 0;
        const foundation = module.createToolboxFoundation(document.body, {
          mountTool: () => new Promise((resolve) => { resolveMount = resolve; }),
        });
        document.querySelector<HTMLButtonElement>("#toolbox-foundation button")!.click();
        foundation.dispose();
        resolveMount({
          setVisible: () => undefined,
          update: () => undefined,
          dispose: () => { count += 1; },
        });
        await Promise.resolve();
        return count;
      });
      expect(disposed).toBe(1);
      await expect(fixture.page.locator("#toolbox-foundation")).toHaveCount(0);
    } finally {
      await closeOffline(fixture);
    }
  });
});
