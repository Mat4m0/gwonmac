import { expect, test } from "@playwright/test";
import { closeOffline, launchPlayableClient } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

type KeyboardInputWindow = typeof window & {
  __gameKeys: string[];
};

type MemoryWarningModule = typeof import("../../src/renderer/memory-warning.js");

/**
 * ArenaNet's generated host object owns the active OSK field. Intersecting its
 * declaration keeps these tests narrower than an untyped Module replacement.
 */
type OskModuleHost = NonNullable<Window["Module"]> & {
  oskActiveInput?: EventTarget | null;
};

test.describe("renderer keyboard input", () => {
  test("keeps game text entry native-assistance free without blurring the game", async () => {
    const fixture = await launchPlayableClient("gw-text-input-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const result = await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const text = globalThis.document.getElementById("osk-input-text");
        if (!canvas) throw new Error("#canvas is missing");
        if (!(text instanceof globalThis.HTMLInputElement)) {
          throw new Error("#osk-input-text is missing");
        }
        const gameModule = window.Module as OskModuleHost | undefined;
        if (!gameModule) throw new Error("window.Module is not installed");
        const inputs = [...globalThis.document.querySelectorAll(".osk-input")];
        let clientSawCanvasBlur = false;
        canvas.addEventListener("blur", () => {
          clientSawCanvasBlur = true;
        });

        canvas.focus();
        gameModule.oskActiveInput = text;
        text.focus();

        const attributes = Object.fromEntries(
          ["autocomplete", "autocorrect", "autocapitalize", "spellcheck", "writingsuggestions"]
            .map((name) => [name, inputs.map((input) => input.getAttribute(name))]),
        );
        const activeElement = globalThis.document.activeElement?.id;
        gameModule.oskActiveInput = null;
        text.blur();
        canvas.focus();
        return { activeElement, attributes, clientSawCanvasBlur };
      });

      expect(result).toEqual({
        activeElement: "osk-input-text",
        attributes: {
          autocomplete: Array(5).fill("off"),
          autocorrect: Array(5).fill("off"),
          autocapitalize: Array(5).fill("off"),
          spellcheck: Array(5).fill("false"),
          writingsuggestions: Array(5).fill("false"),
        },
        clientSawCanvasBlur: false,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps same-window controls inside the game focus lifecycle", async () => {
    const fixture = await launchPlayableClient("gw-internal-focus-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const result = await page.evaluate(() => {
        const canvas = document.getElementById("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error("#canvas is missing");
        }
        const control = document.createElement("input");
        control.setAttribute("aria-label", "Renderer control");
        document.body.append(control);
        let clientCanvasBlurs = 0;
        canvas.addEventListener("blur", () => {
          clientCanvasBlurs += 1;
        });

        canvas.focus();
        control.focus();
        const afterInternalTransfer = clientCanvasBlurs;

        canvas.focus();
        canvas.dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
        const afterWindowBlur = clientCanvasBlurs;
        control.remove();
        return { afterInternalTransfer, afterWindowBlur };
      });

      expect(result).toEqual({
        afterInternalTransfer: 0,
        afterWindowBlur: 1,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("lets the client own Tab focus between login fields", async () => {
    const fixture = await launchPlayableClient("gw-tab-focus-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const email = document.getElementById("osk-input-email");
        const password = document.getElementById("osk-input-password");
        const gameModule = window.Module as OskModuleHost | undefined;
        if (!(email instanceof HTMLInputElement)) throw new Error("email proxy is missing");
        if (!(password instanceof HTMLInputElement)) throw new Error("password proxy is missing");
        if (!gameModule) throw new Error("window.Module is not installed");
        (window as typeof window & { __tabPrevented?: boolean }).__tabPrevented = false;
        email.addEventListener("keydown", (event) => {
          if (event.key !== "Tab") return;
          (window as typeof window & { __tabPrevented?: boolean }).__tabPrevented =
            event.defaultPrevented;
          gameModule.oskActiveInput = password;
          password.focus();
        }, { once: true });
        gameModule.oskActiveInput = email;
        email.focus();
      });

      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => {
        const clientChoice = (window.Module as OskModuleHost).oskActiveInput;
        return {
          active: document.activeElement?.id,
          clientChoice: clientChoice instanceof Element ? clientChoice.id : null,
          prevented: (window as typeof window & { __tabPrevented?: boolean }).__tabPrevented,
        };
      })).toEqual({
        active: "osk-input-password",
        clientChoice: "osk-input-password",
        prevented: true,
      });

      // A proxy the client did not claim must return focus to the canvas, not
      // leave the document body as an intermittent keyboard dead end.
      expect(await page.evaluate(async () => {
        const email = document.getElementById("osk-input-email");
        const gameModule = window.Module as OskModuleHost;
        gameModule.oskActiveInput = null;
        email?.focus();
        await Promise.resolve();
        return document.activeElement?.id;
      })).toBe("canvas");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps the memory warning passive until a player clicks it", async () => {
    const fixture = await launchPlayableClient("gw-memory-warning-input-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(async () => {
        const canvas = document.getElementById("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error("#canvas is missing");
        }
        const moduleUrl: string = "gw://app/memory-warning.js";
        const { bindMemoryWarning } = await import(moduleUrl) as MemoryWarningModule;
        const presenter = bindMemoryWarning(document, {
          autoRelogAfterReload: false,
          async saveAutoRelog() {},
          reload() {},
        });
        if (!presenter) throw new Error("memory warning is unavailable");

        canvas.dataset.memoryWarningKeys = "";
        canvas.addEventListener("keydown", (event) => {
          canvas.dataset.memoryWarningKeys += `${event.code} `;
        }, true);
        canvas.focus();
        presenter.present("critical", 2_147_483_648);
      });

      const canvas = page.locator("#canvas");
      await expect(page.locator("#memory-notice")).toBeVisible();
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("canvas");
      await page.keyboard.press("Tab");
      // This fixture has no client-owned Tab default. Restore the game target
      // so Escape independently proves that the warning does not claim it.
      await canvas.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) {
          throw new Error("#canvas is missing");
        }
        element.focus();
      });
      await page.keyboard.press("Escape");
      await expect(canvas).toHaveAttribute("data-memory-warning-keys", "Tab Escape ");
      await expect(page.locator("#memory-notice")).toBeVisible();

      await page.getByRole("button", { name: "Later" }).evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Later button is missing");
        }
        button.click();
      });
      await expect(page.locator("#memory-notice")).toBeHidden();
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("canvas");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("buffers only the first immediate character-selection Enter", async () => {
    const fixture = await launchPlayableClient("gw-character-enter-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = document.getElementById("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas is missing");
        new XMLHttpRequest().open("POST", "/webgate/my_account/token.xml");
        (window as typeof window & { __characterEnters?: unknown[] }).__characterEnters = [];
        for (const type of ["keydown", "keyup"] as const) {
          canvas.addEventListener(type, (event) => {
            if (event.key !== "Enter") return;
            (window as typeof window & { __characterEnters?: unknown[] })
              .__characterEnters?.push({
                type: event.type,
                trusted: event.isTrusted,
              });
          });
        }
        canvas.focus();
      });

      await page.keyboard.press("Enter");
      await expect.poll(() => page.evaluate(() =>
        (window as typeof window & { __characterEnters?: unknown[] }).__characterEnters,
      )).toHaveLength(2);
      expect(await page.evaluate(() =>
        (window as typeof window & {
          __characterEnters?: Array<{ type: string; trusted: boolean }>;
        }).__characterEnters,
      )).toEqual([
        { type: "keydown", trusted: false },
        { type: "keyup", trusted: false },
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("submits login and certified pre-game input through the intended routes", async () => {
    const fixture = await launchPlayableClient("gw-character-relog-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(async () => {
        const moduleUrl: string = "gw://app/input.js";
        const { installGameInput } = await import(moduleUrl) as
          typeof import("../../src/renderer/input.js");
        const canvas = document.createElement("canvas");
        canvas.tabIndex = 0;
        const loginField = document.createElement("input");
        document.body.append(canvas, loginField);
        const events: Array<{ trusted: boolean; type: string }> = [];
        for (const type of ["keydown", "keyup"] as const) {
          for (const target of [canvas, loginField]) {
            target.addEventListener(type, (event) => {
              if (event instanceof KeyboardEvent && event.key === "Enter") {
                events.push({
                  trusted: event.isTrusted,
                  type,
                });
              }
            });
          }
        }
        const input = installGameInput({
          canvas,
          textInputs: new Set([loginField]),
          log: () => undefined,
        });
        canvas.focus();
        input.submitSavedLogin();
        Object.assign(window, {
          __relogInput: input,
          __relogCanvas: canvas,
          __relogInputField: loginField,
          __relogEvents: events,
        });
      });

      await expect.poll(() => page.evaluate(() =>
        (window as typeof window & { __relogEvents?: unknown[] }).__relogEvents,
      )).toHaveLength(2);
      const automatic = await page.evaluate(() =>
        (window as typeof window & {
          __relogEvents?: Array<{ trusted: boolean; type: string }>;
        }).__relogEvents ?? [],
      );
      expect(automatic.map(({ trusted, type }) => ({ trusted, type }))).toEqual([
        { trusted: false, type: "keydown" },
        { trusted: false, type: "keyup" },
      ]);
      const outcome = await page.evaluate(async () => {
        const testWindow = window as typeof window & {
          __relogInput?: GameInputController;
          __relogCanvas?: HTMLCanvasElement;
          __relogInputField?: HTMLInputElement;
          __relogEvents?: unknown[];
        };
        testWindow.__relogEvents?.splice(0);
        testWindow.__relogCanvas?.focus();
        window.gwPreGameControls = { state: () => 'character-select', switchContext: () => 'character-select', diagnosticMask: () => 0 };
        return testWindow.__relogInput?.playSelectedCharacter();
      });
      const restoration = await page.evaluate(() =>
        (window as typeof window & {
          __relogEvents?: Array<{ trusted: boolean; type: string; afterMs: number }>;
        }).__relogEvents ?? [],
      );
      expect(restoration.map(({ trusted, type }) => ({ trusted, type }))).toEqual([
        { trusted: false, type: "keydown" },
        { trusted: false, type: "keyup" },
      ]);
      expect(outcome).toBe('sent');

      expect(await page.evaluate(async () => {
        const testWindow = window as typeof window & {
          __relogInput?: GameInputController;
          __relogEvents?: unknown[];
        };
        testWindow.__relogEvents?.splice(0);
        window.gwPreGameControls = { state: () => 'unknown', switchContext: () => 'unavailable', diagnosticMask: () => 0 };
        const outcome = await testWindow.__relogInput
          ?.playSelectedCharacter();
        return { outcome, events: testWindow.__relogEvents };
      })).toEqual({ outcome: 'cancelled', events: [] });

      expect(await page.evaluate(async () => {
        const testWindow = window as typeof window & {
          __relogInput?: GameInputController;
          __relogEvents?: unknown[];
        };
        testWindow.__relogEvents?.splice(0);
        window.gwPreGameControls = { state: () => 'reconnect', switchContext: () => 'loading', diagnosticMask: () => 0 };
        const outcome = await testWindow.__relogInput?.acceptReconnect();
        return { outcome, events: testWindow.__relogEvents };
      })).toEqual({
        outcome: 'sent',
        events: [
          expect.objectContaining({ trusted: false, type: 'keydown' }),
          expect.objectContaining({ trusted: false, type: 'keyup' }),
        ],
      });

      expect(await page.evaluate(async () => {
        const testWindow = window as typeof window & {
          __relogInput?: GameInputController;
          __relogEvents?: unknown[];
        };
        testWindow.__relogEvents?.splice(0);
        window.gwPreGameControls = { state: () => 'loading', switchContext: () => 'loading', diagnosticMask: () => 0 };
        const outcome = await testWindow.__relogInput?.acceptReconnect();
        return { outcome, events: testWindow.__relogEvents };
      })).toEqual({ outcome: 'progressed', events: [] });

      await page.evaluate(() => {
        const testWindow = window as typeof window & {
          __relogInput?: GameInputController;
          __relogCanvas?: HTMLCanvasElement;
          __relogInputField?: HTMLInputElement;
          __relogEvents?: unknown[];
        };
        testWindow.__relogEvents?.splice(0);
        testWindow.__relogInputField?.focus();
        testWindow.__relogInput?.submitSavedLogin();
      });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(260);
      expect(await page.evaluate(() =>
        (window as typeof window & {
          __relogEvents?: Array<{ trusted: boolean; type: string }>;
        }).__relogEvents?.map(({ trusted, type }) => ({ trusted, type })),
      )).toEqual([
        { trusted: true, type: "keydown" },
        { trusted: true, type: "keyup" },
      ]);

      await page.evaluate(() => {
        const testWindow = window as typeof window & {
          __relogInput?: GameInputController;
          __relogCanvas?: HTMLCanvasElement;
          __relogEvents?: unknown[];
        };
        testWindow.__relogEvents?.splice(0);
        testWindow.__relogCanvas?.focus();
        testWindow.__relogInput?.expectCharacterSelection();
      });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(420);
      expect(await page.evaluate(() =>
        (window as typeof window & {
          __relogEvents?: Array<{ trusted: boolean; type: string }>;
        }).__relogEvents?.filter(({ trusted }) => !trusted),
      )).toHaveLength(2);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("uses physical main-block keys without changing typed text", async () => {
    const fixture = await launchPlayableClient("gw-physical-key-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("#canvas is missing");
        const testWindow = window as KeyboardInputWindow;
        testWindow.__gameKeys = [];
        // Registered after the game input host, so anything it stops — the
        // rewritten original — never arrives here or at the client.
        for (const type of ["keydown", "keyup"] as const) {
          window.addEventListener(
            type,
            (event) => {
              testWindow.__gameKeys.push(
                `${event.type}:${event.code}:${event.key}:${event.keyCode}`,
              );
            },
            true,
          );
        }
        canvas.focus();
      });

      // A layout changes `key`, but the physical `code` stays put. Changing
      // layouts between a press and release must not strand the old key, and
      // two physical positions that produce the same letter must stay distinct.
      const cdp = await fixture.app.context().newCDPSession(page);
      const sendKey = (
        type: "keyDown" | "keyUp",
        code: string,
        key: string,
        virtualKeyCode: number,
        modifiers = 0,
        text?: string,
        repeat = false,
      ) =>
        cdp.send("Input.dispatchKeyEvent", {
          type,
          key,
          code,
          windowsVirtualKeyCode: virtualKeyCode,
          nativeVirtualKeyCode: virtualKeyCode,
          modifiers,
          autoRepeat: repeat,
          ...(text === undefined ? {} : { text }),
        });

      await sendKey("keyDown", "KeyW", "w", 87);
      await sendKey("keyUp", "KeyW", "z", 90);
      await sendKey("keyDown", "KeyW", "z", 90);
      // The registry must hold the physical key, or interruption releases a
      // key the client never saw pressed.
      await page.evaluate(() =>
        window.dispatchEvent(new globalThis.CustomEvent("gw:input-reset")),
      );
      await sendKey("keyDown", "KeyZ", "w", 87);
      await sendKey("keyUp", "KeyZ", "w", 87);

      const characterCases = [
        ["Digit1", "&", "1", 49],
        ["Backquote", "§", "`", 192],
        ["Minus", ")", "-", 189],
        ["Equal", "´", "=", 187],
        ["BracketLeft", "ü", "[", 219],
        ["BracketRight", "+", "]", 221],
        ["Backslash", "#", "\\", 220],
        ["Semicolon", "ö", ";", 186],
        ["Quote", "ä", "'", 222],
        ["Comma", ";", ",", 188],
        ["Period", ":", ".", 190],
        ["Slash", "-", "/", 191],
      ] as const;
      for (const [code, layoutKey, , keyCode] of characterCases) {
        await sendKey("keyDown", code, layoutKey, keyCode);
        await sendKey("keyUp", code, layoutKey, keyCode);
      }
      await sendKey("keyDown", "KeyW", "∑", 87, 1);
      await sendKey("keyUp", "KeyW", "∑", 87, 1);
      // Unsupported positions keep the official client's character semantics,
      // but a modifier or layout change during one hold must not strand them.
      await sendKey("keyDown", "IntlBackslash", "<", 226);
      await sendKey(
        "keyDown",
        "IntlBackslash",
        "≤",
        226,
        1,
        undefined,
        true,
      );
      await sendKey("keyUp", "IntlBackslash", "≤", 226, 1);

      expect(
        await page.evaluate(() => (window as KeyboardInputWindow).__gameKeys),
      ).toEqual([
        "keydown:KeyW:w:87",
        "keyup:KeyW:w:90",
        "keydown:KeyW:w:90",
        "keyup:KeyW:w:90",
        "keydown:KeyZ:z:87",
        "keyup:KeyZ:z:87",
        ...characterCases.flatMap(([code, , canonicalKey, keyCode]) => [
          `keydown:${code}:${canonicalKey}:${keyCode}`,
          `keyup:${code}:${canonicalKey}:${keyCode}`,
        ]),
        "keydown:KeyW:w:87",
        "keyup:KeyW:w:87",
        "keydown:IntlBackslash:<:226",
        "keydown:IntlBackslash:<:226",
        "keyup:IntlBackslash:<:226",
      ]);

      // The client relays key events from its own text fields to the canvas,
      // so they need the physical identity too. Stopping propagation must not
      // cost the field the layout-aware character the OS composed.
      await page.evaluate(() => {
        const text = globalThis.document.getElementById("osk-input-text");
        if (!(text instanceof globalThis.HTMLInputElement)) {
          throw new Error("#osk-input-text is missing");
        }
        const gameModule = window.Module as OskModuleHost | undefined;
        if (!gameModule) throw new Error("window.Module is not installed");
        (window as KeyboardInputWindow).__gameKeys = [];
        gameModule.oskActiveInput = text;
        text.value = "";
        text.focus();
      });
      await sendKey("keyDown", "KeyW", "z", 90, 0, "z");
      await sendKey("keyUp", "KeyW", "z", 90);
      expect(
        await page.evaluate(() => {
          const text = globalThis.document.getElementById("osk-input-text");
          if (!(text instanceof globalThis.HTMLInputElement)) {
            throw new Error("#osk-input-text is missing");
          }
          return {
            keys: (window as KeyboardInputWindow).__gameKeys,
            typed: text.value,
          };
        }),
      ).toEqual({
        keys: ["keydown:KeyW:w:90", "keyup:KeyW:w:90"],
        typed: "z",
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("releases only the Command-held physical key named by macOS", async () => {
    const fixture = await launchPlayableClient("gw-command-key-release-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = document.getElementById("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas is missing");
        const testWindow = window as typeof window & { __releasedKeys?: unknown[] };
        testWindow.__releasedKeys = [];
        canvas.addEventListener("keyup", (event) => {
          testWindow.__releasedKeys?.push({
            key: event.key,
            code: event.code,
            location: event.location,
            charCode: event.charCode,
            keyCode: event.keyCode,
            which: event.which,
            metaKey: event.metaKey,
          });
        });
        canvas.focus();
      });

      const cdp = await fixture.app.context().newCDPSession(page);
      const keyDown = (
        code: string,
        key: string,
        virtualKeyCode: number,
      ) => cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code,
        windowsVirtualKeyCode: virtualKeyCode,
        nativeVirtualKeyCode: virtualKeyCode,
        modifiers: 4,
      });
      await keyDown("KeyW", "w", 87);
      await keyDown("KeyA", "a", 65);
      await page.evaluate(() => window.dispatchEvent(
        new CustomEvent("gw:input-release", { detail: "KeyA" }),
      ));
      expect(await page.evaluate(() => (
        window as typeof window & { __releasedKeys?: unknown[] }
      ).__releasedKeys)).toEqual([{
        key: "a",
        code: "KeyA",
        location: 0,
        charCode: 0,
        keyCode: 65,
        which: 65,
        metaKey: true,
      }]);

      await keyDown("KeyD", "d", 68);
      await page.evaluate(() => window.dispatchEvent(
        new CustomEvent("gw:input-release", { detail: "KeyD" }),
      ));
      await page.evaluate(() => window.dispatchEvent(
        new CustomEvent("gw:input-release", { detail: "KeyA" }),
      ));
      await page.evaluate(() => window.dispatchEvent(
        new CustomEvent("gw:input-release", { detail: "KeyW" }),
      ));
      expect(await page.evaluate(() => (
        window as typeof window & { __releasedKeys?: unknown[] }
      ).__releasedKeys)).toEqual([
        expect.objectContaining({ code: "KeyA" }),
        expect.objectContaining({ code: "KeyD", key: "d", metaKey: true }),
        expect.objectContaining({ code: "KeyW", key: "w", metaKey: true }),
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("does not interrupt a held game key when Command changes", async () => {
    const fixture = await launchPlayableClient("gw-command-transition-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = document.getElementById("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas is missing");
        const testWindow = window as KeyboardInputWindow;
        testWindow.__gameKeys = [];
        for (const type of ["keydown", "keyup"] as const) {
          canvas.addEventListener(type, (event) => {
            testWindow.__gameKeys.push(`${event.type}:${event.code}`);
          });
        }
        canvas.focus();
      });

      const cdp = await fixture.app.context().newCDPSession(page);
      const sendKey = (
        type: "keyDown" | "keyUp",
        code: string,
        key: string,
        virtualKeyCode: number,
        modifiers: number,
      ) => cdp.send("Input.dispatchKeyEvent", {
        type,
        key,
        code,
        windowsVirtualKeyCode: virtualKeyCode,
        nativeVirtualKeyCode: virtualKeyCode,
        modifiers,
      });

      await sendKey("keyDown", "KeyW", "w", 87, 0);
      await sendKey("keyDown", "MetaLeft", "Meta", 91, 4);
      await sendKey("keyUp", "MetaLeft", "Meta", 91, 0);
      expect(await page.evaluate(() => (
        window as KeyboardInputWindow
      ).__gameKeys)).toEqual(["keydown:KeyW"]);

      await sendKey("keyUp", "KeyW", "w", 87, 0);
      expect(await page.evaluate(() => (
        window as KeyboardInputWindow
      ).__gameKeys)).toEqual(["keydown:KeyW", "keyup:KeyW"]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("ends canvas movement when Guild Wars opens a text proxy", async () => {
    const fixture = await launchPlayableClient("gw-chat-movement-release-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = document.getElementById("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas is missing");
        const testWindow = window as KeyboardInputWindow;
        testWindow.__gameKeys = [];
        for (const type of ["keydown", "keyup"] as const) {
          canvas.addEventListener(type, (event) => {
            testWindow.__gameKeys.push(`${event.type}:${event.code}`);
          });
        }
        canvas.focus();
      });

      const cdp = await fixture.app.context().newCDPSession(page);
      const sendKeyDown = (code: string, key: string, virtualKeyCode: number) =>
        cdp.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key,
          code,
          windowsVirtualKeyCode: virtualKeyCode,
          nativeVirtualKeyCode: virtualKeyCode,
        });
      await sendKeyDown("KeyA", "a", 65);
      await sendKeyDown("KeyD", "d", 68);
      await sendKeyDown("KeyX", "x", 88);

      await page.evaluate(() => {
        const text = document.getElementById("osk-input-text");
        if (!(text instanceof HTMLInputElement)) throw new Error("text input is missing");
        const gameModule = window.Module as OskModuleHost | undefined;
        if (!gameModule) throw new Error("window.Module is not installed");
        gameModule.oskActiveInput = text;
        text.focus();
      });

      expect(await page.evaluate(() => (
        window as KeyboardInputWindow
      ).__gameKeys)).toEqual([
        "keydown:KeyA",
        "keydown:KeyD",
        "keydown:KeyX",
        "keyup:KeyA",
        "keyup:KeyD",
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("forgets a surface-claimed key after its Command-held release", async () => {
    const fixture = await launchPlayableClient("gw-command-surface-release-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = document.getElementById("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas is missing");
        const root = document.createElement("div");
        document.body.append(root);
        const surface = window.gwSurfaces.register({
          root,
          priority: 99,
          dismiss() {
            surface.setOpen(false);
            root.remove();
          },
        });
        surface.setOpen(true);
        (window as KeyboardInputWindow).__gameKeys = [];
        for (const type of ["keydown", "keyup"] as const) {
          canvas.addEventListener(type, (event) => {
            if (event.code === "Escape") {
              (window as KeyboardInputWindow).__gameKeys.push(type);
            }
          });
        }
        canvas.focus();
      });

      const cdp = await fixture.app.context().newCDPSession(page);
      const sendEscape = (type: "keyDown" | "keyUp", modifiers: number) =>
        cdp.send("Input.dispatchKeyEvent", {
          type,
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
          nativeVirtualKeyCode: 27,
          modifiers,
        });
      await sendEscape("keyDown", 4);
      await page.evaluate(() => window.dispatchEvent(
        new CustomEvent("gw:input-release", { detail: "Escape" }),
      ));
      await sendEscape("keyDown", 0);
      await sendEscape("keyUp", 0);

      expect(await page.evaluate(() => (
        window as KeyboardInputWindow
      ).__gameKeys)).toEqual(["keydown", "keyup"]);
    } finally {
      await closeOffline(fixture);
    }
  });
});
