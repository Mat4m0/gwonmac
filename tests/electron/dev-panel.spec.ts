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

  test("keeps the warning's own clicks off the game behind it", async () => {
    const fixture = await launchOffline("gw-notice-events-");
    try {
      const { page } = fixture;
      await togglePanel(page);
      await page.locator('#dev-panel button[data-role="low"]').click();
      await expect(page.locator("#memory-notice")).toBeVisible();

      // The client listens on the window, so without a boundary at the notice
      // root, dismissing the warning also hands the game a click — in the
      // middle of whatever the player was doing when it appeared.
      const reached = await page.evaluate(async () => {
        let seen = 0;
        const count = () => {
          seen += 1;
        };
        for (const name of ["click", "pointerdown", "mousedown", "keydown"]) {
          window.addEventListener(name, count);
        }
        document.getElementById("memory-notice-later")?.click();
        return seen;
      });
      expect(reached).toBe(0);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("holds the keyboard inside the explanation it says is modal", async () => {
    const fixture = await launchOffline("gw-notice-modal-");
    try {
      const { page } = fixture;
      await togglePanel(page);
      // The warning is drawn over a running game, and this fixture never gets
      // one — the launcher is still up, and it is meant to cover the notice.
      // The panel's own Dismiss is how the launcher goes away.
      await page.locator('#dev-panel button[data-role="dismiss"]').click();
      await page.locator('#dev-panel button[data-role="critical"]').click();
      // The notice's copy arrives with a deferred import, so its own controls
      // have no box until it does.
      await expect(page.locator("#memory-notice")).toBeVisible();
      await page.locator("#memory-notice-why").click();

      const why = page.locator("#memory-why");
      await expect(why).toBeVisible();
      await expect(why).toHaveAttribute("aria-modal", "true");
      // aria-modal tells a screen reader the game behind this is not there.
      // The keyboard has to agree, or the two describe different apps.
      const focused = () => page.evaluate(() => document.activeElement?.id ?? "");
      expect(await focused()).toBe("memory-why-close");
      for (const key of ["Tab", "Tab", "Shift+Tab"]) {
        await page.keyboard.press(key);
        expect(await focused()).toBe("memory-why-close");
      }

      // And Escape closes it, which is the only way out that does not need a
      // pointer the game may be holding. The dimming goes with it — a scrim
      // left over a live game is the worst thing this surface could leave
      // behind. (The notice does not return here: this one was the panel's
      // preview, so there is no real escalation to come back to.)
      await page.keyboard.press("Escape");
      await expect(why).toBeHidden();
      await expect(page.locator("#memory-scrim")).toBeHidden();
    } finally {
      await closeOffline(fixture);
    }
  });
});
