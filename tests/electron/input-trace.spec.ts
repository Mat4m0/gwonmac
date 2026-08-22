import { expect, test } from "@playwright/test";
import {
  CLIPBOARD_TEXT_CEILING,
  IPC,
} from '../../src/shared/contracts.js';
import { closeOffline, launchCachedClient } from "./fixtures.mjs";
import { boxOf, startGameInput } from "./input-helpers.js";

/**
 * The trace is the instrument a bug report is built from, so what it must be
 * proved to do is: cost nothing until it is switched on, name the decision
 * that produced a double-tap pair, and carry no coordinate out of the
 * renderer.
 */
/**
 * The panel coalesces a burst of records into one repaint, so every read polls
 * rather than assuming the last event has already been laid out.
 */
const traceText = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    [...globalThis.document.querySelectorAll("#input-trace li")]
      .map((li) => li.textContent ?? "")
      .join("\n"),
  );

const expectTrace = (page: import("@playwright/test").Page) =>
  expect.poll(() => traceText(page));

const toggleTrace = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const enabled = globalThis.document.getElementById('input-trace')?.hidden ?? true;
    window.dispatchEvent(new globalThis.CustomEvent("gw:input-trace", {
      detail: enabled,
    }));
  });

/**
 * Announces a lock state the way the browser does: set the element, then
 * deliver the change event that reports it. Stubbed rather than driven for
 * real, because the case worth pinning is the one where the two disagree.
 */
const announceLock = (page: import("@playwright/test").Page, locked: boolean) =>
  page.evaluate((want) => {
    Object.defineProperty(globalThis.document, "pointerLockElement", {
      configurable: true,
      value: want ? globalThis.document.getElementById("canvas") : null,
    });
    globalThis.document.dispatchEvent(new globalThis.Event("pointerlockchange"));
  }, locked);

test.describe("input trace", () => {
  test("stays dormant, names double-click decisions, and copies no coordinates", async () => {
    const fixture = await launchCachedClient("gw-input-trace-on-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const box = await boxOf(page.locator("#canvas"));
      await page.mouse.move(box.x + 80, box.y + 80);
      await page.mouse.down();
      await page.mouse.up();
      await expect(page.locator("#input-trace")).toBeHidden();
      expect(await traceText(page)).toBe("");

      await page.evaluate(() => {
        globalThis.document.getElementById("loading")?.classList.add("gone");
      });
      await toggleTrace(page);
      await expect(page.locator("#input-trace")).toBeVisible();

      const panel = page.locator('#input-trace');
      const header = panel.locator('header');
      const beforeMove = await panel.boundingBox();
      const headerBox = await header.boundingBox();
      if (!beforeMove || !headerBox) throw new Error('input trace panel missing');
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      await page.mouse.move(headerBox.x + 8, headerBox.y + headerBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(viewport.width - 20, 20);
      await page.mouse.up();
      const afterMove = await panel.boundingBox();
      if (!afterMove) throw new Error('input trace panel missing after drag');
      expect(afterMove.y).toBeLessThan(beforeMove.y);
      expect(afterMove.y).toBeGreaterThanOrEqual(11);
      expect(afterMove.y).toBeLessThanOrEqual(viewport.height - afterMove.height - 11);
      expect(afterMove.x).toBeLessThanOrEqual(viewport.width - afterMove.width - 11);

      const beforeButton = await panel.boundingBox();
      await panel.locator('[data-role="clear"]').click();
      expect(await panel.boundingBox()).toEqual(beforeButton);

      await page.mouse.move(box.x + 120, box.y + 120);
      await page.mouse.dblclick(box.x + 120, box.y + 120);

      // The offline fixture serves no certified client, so the row states that
      // the flag had nowhere to go. Either way the row is on the press itself,
      // which is the property being pinned: nothing is deferred any more.
      await expectTrace(page).toContain("DOUBLE-CLICK");
      // The flag row belongs under the press it rode on, not above it. Both
      // listeners are window-capture, so registration order decides this and
      // nothing else would catch it flipping back.
      const rows = (await traceText(page)).split("\n");
      const flagged = rows.findIndex((row) => row.includes("DOUBLE-CLICK"));
      expect(rows[flagged - 1]).toContain("run=2");
      const afterDouble = await traceText(page);
      expect(afterDouble).toContain("run=2");
      expect(afterDouble).toContain("press left canvas");

      // A privacy-safe owner category is enough to diagnose an invisible
      // overlay without copying selectors, labels, or coordinates.
      await page.evaluate(() => {
        const surface = document.createElement("button");
        surface.type = "button";
        surface.dataset.gwonmacSurface = "";
        surface.dataset.testid = "trace-surface";
        surface.style.cssText = "position:fixed;left:20px;top:20px;width:40px;height:40px";
        document.body.append(surface);
      });
      await page.locator('[data-testid="trace-surface"]').click();
      await expectTrace(page).toContain("press left surface");

      // The flag rides on the press itself, so a three-click run flags the
      // second press and the fourth, exactly as Windows raises its own
      // double-click message on every even click. Nothing is held back and
      // nothing is retracted, which is the whole point of the native path.
      await page.evaluate(() => {
        globalThis.document
          .querySelector<HTMLButtonElement>('#input-trace [data-role="clear"]')
          ?.click();
      });
      for (const clickCount of [1, 2, 3] as const) {
        await page.mouse.down({ clickCount });
        await page.mouse.up({ clickCount });
      }
      await expectTrace(page).toContain("run=3");
      const burst = await traceText(page);
      expect(burst.match(/DOUBLE-CLICK/gu)?.length ?? 0).toBe(1);

      await page.evaluate(() => {
        globalThis.document
          .querySelector<HTMLButtonElement>('#input-trace [data-role="clear"]')
          ?.click();
      });
      await page.mouse.move(box.x + 40, box.y + 40);
      await page.mouse.down();
      await page.mouse.move(box.x + 640, box.y + 440);
      await page.mouse.up();

      await expectTrace(page).toContain("release");
      const rowsAfterDrag = await traceText(page);
      for (const coordinate of [40, 640, 440, box.x, box.y]) {
        expect(rowsAfterDrag).not.toContain(`=${Math.round(coordinate)},`);
      }
      expect(rowsAfterDrag).not.toMatch(/x=|y=|client|screen/i);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("reports each pointer lock once, however it was announced", async () => {
    const fixture = await launchCachedClient("gw-input-trace-lock-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await toggleTrace(page);

      await announceLock(page, true);
      await announceLock(page, false);
      // A right-click shorter than the lock's round trip announces itself as
      // unlocked twice over, once for a lock that was already exited by the
      // time the news arrived and once for the exit. Neither is a state the
      // player held, and a trace that prints both reads as a lock that was
      // released without ever engaging.
      await announceLock(page, false);
      await announceLock(page, false);

      await expectTrace(page).toContain("pointer lock released");
      const rows = await traceText(page);
      expect(rows.match(/pointer lock engaged/gu)?.length ?? 0).toBe(1);
      expect(rows.match(/pointer lock released/gu)?.length ?? 0).toBe(1);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("joins redacted main and text events, pauses, bounds, copies, and clears", async () => {
    test.setTimeout(60_000);
    const fixture = await launchCachedClient("gw-input-trace-timeline-");
    try {
      const { app, page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        globalThis.document.getElementById('loading')?.classList.add('gone');
      });
      await toggleTrace(page);

      const mainEntry = {
        source: 'main', kind: 'native-key', phase: 'down',
        key: 'printable', repeat: true, decision: 'forwarded',
      } as const;
      await app.evaluate(({ BrowserWindow }, value) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send(value.channel, value.entry);
      }, { channel: IPC.inputTraceEvent, entry: mainEntry });

      const secret = 'must-not-appear-in-input-trace';
      await page.locator('#osk-input-password').evaluate((field, value) => {
        const input = field as HTMLInputElement;
        input.focus();
        input.value = value;
        input.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true, inputType: 'insertText', data: value,
        }));
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true, inputType: 'insertText', data: value,
        }));
      }, secret);
      await expectTrace(page).toContain('main     key down printable repeat');
      await expectTrace(page).toContain('text secret input');

      const count = page.locator('#input-trace [data-role="count"]');
      // Pause without generating another traced hardware gesture. A real
      // pointer click is reported by Main over IPC, so its in-flight entries
      // can repaint the count after the pause handler has already run and
      // make this assertion depend on delivery timing instead of pause
      // behavior.
      await page.locator('#input-trace [data-role="pause"]').evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
      await page.evaluate(() => new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const beforePause = await count.textContent();
      await page.mouse.click(100, 100);
      expect(await count.textContent()).toBe(beforePause);
      await page.locator('#input-trace [data-role="pause"]').evaluate((button) => {
        (button as HTMLButtonElement).click();
      });

      await page.evaluate(() => {
        const field = document.getElementById('osk-input-password');
        if (!(field instanceof HTMLInputElement)) throw new Error('password proxy missing');
        for (let index = 0; index < 1_010; index += 1) {
          field.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            inputType: 'insertCompositionText',
          }));
        }
      });
      await expect(count).toHaveText('1000/1000');

      await page.locator('#input-trace [data-role="copy"]').click();
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
        .toContain('gwonmac input harness — 1000 events');
      const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
      expect(copied.length).toBeLessThanOrEqual(CLIPBOARD_TEXT_CEILING);
      expect(copied).toContain('older events omitted');
      expect(copied).not.toContain(secret);
      expect(copied).not.toMatch(/password|email|coordinate=/iu);

      await toggleTrace(page);
      await expect(page.locator('#input-trace')).toBeHidden();
      await expectTrace(page).toBe('');
    } finally {
      await closeOffline(fixture);
    }
  });

  test("records thresholded gamepad transitions without a device identity", async () => {
    const fixture = await launchCachedClient("gw-input-trace-gamepad-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const state = globalThis as typeof globalThis & { testPads?: Gamepad[] };
        state.testPads = [{
          index: 0,
          id: 'private-controller-name',
          connected: true,
          mapping: 'standard',
          timestamp: 1,
          vibrationActuator: null,
          buttons: [{ pressed: false, touched: false, value: 0 }],
          axes: [0],
        } as unknown as Gamepad];
        Object.defineProperty(globalThis.navigator, 'getGamepads', {
          configurable: true,
          value: () => state.testPads ?? [],
        });
      });
      await toggleTrace(page);
      await expectTrace(page).toContain('gamepad connected');

      await page.evaluate(() => {
        const state = globalThis as typeof globalThis & { testPads?: Gamepad[] };
        const gamepad = state.testPads?.[0];
        if (!gamepad) return;
        state.testPads = [{
          ...gamepad,
          timestamp: 2,
          buttons: [{ pressed: true, touched: true, value: 1 }],
          axes: [0.8],
        } as Gamepad];
      });
      await expectTrace(page).toContain('gamepad button-down control=0');
      await expectTrace(page).toContain('gamepad axis control=0 direction=1');

      await page.evaluate(() => {
        const state = globalThis as typeof globalThis & { testPads?: Gamepad[] };
        state.testPads = [];
      });
      await expectTrace(page).toContain('gamepad disconnected');
      expect(await traceText(page)).not.toContain('private-controller-name');
    } finally {
      await closeOffline(fixture);
    }
  });

});
