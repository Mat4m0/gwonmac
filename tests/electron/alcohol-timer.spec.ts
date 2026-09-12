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
test("timer dragging, cancellation, relative anchor, locking and reload", async () => {
  const fixture = await launchPlayableClient("gw-alcohol-position-");
  try {
    const { page } = fixture;
    await showTimer(page);
    const root = page.locator("#alcohol-timer-overlay");
    const handle = root.getByRole("button", { name: /^Move alcohol/ });
    const initial = (await root.boundingBox())!;
    await expect(root).toContainText("2:03");
    const canvasBounds = (await page.locator("#canvas").boundingBox())!;
    expect(initial.y).toBeCloseTo(canvasBounds.y + canvasBounds.height * 110 / 800, 0);
    expect(await root.evaluate(el => {
      const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + 10, r.y + 10));
    })).toBe(false);
    await page.evaluate(() => window.alcoholFixture.setSettings({ x: 0, y: 10, locked: false }, true));
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
    expect((await root.boundingBox())!.x).toBeGreaterThan(dragged.x + 50);
    await root.getByRole("button", { name: "Lock alcohol timer position" }).click();
    await expect.poll(() => page.evaluate(async () => (await window.gwNative.settings.get()).alcoholTimerPosition.locked)).toBe(true);
    await expect(handle).toBeDisabled();
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
    await expect.poll(async () => (await page.evaluate(() => window.launcherNative.state.get())).settings.alcoholTimerPosition).toEqual({ x: 0, y: 10, locked: true });
  } finally { await closeOffline(fixture); }
});
