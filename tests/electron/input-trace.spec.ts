import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";
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
  page.evaluate(() =>
    window.dispatchEvent(new globalThis.CustomEvent("gw:input-trace")),
  );

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
    const fixture = await launchOffline("gw-input-trace-on-");
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
    const fixture = await launchOffline("gw-input-trace-lock-");
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

});
