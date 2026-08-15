import { expect, test } from "@playwright/test";
import { closeOffline, launchCachedClient } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

type KeyboardInputWindow = typeof window & {
  __gameKeys: string[];
};

/**
 * ArenaNet's generated host object owns the active OSK field. Intersecting its
 * declaration keeps these tests narrower than an untyped Module replacement.
 */
type OskModuleHost = NonNullable<Window["Module"]> & {
  oskActiveInput?: EventTarget | null;
};

test.describe("renderer keyboard input", () => {
  test("keeps game text entry native-assistance free without blurring the game", async () => {
    const fixture = await launchCachedClient("gw-text-input-e2e-");
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
  test("lets the client own Tab focus between login fields", async () => {
    const fixture = await launchCachedClient("gw-tab-focus-e2e-");
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

  test("buffers only the first immediate character-selection Enter", async () => {
    const fixture = await launchCachedClient("gw-character-enter-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = document.getElementById("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas is missing");
        new XMLHttpRequest().open("POST", "/webgate/my_account/token.xml");
        const started = performance.now();
        (window as typeof window & { __characterEnters?: unknown[] }).__characterEnters = [];
        for (const type of ["keydown", "keyup"] as const) {
          canvas.addEventListener(type, (event) => {
            if (event.key !== "Enter") return;
            (window as typeof window & { __characterEnters?: unknown[] })
              .__characterEnters?.push({
                type: event.type,
                trusted: event.isTrusted,
                afterMs: performance.now() - started,
              });
          });
        }
        canvas.focus();
      });

      await page.keyboard.press("Enter");
      await page.waitForTimeout(80);
      expect(await page.evaluate(() =>
        (window as typeof window & { __characterEnters?: unknown[] }).__characterEnters,
      )).toEqual([]);
      await expect.poll(() => page.evaluate(() =>
        (window as typeof window & { __characterEnters?: unknown[] }).__characterEnters,
      )).toHaveLength(2);
      expect(await page.evaluate(() =>
        (window as typeof window & {
          __characterEnters?: Array<{ type: string; trusted: boolean; afterMs: number }>;
        }).__characterEnters,
      )).toEqual([
        { type: "keydown", trusted: false, afterMs: expect.any(Number) },
        { type: "keyup", trusted: false, afterMs: expect.any(Number) },
      ]);
      expect(await page.evaluate(() =>
        (window as typeof window & {
          __characterEnters?: Array<{ afterMs: number }>;
        }).__characterEnters?.[0]?.afterMs,
      )).toBeGreaterThanOrEqual(140);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("uses physical main-block keys without changing typed text", async () => {
    const fixture = await launchCachedClient("gw-physical-key-e2e-");
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
});
