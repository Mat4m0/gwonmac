// The load-bearing network claim, executed rather than read.
//
// AGENTS.md, README.md, PRODUCT.md, docs/user-guide.md and the in-app settings
// note all say the same thing: `autoCheckUpdates` is on by default and performs
// one check per launch, and with it off a launch reaches github.com zero
// times. Until this spec existed the only proof was call sites read by hand,
// and deleting the `if (settings.autoCheckUpdates)` gate in `main.ts` left
// every suite green.
//
// The two halves are two launches because they must be. The default-launch
// check fires at startup, before any test hook can wrap the main process's
// `fetch`, so the first test proves it ran by its observable state in a build
// that is not update-capable — where `runCheck` finishes without any network
// path at all. The second test seeds an opted-out profile, wraps `fetch`, and
// counts the real thing.
import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
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

  test("a default launch has the check on and attempts it once", async () => {
    // No GW_TEST_OFFICIAL_UPDATER: this build is not update-capable, so the
    // launch check finishes as `updater-unavailable` with no network path at
    // all — which is exactly what lets a default profile launch under test.
    const fixture = await launchOffline("gw-release-check-default-e2e-");
    try {
      const { page } = fixture;
      // The shipped default is on.
      await expect
        .poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ autoCheckUpdates: true });
      // The launch check ran without being asked: its answer is on the
      // launcher, and the attempt was remembered.
      await expect(page.locator("#loading-update-status")).toContainText(
        "official Developer ID builds",
      );
      await expect
        .poll(async () =>
          page.evaluate(async () =>
            (await window.gwNative.settings.get()).lastUpdateCheckAt),
        )
        .not.toBeNull();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("opted out means zero requests; opting back in checks exactly once", async () => {
    const fixture = await launchOffline(
      "gw-release-check-optout-e2e-",
      { GW_TEST_OFFICIAL_UPDATER: "1" },
      async (userData) => {
        // The player who unticked the box, preserved across upgrades: the
        // launch gate must not fire before the counter can prove it.
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({ autoCheckUpdates: false }),
          { mode: 0o600 },
        );
      },
    );
    try {
      const { app, page } = fixture;
      // Let the launcher mount before the counter is installed, so nothing the
      // first boot did can be attributed to the interactions under test.
      await expect(page.locator("#loading-update-check")).toBeVisible();
      await app.evaluate(countGithubRequests);

      // Opted out, and mounting every renderer surface must not turn that
      // into a release request.
      await expect
        .poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ autoCheckUpdates: false });
      expect(await app.evaluate(() => globalThis.__githubRequests)).toBe(0);
      // The answer surface stayed empty: nothing was asked, so nothing is
      // claimed — not even "up to date".
      await expect(page.locator("#loading-update-status")).toBeHidden();

      // Re-enabling the preference is explicit intent and triggers exactly one
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
