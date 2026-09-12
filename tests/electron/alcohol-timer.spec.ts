/** Exercises the production timer surface and settings through offline Electron. */
import { expect, test, type Page } from "@playwright/test";
import { closeOffline, launchOffline, launchPlayableClient } from "./fixtures.mjs";

type OverlayModule = typeof import("../../src/renderer/alcohol-timer-overlay.js");
type Timer = ReturnType<OverlayModule["createAlcoholTimerOverlay"]>;
declare global { interface Window { alcoholFixture: Timer } }
async function showTimer(page: Page) {
  await page.evaluate(async () => {
    document.getElementById("loading")?.classList.add("gone");
    const url: string = "gw://app/alcohol-timer-overlay.js";
    const { createAlcoholTimerOverlay } = await import(url) as OverlayModule;
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    window.alcoholFixture = createAlcoholTimerOverlay(document.body, canvas, async value => {
      await new Promise(resolve => setTimeout(resolve, 80));
      await window.gwNative.settings.set({ alcoholTimerPosition: value });
      window.alcoholFixture.setSettings(value, true);
    });
    window.alcoholFixture.setGeometry({ status: "ready", sequence: 2, generation: 1, frameId: 1,
      viewportWidth: 1000, viewportHeight: 800, anchor: { left: 100, right: 700, bottom: 300, top: 750 },
      icons: [{ skillId: 1, left: 100, right: 150, bottom: 700, top: 750 }] });
    window.alcoholFixture.setSettings((await window.gwNative.settings.get()).alcoholTimerPosition, true);
    window.alcoholFixture.setAlcohol({ status: "ready", sequence: 2, gameTimer: 0, remainingMs: 123000 });
    canvas.focus();
  });
}
test("timer dragging, cancellation, stable corner, locking and reload", async () => {
  const fixture = await launchPlayableClient("gw-alcohol-position-");
  try {
    const { page } = fixture;
    await showTimer(page);
    const root = page.locator("#alcohol-timer-overlay");
    const handle = root.getByRole("button", { name: /^Move alcohol/ });
    const initial = (await root.boundingBox())!;
    await expect(root).toContainText("2:03");
    const canvasBounds = (await page.locator("#canvas").boundingBox())!;
    expect(initial.x).toBeCloseTo(canvasBounds.x + 4, 0);
    expect(initial.y).toBeCloseTo(canvasBounds.y + 58, 0);
    expect(await root.evaluate(el => {
      const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + 10, r.y + 10));
    })).toBe(false);
    await page.evaluate(() => window.alcoholFixture.setSettings({ corner: "top-left", x: 4, y: 58, locked: false }, true));
    await handle.focus();
    await handle.press("ArrowRight"); await handle.press("ArrowRight"); await handle.press("Shift+ArrowDown");
    await expect.poll(() => page.evaluate(async () => (await window.gwNative.settings.get()).alcoholTimerPosition)).toMatchObject({ locked: false });
    await page.waitForTimeout(400);
    const keyboard = (await root.boundingBox())!;
    expect(keyboard.x).toBeCloseTo(initial.x + 2, 0); expect(keyboard.y).toBeCloseTo(initial.y + 10, 0);
    const h = (await handle.boundingBox())!;
    await page.screenshot({ path: test.info().outputPath("alcohol-unlocked.png") });
    expect(await handle.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + 8, r.y + 8)); })).toBe(true);
    await page.mouse.move(h.x + 8, h.y + 8); await page.mouse.down(); await page.mouse.move(h.x + 68, h.y + 38);
    await page.keyboard.press("Escape"); await page.mouse.up();
    expect((await root.boundingBox())!.x).toBeCloseTo(keyboard.x, 0);
    await page.mouse.move(h.x + 8, h.y + 8); await page.mouse.down(); await page.mouse.move(h.x + 68, h.y + 38); await page.mouse.up();
    const dragged = (await root.boundingBox())!; expect(dragged.x).toBeCloseTo(keyboard.x + 60, 0);
    await page.waitForTimeout(150);
    await page.evaluate(() => window.alcoholFixture.setGeometry({ status: "ready", sequence: 4, generation: 1, frameId: 1,
      viewportWidth: 1000, viewportHeight: 800, anchor: { left: 200, right: 800, bottom: 300, top: 750 },
      icons: [{ skillId: 1, left: 200, right: 250, bottom: 700, top: 750 }] }));
    expect(await root.boundingBox()).toEqual(dragged);
    await page.evaluate(() => window.alcoholFixture.setGeometry({ status: "ready", sequence: 6, generation: 1, frameId: 1,
      viewportWidth: 1000, viewportHeight: 800, anchor: { left: 200, right: 800, bottom: 300, top: 750 }, icons: [] }));
    expect(await root.boundingBox()).toEqual(dragged);
    await page.evaluate(() => window.alcoholFixture.setGeometry({ status: "waiting", reason: "memory" }));
    expect(await root.boundingBox()).toEqual(dragged);
    await root.getByRole("button", { name: "Lock alcohol timer position" }).click();
    await expect.poll(() => page.evaluate(async () => (await window.gwNative.settings.get()).alcoholTimerPosition.locked)).toBe(true);
    await expect(handle).toBeDisabled();
    expect(await root.boundingBox()).toEqual(dragged);
    expect(await root.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + 10, r.y + 10)); })).toBe(false);
    await page.screenshot({ path: test.info().outputPath("alcohol-locked.png") });
    await page.reload(); await showTimer(page); await expect(handle).toBeDisabled();
    expect((await root.boundingBox())!.x).toBeCloseTo(dragged.x, 0);
    await page.evaluate(() => window.alcoholFixture.setAlcohol({ status: "ready", sequence: 6, gameTimer: 0, remainingMs: 0 }));
    await expect(root).toBeHidden();
    await page.evaluate(async () => window.alcoholFixture.setSettings({ ...(await window.gwNative.settings.get()).alcoholTimerPosition, locked: false }, true));
    await expect(root).toContainText("—:—");
    await page.setViewportSize({ width: 320, height: 300 });
    const small = (await root.boundingBox())!; expect(small.x).toBeGreaterThanOrEqual(0); expect(small.x + small.width).toBeLessThanOrEqual(320);
    await page.screenshot({ path: test.info().outputPath("alcohol-adjust-small.png") });
  } finally { await closeOffline(fixture); }
});

test("timer picks the bottom-right corner and preserves gaps through resize and lock", async () => {
  const fixture = await launchPlayableClient("gw-alcohol-corner-");
  try {
    const { page } = fixture;
    await showTimer(page);
    await page.evaluate(() => window.alcoholFixture.setSettings({ corner: "top-left", x: 4, y: 58, locked: false }, true));
    const root = page.locator("#alcohol-timer-overlay");
    const handle = root.getByRole("button", { name: /^Move alcohol/ });
    const bounds = (await page.locator("#canvas").boundingBox())!;
    const initial = (await root.boundingBox())!;
    const left = bounds.x + bounds.width - initial.width - 8;
    const top = bounds.y + bounds.height - initial.height - 12;
    await page.mouse.move(initial.x + 8, initial.y + 8); await page.mouse.down();
    await page.mouse.move(left + 8, top + 8); await page.mouse.up();
    await expect.poll(() => page.evaluate(async () => (await window.gwNative.settings.get()).alcoholTimerPosition))
      .toEqual({ corner: "bottom-right", x: 8, y: 12, locked: false });
    const placed = (await root.boundingBox())!;
    const lock = root.getByRole("button", { name: "Lock alcohol timer position" });
    expect((await lock.boundingBox())!.x).toBeLessThan(placed.x);
    await lock.click();
    await expect(handle).toBeDisabled();
    expect(await root.boundingBox()).toEqual(placed);
    await page.setViewportSize({ width: 640, height: 480 });
    await expect.poll(async () => { const box = (await root.boundingBox())!; return box.x + box.width; }).toBeCloseTo(640 - 8, 0);
    const smaller = (await root.boundingBox())!;
    expect(smaller.x + smaller.width).toBeCloseTo(640 - 8, 0);
    expect(smaller.y + smaller.height).toBeCloseTo(480 - 12, 0);
    await page.screenshot({ path: test.info().outputPath("alcohol-bottom-right.png") });
    await expect.poll(() => page.evaluate(async () => (await window.gwNative.settings.get()).alcoholTimerPosition.locked)).toBe(true);
    await page.reload(); await showTimer(page);
    expect(await root.boundingBox()).toEqual(smaller);
    await page.evaluate(async () => {
      window.alcoholFixture.setSettings({ ...(await window.gwNative.settings.get()).alcoholTimerPosition, locked: false }, true);
      window.alcoholFixture.setAlcohol({ status: "ready", sequence: 4, gameTimer: 0, remainingMs: 0 });
    });
    expect(await root.boundingBox()).toEqual(smaller);
  } finally { await closeOffline(fixture); }
});

test("legacy Effects offsets migrate once without following later effect rows", async () => {
  const fixture = await launchPlayableClient("gw-alcohol-migration-");
  try {
    const { page } = fixture;
    await page.evaluate(() => window.gwNative.settings.set({ alcoholTimerPosition: { x: 20, y: 10, locked: true } }));
    await showTimer(page);
    const root = page.locator("#alcohol-timer-overlay");
    const bounds = (await page.locator("#canvas").boundingBox())!;
    const migrated = (await root.boundingBox())!;
    expect(migrated.x).toBeCloseTo(bounds.x + bounds.width * 120 / 1000, 0);
    expect(migrated.y).toBeCloseTo(bounds.y + bounds.height * 110 / 800, 0);
    await expect.poll(() => page.evaluate(async () => (await window.gwNative.settings.get()).alcoholTimerPosition))
      .toMatchObject({ corner: "top-left", locked: true });
    await page.evaluate(() => window.alcoholFixture.setGeometry({ status: "ready", sequence: 4, generation: 1, frameId: 1,
      viewportWidth: 1000, viewportHeight: 800, anchor: { left: 100, right: 700, bottom: 300, top: 750 }, icons: [] }));
    expect(await root.boundingBox()).toEqual(migrated);
    await page.reload(); await showTimer(page);
    expect(await root.boundingBox()).toEqual(migrated);
  } finally { await closeOffline(fixture); }
});

test("launcher enables the timer and exposes adjust and reset", async () => {
  const fixture = await launchOffline("gw-alcohol-settings-", { GW_TEST_RETURN_LAUNCHER: "1" });
  try {
    const { page } = fixture;
    await page.evaluate(async () => { await window.launcherNative.experience.completeSetup({ enableTools: false }); });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.evaluate(() => window.launcherNative.tools.setMasterEnabled(true));
    const checkbox = page.getByRole("checkbox", { name: "Alcohol Timer", exact: true });
    await expect(checkbox).not.toBeChecked(); await checkbox.check();
    await page.getByRole("button", { name: "Adjust position", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.launcherNative.state.get())).settings.alcoholTimerPosition.locked).toBe(false);
    await page.screenshot({ path: test.info().outputPath("alcohol-settings.png") });
    await page.getByRole("button", { name: "Reset position", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.launcherNative.state.get())).settings.alcoholTimerPosition).toEqual({ corner: "top-left", x: 4, y: 58, locked: true });
  } finally { await closeOffline(fixture); }
});
