import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";

/**
 * What a listener installed by one `page.evaluate` recorded, read back by a
 * later one. The page's own `window` is the only thing that survives between
 * two evaluations, so these names exist at run time and in no declaration —
 * naming their shapes here is what keeps the assertions below typed. Each is
 * assigned by the evaluation that installs the listener, before anything reads
 * it, which is why none is optional.
 */
type InputTestWindow = typeof window & {
  __inputReleases: string[];
  __gameKeys: string[];
  __edgeMoves: Array<[number, number]>;
  __cameraEvents: CameraEvent[];
  __cameraDrains: number;
  __cameraTasks: number[];
  __macInputEvents: string[];
};

/** One mouse event as the client received it, recorded by `watchCameraDrag`. */
interface CameraEvent {
  type: string;
  button: number;
  buttons: number;
  clientX: number;
  movementX: number;
}

/**
 * `window.Module` is ArenaNet's generated host object. `gw-native.d.ts` declares
 * the one member the renderer modules read back from it; `oskActiveInput` is
 * published by the generated glue and owned by `harness.ts`, which is a classic
 * script and so can export no type for it. Intersecting rather than replacing
 * keeps this narrower than `any` and keeps the declared member.
 */
type OskModuleHost = NonNullable<Window["Module"]> & {
  oskActiveInput?: EventTarget | null;
};

/** Playwright reports no box for a node that is not rendered. */
const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("the game canvas has no bounding box");
  return box;
};

async function startGameInput(page: Page) {
  const canvas = page.locator("#canvas");
  const quickStart = page.locator("#data-choice-quick");
  await expect
    .poll(
      async () =>
        (await canvas.getAttribute("data-input-ready")) === "true" ||
        (await quickStart.isVisible()),
    )
    .toBe(true);
  if (await quickStart.isVisible()) await quickStart.click();
  await expect(canvas).toHaveAttribute("data-input-ready", "true");
}

test.describe("renderer input", () => {
  test("keeps game text entry native-assistance free without blurring the game", async () => {
    const fixture = await launchOffline("gw-text-input-e2e-");
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

  test("releases held input and cancels synthetic touches", async () => {
    const fixture = await launchOffline("gw-input-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        const testWindow = window as InputTestWindow;
        testWindow.__inputReleases = [];
        window.addEventListener("keyup", (event) => {
          if (!event.isTrusted) {
            testWindow.__inputReleases.push(
              `key:${event.code}:${event.keyCode}:${event.which}`,
            );
          }
        });
        window.addEventListener("mouseup", (event) => {
          if (!event.isTrusted) {
            testWindow.__inputReleases.push(`mouse:${event.button}`);
          }
        });
        canvas.focus();
      });

      await page.keyboard.down("w");
      const canvasBox = await boxOf(page.locator("#canvas"));
      await page.mouse.move(canvasBox.x + 100, canvasBox.y + 100);
      await page.mouse.down({ button: "left" });
      await page.evaluate(() =>
        window.dispatchEvent(new globalThis.CustomEvent("gw:input-reset")),
      );
      expect(
        await page.evaluate(() => (window as InputTestWindow).__inputReleases),
      ).toEqual(["key:KeyW:87:87", "mouse:0"]);
      await page.keyboard.up("w");
      await page.mouse.up({ button: "left" });

      const touchEvents = await page.evaluate(async () => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("#canvas is missing");
        const events: string[] = [];
        for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
          canvas.addEventListener(type, () => events.push(type));
        }
        const mouse = (type: string, detail = 0) =>
          canvas.dispatchEvent(
            new globalThis.MouseEvent(type, {
              bubbles: true,
              button: 0,
              clientX: 100,
              clientY: 100,
              detail,
            }),
          );
        mouse("mousedown", 1);
        mouse("mouseup", 1);
        mouse("mousedown", 2);
        mouse("mouseup", 2);
        await new Promise((resolve) => setTimeout(resolve, 30));
        window.dispatchEvent(new globalThis.CustomEvent("gw:input-reset"));
        await new Promise((resolve) => setTimeout(resolve, 60));
        return events;
      });
      expect(touchEvents).toEqual([
        "touchstart",
        "touchcancel",
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("passes primary clicks and drags through without touch input", async () => {
    const fixture = await launchOffline("gw-macos-pointer-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        const testWindow = window as InputTestWindow;
        testWindow.__macInputEvents = [];
        for (const type of ["mousedown", "mouseup"] as const) {
          canvas.addEventListener(type, (event) => {
            testWindow.__macInputEvents.push(
              `${type}:${event.button}:${event.buttons}`,
            );
          });
        }
        canvas.addEventListener("mousemove", (event) => {
          if (event.buttons === 1) {
            testWindow.__macInputEvents.push("mousemove:0:1");
          }
        });
        for (const type of ["touchstart", "touchmove", "touchend"] as const) {
          canvas.addEventListener(type, () => {
            testWindow.__macInputEvents.push(type);
          });
        }
      });

      const box = await boxOf(page.locator("#canvas"));
      await page.mouse.click(box.x + 100, box.y + 100);
      await page.mouse.move(box.x + 140, box.y + 140);
      await page.mouse.down({ button: "left" });
      await page.mouse.move(box.x + 180, box.y + 170);
      await page.mouse.up({ button: "left" });

      expect(
        await page.evaluate(() =>
          (window as InputTestWindow).__macInputEvents),
      ).toEqual([
        "mousedown:0:1",
        "mouseup:0:0",
        "mousedown:0:1",
        "mousemove:0:1",
        "mouseup:0:0",
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("uses physical main-block keys without changing typed text", async () => {
    const fixture = await launchOffline("gw-physical-key-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("#canvas is missing");
        const testWindow = window as InputTestWindow;
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
        await page.evaluate(() => (window as InputTestWindow).__gameKeys),
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
        (window as InputTestWindow).__gameKeys = [];
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
            keys: (window as InputTestWindow).__gameKeys,
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

  test("uses the native click count for double-tap compatibility", async () => {
    const fixture = await launchOffline("gw-double-click-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const touchEvents = await page.evaluate(async () => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("#canvas is missing");
        const observed: Array<{ type: string; identifier: number }> = [];
        for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
          canvas.addEventListener(type, (event) => {
            const touch = event.changedTouches[0];
            if (!touch) throw new Error(`${type} carried no changed touch`);
            observed.push({ type, identifier: touch.identifier });
          });
        }
        const mouse = (type: string, detail: number) =>
          canvas.dispatchEvent(
            new globalThis.MouseEvent(type, {
              bubbles: true,
              button: 0,
              clientX: 120,
              clientY: 140,
              detail,
            }),
          );

        // The OS may recognize a deliberately slow pair according to the
        // user's accessibility preference. The host must trust that native
        // count instead of applying its former 400 ms cutoff.
        mouse("mousedown", 1);
        mouse("mouseup", 1);
        await new Promise((resolve) => setTimeout(resolve, 450));
        mouse("mousedown", 2);
        mouse("mouseup", 2);
        const deadline = performance.now() + 2_000;
        while (observed.length < 4 && performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return observed;
      });

      expect(touchEvents.map(({ type }) => type)).toEqual([
        "touchstart",
        "touchend",
        "touchstart",
        "touchend",
      ]);
      expect(new Set(touchEvents.map(({ identifier }) => identifier)).size).toBe(
        2,
      );
    } finally {
      await closeOffline(fixture);
    }
  });

  test("releases held input when the pointer leaves the app window", async () => {
    const fixture = await launchOffline("gw-input-window-leave-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        const testWindow = window as InputTestWindow;
        testWindow.__inputReleases = [];
        window.addEventListener("keyup", (event) => {
          if (!event.isTrusted) {
            testWindow.__inputReleases.push(`key:${event.code}`);
          }
        });
        window.addEventListener("mouseup", (event) => {
          if (!event.isTrusted) {
            testWindow.__inputReleases.push(`mouse:${event.button}`);
          }
        });
        canvas.focus();
      });
      const box = await boxOf(page.locator("#canvas"));
      await page.keyboard.down("w");
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down({ button: "left" });
      await page.evaluate(() => {
        globalThis.document.documentElement.dispatchEvent(
          new globalThis.MouseEvent("mouseleave"),
        );
      });
      expect(
        await page.evaluate(() => (window as InputTestWindow).__inputReleases),
      ).toEqual(["key:KeyW", "mouse:0"]);
      await page.keyboard.up("w");
      await page.mouse.up({ button: "left" });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps the game canvas interactive through every renderer edge", async () => {
    const fixture = await launchOffline("gw-input-viewport-edges-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const result = await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        const testWindow = window as InputTestWindow;
        testWindow.__edgeMoves = [];
        canvas.addEventListener("mousemove", (event) => {
          testWindow.__edgeMoves.push([event.clientX, event.clientY]);
        });
        const viewport: [number, number] = [
          globalThis.innerWidth,
          globalThis.innerHeight,
        ];
        const points: Array<[number, number]> = [
          [0, 0],
          [viewport[0] - 1, 0],
          [0, viewport[1] - 1],
          [viewport[0] - 1, viewport[1] - 1],
        ];
        const corner = globalThis.document.elementFromPoint(
          viewport[0] - 1,
          viewport[1] - 1,
        );
        if (!corner) throw new Error("the viewport corner hit-tests to nothing");
        const canvasSize: [number, number] = [
          canvas.clientWidth,
          canvas.clientHeight,
        ];
        return {
          viewport,
          canvas: canvasSize,
          edgeTargets: points.map(([x, y]) =>
            globalThis.document.elementFromPoint(x, y)?.id ?? null,
          ),
          edgeCursor: globalThis.getComputedStyle(corner).cursor,
        };
      });
      expect(result.canvas).toEqual(result.viewport);
      expect(result.edgeTargets).toEqual([
        "canvas",
        "canvas",
        "canvas",
        "canvas",
      ]);
      // No cursor artwork ships, and this session did not opt in, so the very
      // edge of the canvas is the plain macOS pointer.
      expect(result.edgeCursor).toBe("auto");
      await page.mouse.move(0, 0);
      await page.mouse.move(result.viewport[0] - 1, 0);
      await page.mouse.move(0, result.viewport[1] - 1);
      await page.mouse.move(
        result.viewport[0] - 1,
        result.viewport[1] - 1,
      );
      expect(
        await page.evaluate(() => (window as InputTestWindow).__edgeMoves),
      ).toEqual([
        [0, 0],
        [result.viewport[0] - 1, 0],
        [0, result.viewport[1] - 1],
        [result.viewport[0] - 1, result.viewport[1] - 1],
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("cancels an active synthetic tap before a rapid follow-up click", async () => {
    const fixture = await launchOffline("gw-double-click-cancel-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const result = await page.evaluate(async () => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("#canvas is missing");
        const observed: string[] = [];
        for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
          canvas.addEventListener(type, () => observed.push(type));
        }
        const mouse = (type: string, detail: number) =>
          canvas.dispatchEvent(
            new globalThis.MouseEvent(type, {
              bubbles: true,
              button: 0,
              clientX: 120,
              clientY: 140,
              detail,
            }),
          );

        mouse("mousedown", 2);
        mouse("mouseup", 2);
        await new Promise((resolve) => setTimeout(resolve, 30));
        mouse("mousedown", 3);
        mouse("mouseup", 3);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const interrupted = [...observed];

        observed.length = 0;
        mouse("mousedown", 2);
        canvas.dispatchEvent(
          new globalThis.MouseEvent("mouseleave", {
            bubbles: true,
            button: 0,
            clientX: 400,
            clientY: 400,
          }),
        );
        mouse("mouseup", 2);
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { interrupted, afterLeave: observed };
      });

      expect(result).toEqual({
        interrupted: ["touchstart", "touchcancel"],
        afterLeave: [],
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("accumulates trackpad pixels without changing discrete wheel input", async () => {
    const fixture = await launchOffline("gw-wheel-e2e-");
    try {
      await startGameInput(fixture.page);
      const result = await fixture.page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("#canvas is missing");
        const observed: Array<[number, number]> = [];
        canvas.addEventListener(
          "wheel",
          (event) => {
            if (!event.isTrusted) {
              observed.push([event.deltaMode, event.deltaY]);
            }
          },
        );
        const pixel = (deltaY: number) =>
          canvas.dispatchEvent(
            new globalThis.WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY,
              deltaMode: globalThis.WheelEvent.DOM_DELTA_PIXEL,
            }),
          );
        const line = (deltaY: number) =>
          canvas.dispatchEvent(
            new globalThis.WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY,
              deltaMode: globalThis.WheelEvent.DOM_DELTA_LINE,
            }),
          );

        pixel(60);
        window.dispatchEvent(new globalThis.CustomEvent("gw:input-reset"));
        pixel(60);
        const afterReset = [...observed];

        line(-1);
        pixel(60);
        const afterDiscrete = [...observed];
        pixel(60);
        const complete = [...observed];
        return { afterReset, afterDiscrete, complete };
      });
      expect(result).toEqual({
        afterReset: [],
        afterDiscrete: [[1, -1]],
        complete: [
          [1, -1],
          [0, 100],
        ],
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("allows pointer lock only for the owned game canvas", async () => {
    // Real pointer lock needs a focused widget, so this launch takes focus.
    const fixture = await launchOffline("gw-pointer-permission-e2e-", {
      GW_BACKGROUND_LAUNCH: "0",
    });
    try {
      const { app, page } = fixture;
      await startGameInput(page);
      await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        electronApp.focus({ steal: true });
        BrowserWindow.getAllWindows()[0]?.focus();
      });
      await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        canvas.focus();
      });
      const canvas = page.locator("#canvas");
      const box = await boxOf(canvas);
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down({ button: "right" });
      await expect
        .poll(() =>
          page.evaluate(
            () => globalThis.document.pointerLockElement?.id ?? null,
          ),
        )
        .toBe("canvas");
      await page.mouse.move(box.x + 130, box.y + 120);
      await expect
        .poll(() =>
          page.evaluate(
            () => globalThis.document.pointerLockElement?.id ?? null,
          ),
        )
        .toBe("canvas");
      await page.mouse.up({ button: "right" });
      await expect
        .poll(() =>
          page.evaluate(
            () => globalThis.document.pointerLockElement?.id ?? null,
          ),
        )
        .toBeNull();
    } finally {
      await closeOffline(fixture);
    }
  });

  // A held drag re-anchors only after POINTER_ROAM canvases of travel, so these
  // tests report a deliberately tiny canvas: it brings that budget within a
  // mouse move the fixture window can hold. Four pixels of canvas at 95 from the
  // window's own left edge means 64 pixels of roam either side of it.
  const CAMERA_CANVAS = 4;
  const CAMERA_ROAM = CAMERA_CANVAS * 16;

  // The press sits two pixels below the reported top so the drag starts inside
  // the budget on both axes; every move in these tests is horizontal.
  const CAMERA_Y = 2;

  /** Watches what the client receives, from a right-drag pressed at box.x+100. */
  const watchCameraDrag = async (page: Page, box: { x: number; y: number }) => {
    await page.evaluate(({ x, y, size }) => {
      const gameCanvas = globalThis.document.getElementById("canvas");
      const loading = globalThis.document.getElementById("loading");
      if (!gameCanvas || !loading) {
        throw new Error("the renderer shell is missing");
      }
      loading.classList.add("gone");
      const testWindow = window as InputTestWindow;
      testWindow.__cameraEvents = [];
      // Microtasks queued by a listener drain only once the task dispatching it
      // ends, so a shared count is an exact witness that these events were
      // delivered without yielding to the event loop between them.
      testWindow.__cameraDrains = 0;
      testWindow.__cameraTasks = [];
      for (const type of ["mousemove", "mouseup", "mousedown"] as const) {
        gameCanvas.addEventListener(type, (event) => {
          if (!event.isTrusted) {
            testWindow.__cameraTasks.push(testWindow.__cameraDrains);
            globalThis.queueMicrotask(() => {
              testWindow.__cameraDrains += 1;
            });
            testWindow.__cameraEvents.push({
              type,
              button: event.button,
              buttons: event.buttons,
              clientX: event.clientX,
              movementX: event.movementX,
            });
          }
        });
      }
      gameCanvas.getBoundingClientRect = () =>
        new globalThis.DOMRect(x + 95, y, size, size);
      Object.defineProperty(globalThis.document, "pointerLockElement", {
        configurable: true,
        value: gameCanvas,
      });
      globalThis.document.exitPointerLock = () => {
        Object.defineProperty(globalThis.document, "pointerLockElement", {
          configurable: true,
          value: null,
        });
      };
      gameCanvas.focus();
    }, { x: box.x, y: box.y, size: CAMERA_CANVAS });

    await page.mouse.move(box.x + 100, box.y + CAMERA_Y);
    await page.mouse.down({ button: "right" });
  };

  test("carries a held camera drag past the edge of the canvas", async () => {
    const fixture = await launchOffline("gw-pointer-edge-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const canvas = page.locator("#canvas");
      const box = await boxOf(canvas);
      await watchCameraDrag(page, box);

      // Both moves leave the cursor well outside a four-pixel canvas. The client
      // keeps integrating them there, so stopping at the edge to re-anchor buys
      // nothing and costs a released button — which a small window pays on about
      // every third move, and is why it rotated worse than a large one.
      await page.mouse.move(box.x + 80, box.y + CAMERA_Y);
      await page.mouse.move(box.x + 60, box.y + CAMERA_Y);
      await expect
        .poll(() =>
          page.evaluate(() => (window as InputTestWindow).__cameraEvents),
        )
        .toEqual([
          {
            type: "mousemove",
            button: 0,
            buttons: 2,
            clientX: box.x + 95 - 15,
            movementX: -20,
          },
          {
            type: "mousemove",
            button: 0,
            buttons: 2,
            clientX: box.x + 95 - 35,
            movementX: -20,
          },
        ]);
      await page.mouse.up({ button: "right" });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("recycles a held camera drag once it roams past its budget", async () => {
    const fixture = await launchOffline("gw-pointer-roam-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const canvas = page.locator("#canvas");
      const box = await boxOf(canvas);
      await watchCameraDrag(page, box);

      // Eighty left of a press five into the canvas overruns the budget by 11.
      await page.mouse.move(box.x + 20, box.y + CAMERA_Y);
      await expect
        .poll(() =>
          page.evaluate(() => (window as InputTestWindow).__cameraEvents),
        )
        .toEqual([
          {
            type: "mousemove",
            button: 0,
            buttons: 2,
            clientX: box.x + 95 - CAMERA_ROAM,
            movementX: -(CAMERA_ROAM + 5),
          },
          {
            type: "mouseup",
            button: 2,
            buttons: 0,
            clientX: box.x + 95 - CAMERA_ROAM,
            movementX: 0,
          },
          {
            type: "mousedown",
            button: 2,
            buttons: 2,
            clientX: box.x + 95 + CAMERA_CANVAS / 2,
            movementX: 0,
          },
          {
            type: "mousemove",
            button: 0,
            buttons: 2,
            clientX: box.x + 95 + CAMERA_CANVAS / 2 - 11,
            movementX: -11,
          },
        ]);
      // The recycled drag has to reach the client in the task that produced it.
      // Replaying the leftover delta from a later animation frame satisfies
      // every assertion above and still freezes the camera for that frame.
      await expect
        .poll(() =>
          page.evaluate(() => (window as InputTestWindow).__cameraTasks),
        )
        .toEqual([0, 0, 0, 0]);
      await page.mouse.up({ button: "right" });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("releases only held mouse buttons when pointer lock is lost", async () => {
    const fixture = await launchOffline("gw-pointer-loss-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        const testWindow = window as InputTestWindow;
        testWindow.__inputReleases = [];
        window.addEventListener("keyup", (event) => {
          if (!event.isTrusted) {
            testWindow.__inputReleases.push(
              `key:${event.code}:${event.keyCode}:${event.which}`,
            );
          }
        });
        window.addEventListener("mouseup", (event) => {
          if (!event.isTrusted) {
            testWindow.__inputReleases.push(`mouse:${event.button}`);
          }
        });
        Object.defineProperty(globalThis.document, "pointerLockElement", {
          configurable: true,
          value: canvas,
        });
        canvas.requestPointerLock = () => Promise.resolve();
        canvas.focus();
      });
      const box = await boxOf(page.locator("#canvas"));
      await page.keyboard.down("w");
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down({ button: "right" });
      await page.evaluate(() => {
        Object.defineProperty(globalThis.document, "pointerLockElement", {
          configurable: true,
          value: null,
        });
        globalThis.document.dispatchEvent(
          new globalThis.Event("pointerlockchange"),
        );
      });
      expect(
        await page.evaluate(() => (window as InputTestWindow).__inputReleases),
      ).toEqual(["mouse:2"]);
      await page.keyboard.up("w");
      await page.mouse.up({ button: "right" });
    } finally {
      await closeOffline(fixture);
    }
  });
});
