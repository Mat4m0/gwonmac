// The load-bearing network claim, executed rather than read.
//
// AGENTS.md, README.md, PRODUCT.md, docs/user-guide.md and the in-app settings
// note all say the same thing: with `autoCheckUpdates` off — the default — a
// launch reaches github.com zero times. Until this spec existed the only proof
// was five call sites read by hand, and deleting the `if (settings.
// autoCheckUpdates)` gate in `settings.js` left every suite green.
//
// So this counts the real thing: `checkForNewerRelease` calls the main
// process's `fetch`, and the counter below wraps it. The synchronised point is
// `#loading-update-when` — the launcher renders it from `action.restore(...)`
// one line before the gate, so once it is on screen the gate has either fired
// or decided not to.
import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { closeOffline, launchOffline, main } from "./fixtures.mjs";

/** Wraps main's `fetch`, stubs GitHub, and passes everything else through. */
function countGithubRequests() {
  globalThis.__githubRequests = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("https://api.github.com/")) return real(input, init);
    globalThis.__githubRequests += 1;
    // A real answer, so the renderer takes the success path; no packet leaves
    // this machine.
    return Promise.resolve(
      new globalThis.Response(JSON.stringify({ tag_name: "v2026.7.0-alpha.1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

test.describe("release check network policy", () => {
  test.skip(!existsSync(main), "run the build before Electron tests");

  test("zero requests with the default settings, one when the user opted in", async () => {
    const fixture = await launchOffline("gw-release-check-policy-e2e-");
    try {
      const { app, page } = fixture;
      // Let the launcher mount before the counter is installed, so nothing the
      // first boot did can be attributed to the launches under test.
      await expect(page.locator("#loading-update-check")).toBeVisible();
      await app.evaluate(countGithubRequests);

      // A launch with the shipped defaults, plus a timestamp so the launcher
      // has something to render at the moment the gate is reached.
      await page.evaluate(() =>
        window.gwNative.settings.set({
          autoCheckUpdates: false,
          lastUpdateCheckAt: Date.now() - 3_600_000,
        }),
      );
      await page.reload();
      // Both the synchronisation point and the first tripwire: the launcher
      // renders this from the restored timestamp one line before the gate, so
      // once it says an hour the gate has been reached — and it still says an
      // hour, which an unasked-for check would have rewritten to "just now".
      await expect(page.locator("#loading-update-when")).toHaveText(
        "Last checked 1 hour ago",
      );
      expect(await app.evaluate(() => globalThis.__githubRequests)).toBe(0);
      // The answer surface stayed empty: nothing was asked, so nothing is
      // claimed — not even "up to date".
      await expect(page.locator("#loading-update-status")).toBeHidden();

      // The same launch with the box ticked asks exactly once, however many
      // surfaces display the answer.
      await page.evaluate(() =>
        window.gwNative.settings.set({ autoCheckUpdates: true }),
      );
      await page.reload();
      await expect(page.locator("#loading-update-status")).toBeVisible();
      expect(await app.evaluate(() => globalThis.__githubRequests)).toBe(1);

      // Three mount points, one state: pressing the launcher's button while
      // main holds a fresh answer is not a second request either.
      await page.locator("#loading-update-check").click();
      await expect(page.locator("#loading-update-check")).toHaveText(
        "Check for Updates",
      );
      expect(await app.evaluate(() => globalThis.__githubRequests)).toBe(1);
    } finally {
      await closeOffline(fixture);
    }
  });
});
