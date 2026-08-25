import { expect, test } from "@playwright/test";
import {
  closeOffline,
  isDomActiveElement,
  launchCachedClient,
  launchOffline,
} from "./fixtures.mjs";
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
    const fixture = await launchCachedClient("gw-toolbox-input-e2e-");
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
                setActive?(active: boolean): void;
                requestClose(): void;
                update(state: object): void;
                dispose(): void;
              } | null>;
              mountTrade?(
                host: HTMLElement,
                onVisibilityChange: (visible: boolean) => void,
              ): Promise<{
                setVisible(visible: boolean): void;
                setActive?(active: boolean): void;
                requestClose(): void;
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
              setActive: (active: boolean) => {
                panel.dataset.active = String(active);
              },
              requestClose: () => {
                panel.style.display = "none";
                onVisibilityChange(false);
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
          mountTrade: (
            host: HTMLElement,
            onVisibilityChange: (visible: boolean) => void,
          ) => {
            const panel = document.createElement("div");
            panel.dataset.testid = "stub-trade";
            panel.style.cssText =
              "position:fixed;left:340px;top:24px;width:280px;height:160px;"
              + "padding:12px;background:#141414;pointer-events:auto;display:none";
            const action = document.createElement("button");
            action.type = "button";
            action.textContent = "Trade action";
            const field = document.createElement("input");
            field.type = "search";
            field.setAttribute("aria-label", "Trade field");
            const close = document.createElement("button");
            close.type = "button";
            close.textContent = "Close trade";
            const hide = () => {
              panel.style.display = "none";
              onVisibilityChange(false);
            };
            close.addEventListener("click", hide);
            panel.append(action, field, close);
            host.append(panel);
            return Promise.resolve({
              setVisible: (visible: boolean) => {
                panel.style.display = visible ? "block" : "none";
              },
              setActive: (active: boolean) => {
                panel.dataset.active = String(active);
              },
              requestClose: hide,
              update: () => undefined,
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
      const trade = page.getByTestId("stub-trade");
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
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:tools-toggle", { cancelable: true }));
      });
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

      // Trade is an independent surface. Opening it keeps Builds visible, and
      // Escape dismisses only the last raised surface.
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:trade-toggle", { cancelable: true }));
      });
      await expect(trade).toBeVisible();
      await expect(tool).toBeVisible();
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:trade-toggle", { cancelable: true }));
      });
      await expect(trade).toBeHidden();
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("gw:trade-toggle", { cancelable: true }));
      });
      await expect(trade).toBeVisible();
      await page.getByRole("button", { name: "Trade action" }).click();
      await expect(trade).toHaveAttribute("data-active", "true");
      await expect(tool).toHaveAttribute("data-active", "false");
      await page.keyboard.press("Escape");
      await expect(trade).toBeHidden();
      await expect(tool).toBeVisible();

      await expect.poll(() => isDomActiveElement(page.locator("#canvas")))
        .toBe(true);
      await expect(body).toHaveAttribute("data-toolbox-input-resets", "0");
      await page.keyboard.up("KeyW");
      await expect(body).toHaveAttribute("data-toolbox-game-key-ups", "1");
      await expect(body).toHaveAttribute("data-toolbox-last-key-up", "KeyW");

      // Tab is the explicit keyboard entry into the open topmost surface. It
      // is claimed before Guild Wars and wraps inside the surface at its ends.
      await page.keyboard.press("Tab");
      await expect.poll(() => isDomActiveElement(
        page.getByRole("button", { name: "Tool action" }),
      )).toBe(true);
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "1");
      await page.getByRole("button", { name: "Close tool" }).focus();
      await page.keyboard.press("Tab");
      await expect.poll(() => isDomActiveElement(
        page.getByRole("button", { name: "Tool action" }),
      )).toBe(true);
      await page.locator("#canvas").click({ position: GAME_POINT });

      // The tool is open and the game still has the keyboard.
      await page.keyboard.press("x");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "2");

      // The foundation draws no persistent HUD chrome over Guild Wars.
      await expect(root.locator('[data-role="hud"]')).toHaveCount(0);

      // Non-modal: a game click outside the tool lands in the game, and the
      // tool stays open rather than dismissing itself.
      await page.locator("#canvas").click({ position: GAME_POINT });
      await expect(tool).toBeVisible();
      await expect(body).toHaveAttribute("data-toolbox-game-mouse-downs", "3");
      await expect.poll(() => isDomActiveElement(page.locator("#canvas")))
        .toBe(true);

      // Non-activating: operating a tool control does not take the keyboard,
      // and does not leak the click into the game. This is the whole point —
      // the player clicks the panel and can still run.
      await page.getByRole("button", { name: "Tool action" }).click();
      await expect(body).toHaveAttribute("data-toolbox-game-mouse-downs", "3");
      await expect.poll(() => isDomActiveElement(page.locator("#canvas")))
        .toBe(true);
      await page.keyboard.press("x");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "3");

      // Clicking into a text field is the one gesture that means "I want to
      // type", so it hands the keyboard over — and what is typed stays inside
      // the overlay rather than reaching the game.
      await page.getByLabel("Tool field").click();
      await expect.poll(() => isDomActiveElement(page.getByLabel("Tool field")))
        .toBe(true);
      await page.keyboard.type("aggro");
      await expect(page.getByLabel("Tool field")).toHaveValue("aggro");
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "3");

      // Escape closes the topmost host surface even when a field owns focus.
      // It does not also spend an in-game Escape.
      await page.keyboard.press("Escape");
      await expect.poll(() => isDomActiveElement(page.locator("#canvas")))
        .toBe(true);
      await expect(tool).toBeHidden();
      await expect(body).toHaveAttribute("data-toolbox-game-keys", "3");

      await page.keyboard.press("Control+Shift+Space");
      await expect(tool).toBeVisible();

      // The same Escape closes Tools after a game click left focus on canvas.
      const gameKeysBeforeCanvasEscape = await body.getAttribute(
        "data-toolbox-game-keys",
      );
      await page.keyboard.press("Escape");
      await expect(tool).toBeHidden();
      await expect(body).toHaveAttribute(
        "data-toolbox-game-keys",
        gameKeysBeforeCanvasEscape ?? "",
      );

      // The chord toggles from anywhere.
      await page.keyboard.press("Control+Shift+Space");
      await expect(tool).toBeVisible();

      // A tool that hides itself has to say so, because the overlay cannot see
      // it happen. Left unreported, the overlay goes on believing it is open
      // and the next toggle closes an already-hidden tool.
      await page.getByRole("button", { name: "Close tool" }).click();
      await expect(tool).toBeHidden();
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

      // The stable host remains even though the retired HUD trigger does not.
      await expect(page.locator("#toolbox-builds")).toHaveCount(1);
      await expect(root.locator('[data-role="hud"]')).toHaveCount(0);

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
    const fixture = await launchCachedClient("gw-toolbox-embedded-e2e-");
    try {
      const { app, page } = fixture;
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
        const canvas = document.getElementById("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error("#canvas is missing");
        }
        document.body.dataset.storageOpens = "0";
        document.body.dataset.canvasPressesAfterStorage = "0";
        document.body.dataset.storageInputResets = "0";
        document.body.dataset.storageOrder = "";
        document.body.dataset.storageShiftDowns = "0";
        document.body.dataset.storageShiftUps = "0";
        const appendStorageOrder = (value: string) => {
          document.body.dataset.storageOrder = [
            ...(document.body.dataset.storageOrder?.split(",").filter(Boolean) ?? []),
            value,
          ].join(",");
        };
        const openStorage = () => {
          document.body.dataset.storageOpens = String(
            Number(document.body.dataset.storageOpens ?? "0") + 1,
          );
          appendStorageOrder("storage");
        };
        window.addEventListener("gw:input-reset", () => {
          document.body.dataset.storageInputResets = String(
            Number(document.body.dataset.storageInputResets ?? "0") + 1,
          );
          appendStorageOrder("reset");
        });
        window.addEventListener("gw:storage-open", (event) => {
          event.preventDefault();
          openStorage();
        });
        canvas.addEventListener("keydown", (event) => {
          if (event.key !== "Shift") return;
          document.body.dataset.storageShiftDowns = String(
            Number(document.body.dataset.storageShiftDowns ?? "0") + 1,
          );
        });
        canvas.addEventListener("keyup", (event) => {
          if (event.key !== "Shift") return;
          document.body.dataset.storageShiftUps = String(
            Number(document.body.dataset.storageShiftUps ?? "0") + 1,
          );
        });
        window.addEventListener("mousedown", (event) => {
          if (event.target !== canvas) return;
          document.body.dataset.canvasPressesAfterStorage = String(
            Number(document.body.dataset.canvasPressesAfterStorage ?? "0") + 1,
          );
        });
        foundation.createToolboxFoundation(document.body, {
          mountTool: (host, onVisibilityChange) =>
            toolsHost.mountToolsInto(host, onVisibilityChange, null, {
              open: openStorage,
              unavailable: () => null,
            }, true),
        });
      });

      const root = page.locator("#toolbox-foundation");
      const panel = page.locator(".tools-window");
      const canvas = page.locator("#canvas");
      const settleEmbeddedShow = async () => {
        // Tools sizes itself on the frame after it becomes visible. Cross that
        // exact deferred boundary so a show-time focus cannot steal the
        // keyboard back after the foundation has handed it to the game.
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
      };
      await page.keyboard.press("Control+Shift+Space");
      await expect(root).toHaveAttribute("data-open", "true");
      await expect(page.locator("#toolbox-builds")).toHaveAttribute("data-ready", "true");
      await expect(page.locator('.tools-stage[data-mode="embedded"]')).toBeVisible();
      await expect(page.getByRole("heading", { name: "GWonMac Tools" })).toBeVisible();
      await expect(page.getByText("Saved on this Mac")).toBeVisible();
      await settleEmbeddedShow();
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);

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
      await page.keyboard.press("Control+Shift+Space");
      await expect(panel).toBeVisible();
      await expect(page.locator(".library-row").filter({ hasText: "Embedded smoke team" }))
        .toHaveCount(1);
      await settleEmbeddedShow();
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);

      // Escape closes Tools from either a field or the game without spending
      // the same key in Guild Wars. Reopening leaves focus on the game.
      const search = page.getByPlaceholder("Search names, tags, heroes, skills");
      await search.focus();
      await expect.poll(() => isDomActiveElement(search)).toBe(true);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);
      await page.keyboard.press("Control+Shift+Space");
      await expect(panel).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);

      // The real Xunlai route closes Tools after it queues the named command.
      // Hiding the panel must also surrender every pixel to the game: the next
      // world press reaches the canvas instead of an invisible Tools surface.
      await page.keyboard.press("Control+Shift+Space");
      await expect(panel).toBeVisible();
      await page.getByRole("button", { name: "Open Xunlai Storage" }).click();
      await expect(page.locator("body")).toHaveAttribute("data-storage-opens", "1");
      await expect(root).toHaveAttribute("data-open", "false");
      await expect(panel).toBeHidden();
      const canvasBox = await canvas.boundingBox();
      if (!canvasBox) throw new Error("The game canvas has no bounds");
      await page.mouse.click(canvasBox.x + canvasBox.width - 80, canvasBox.y + 120);
      await expect(page.locator("body")).toHaveAttribute(
        "data-canvas-presses-after-storage",
        "1",
      );
      await expect.poll(() => isDomActiveElement(canvas)).toBe(true);

      // The successful Command-Shift-C route must release Shift before it
      // opens native storage. macOS can consume the physical release while
      // Command is held; without this reset Guild Wars keeps Shift pressed and
      // then refuses ordinary click-to-walk and NPC interaction.
      await page.evaluate(() => {
        document.body.dataset.storageOpens = "0";
        document.body.dataset.storageInputResets = "0";
        document.body.dataset.storageOrder = "";
        document.body.dataset.storageShiftDowns = "0";
        document.body.dataset.storageShiftUps = "0";
        document.getElementById("canvas")?.focus();
      });
      await app.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents;
        contents?.sendInputEvent({
          type: "keyDown",
          keyCode: "Shift",
          modifiers: ["shift"],
        });
        contents?.sendInputEvent({
          type: "keyDown",
          keyCode: "C",
          modifiers: ["meta", "shift"],
        });
        contents?.sendInputEvent({
          type: "keyUp",
          keyCode: "C",
          modifiers: ["meta", "shift"],
        });
        // Deliberately omit Shift-up. This is the AppKit loss the production
        // reset must contain rather than relying on a later physical event.
      });
      await expect(page.locator("body")).toHaveAttribute("data-storage-opens", "1");
      await expect(page.locator("body")).toHaveAttribute(
        "data-storage-input-resets",
        "1",
      );
      await expect(page.locator("body")).toHaveAttribute(
        "data-storage-order",
        "reset,storage",
      );
      await expect(page.locator("body")).toHaveAttribute(
        "data-storage-shift-downs",
        "1",
      );
      await expect(page.locator("body")).toHaveAttribute(
        "data-storage-shift-ups",
        "1",
      );
    } finally {
      await closeOffline(fixture);
    }
  });

  test("disposes a lazy tool that resolves after its overlay was removed", async () => {
    const fixture = await launchOffline("gw-toolbox-late-mount-e2e-");
    try {
      const disposed = await fixture.page.evaluate(async () => {
        const specifier = "./toolbox-foundation.js";
        const surfaceSpecifier = "./surface-controller.js";
        const [module, surfaces] = await Promise.all([
          import(specifier),
          import(surfaceSpecifier),
        ]) as [{
          createToolboxFoundation(
            parent: HTMLElement,
            options: { mountTool(): Promise<{
              setVisible(visible: boolean): void;
              requestClose(): void;
              update(state: object): void;
              dispose(): void;
            }> },
          ): { dispose(): void };
        }, typeof import("../../src/renderer/surface-controller.js")];
        window.gwSurfaces = surfaces.installSurfaceController(document);
        let resolveMount!: (tool: {
          setVisible(visible: boolean): void;
          requestClose(): void;
          update(state: object): void;
          dispose(): void;
        }) => void;
        let count = 0;
        const foundation = module.createToolboxFoundation(document.body, {
          mountTool: () => new Promise((resolve) => { resolveMount = resolve; }),
        });
        window.dispatchEvent(new CustomEvent("gw:tools-toggle", { cancelable: true }));
        foundation.dispose();
        resolveMount({
          setVisible: () => undefined,
          requestClose: () => undefined,
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
