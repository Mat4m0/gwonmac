import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import { memoryPressurePresentation } from "../../src/renderer/failure-messages.js";

/**
 * The panel is a measuring instrument for a question that gets answered once,
 * so what has to be proved is that it does not disturb what it measures: a
 * simulated notice must render the sentence a player would really read, and it
 * must leave the real escalation exactly where it was. The reload triggers are
 * deliberately not exercised — driving one would end the session under test.
 */
const togglePanel = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    window.dispatchEvent(new globalThis.CustomEvent("gw:dev-panel")),
  );

const readout = (page: import("@playwright/test").Page, role: string) =>
  page.locator(`#dev-panel dd[data-role="${role}"]`);

test.describe("memory debug panel", () => {
  test("stays out of the way until it is asked for", async () => {
    const fixture = await launchOffline("gw-dev-panel-off-");
    try {
      await expect(fixture.page.locator("#dev-panel")).toHaveCount(0);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("previews the real notice without moving the real escalation", async () => {
    const fixture = await launchOffline("gw-dev-panel-preview-");
    try {
      const { page } = fixture;
      await togglePanel(page);
      await expect(page.locator("#dev-panel")).toBeVisible();

      // Nothing has filled the heap, so the watcher is still at rest — which is
      // the state the preview must not disturb.
      await expect(readout(page, "notice")).toHaveText(/real none/);

      await page.locator('#dev-panel button[data-role="critical"]').click();
      const notice = page.locator("#memory-notice");
      await expect(notice).toBeVisible();
      await expect(notice).toHaveClass(/critical/);

      // The copy is the catalogue's, not the panel's: a simulation with its own
      // words would be rehearsing sentences no player ever sees.
      const critical = memoryPressurePresentation("critical");
      await expect(page.locator("#memory-notice-label")).toHaveText(critical.label);
      await expect(page.locator("#memory-notice-detail")).toContainText(
        critical.detail,
      );

      // The point of the whole test: the preview drew the notice and left the
      // watcher alone, so the real warning still arrives at its real threshold.
      await expect(readout(page, "notice")).toHaveText(/real none · showing critical/);

      await page.locator('#dev-panel button[data-role="hide"]').click();
      await expect(notice).toBeHidden();
      await expect(readout(page, "notice")).toHaveText(/real none$/);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("marks a simulated crash so a screenshot of it cannot be misread", async () => {
    const fixture = await launchOffline("gw-dev-panel-crash-");
    try {
      const { page } = fixture;
      await togglePanel(page);
      await page.locator('#dev-panel button[data-role="crash2"]').click();

      // The repeat-crash copy, so the escalation is exercised too.
      await expect(page.locator("#loading-label")).toHaveText(/keeps stopping/);
      await expect(page.locator("#loading-crash-text")).toContainText("SIMULATED");

      // No abort happened, so nothing may have been recorded as one.
      const crashes = await page.evaluate(async () => {
        const summary = await window.gwNative.diagnostics.current();
        return summary.counters["wasm.crashes"] ?? 0;
      });
      expect(crashes).toBe(0);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("lets a click through everywhere except its own controls", async () => {
    const fixture = await launchOffline("gw-dev-panel-pointer-");
    try {
      const { page } = fixture;
      await togglePanel(page);
      const panel = page.locator("#dev-panel");
      await expect(panel).toBeVisible();
      // The panel sits over a live game; only the buttons may take the pointer,
      // or a player judging a notice would be clicking a wall.
      await expect(panel).toHaveCSS("pointer-events", "none");
      await expect(
        page.locator('#dev-panel button[data-role="low"]'),
      ).toHaveCSS("pointer-events", "auto");
    } finally {
      await closeOffline(fixture);
    }
  });
});
