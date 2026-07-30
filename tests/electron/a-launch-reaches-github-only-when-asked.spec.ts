// The load-bearing network claim, executed rather than read.
//
// AGENTS.md, README.md, PRODUCT.md, docs/user-guide.md and the in-app settings
// note all say the same thing: with `autoCheckUpdates` off — the default — a
// launch reaches github.com zero times. Until this spec existed the only proof
// was five call sites read by hand, and deleting the `if (settings.
// autoCheckUpdates)` gate in `settings.ts` left every suite green.
//
// So this counts the real thing: AppUpdater calls the main process's `fetch`,
// and the counter below wraps it.
import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { closeOffline, launchOffline, main } from "./fixtures.mjs";

declare global {
  // The counter the stub below keeps in the main process, read back through
  // `app.evaluate`. It exists only while this spec runs.
  var __githubRequests: number;
}

/** Wraps main's `fetch`, stubs GitHub, and passes everything else through. */
function countGithubRequests() {
  globalThis.__githubRequests = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    // `fetch` accepts a string, a `URL`, or a `Request`; only the last carries
    // the address on `.url`. Reading `.url` off the other two yielded
    // `undefined` and threw on the next line.
    const url =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
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
    const fixture = await launchOffline("gw-release-check-policy-e2e-", {
      GW_TEST_OFFICIAL_UPDATER: "1",
    });
    try {
      const { app, page } = fixture;
      // Let the launcher mount before the counter is installed, so nothing the
      // first boot did can be attributed to the launches under test.
      await expect(page.locator("#loading-update-check")).toBeVisible();
      await app.evaluate(countGithubRequests);

      // The shipped preference is off, and mounting every renderer surface
      // must not turn that into a release request.
      await expect
        .poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ autoCheckUpdates: false });
      expect(await app.evaluate(() => globalThis.__githubRequests)).toBe(0);
      // The answer surface stayed empty: nothing was asked, so nothing is
      // claimed — not even "up to date".
      await expect(page.locator("#loading-update-status")).toBeHidden();

      // Enabling the preference is explicit intent and triggers exactly one
      // immediate check, however many surfaces display the answer.
      await page.evaluate(() =>
        window.gwNative.settings.set({ autoCheckUpdates: true }),
      );
      await expect(page.locator("#loading-update-status")).toBeVisible();
      expect(await app.evaluate(() => globalThis.__githubRequests)).toBe(1);

      // Three mount points, one state. A manual press is fresh user intent, so
      // it performs one new check rather than being suppressed by the launch
      // check.
      await page.locator("#loading-update-check").click();
      await expect(page.locator("#loading-update-check")).toHaveText(
        "Check for Updates",
      );
      expect(await app.evaluate(() => globalThis.__githubRequests)).toBe(2);
    } finally {
      await closeOffline(fixture);
    }
  });
});
