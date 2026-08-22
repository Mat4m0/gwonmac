// The load-bearing network claim, executed rather than read.
//
// `autoCheckUpdates` is on by default, but a settled attempt suppresses another
// automatic request for six hours even across restarts. Opting out suppresses
// every automatic request. Manual intent remains immediate in both cases.
//
// The exact request counts below stay deterministic because the periodic
// tick first fires thirty minutes in — far beyond any spec's lifetime.
// Anyone who shortens `PERIODIC_CHECK_TICK_MS` or adds a test seam for it
// must revisit every 0/1/2 count in this file.
//
// Launch happens before a test can wrap main's `fetch`, so persisted settings
// make the launch answer observable: recent and opted-out profiles leave the
// status empty and their timestamp unchanged. The manual checks that follow
// install a counter around the real main-process boundary.
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { closeOffline, launchOffline } from "./fixtures.mjs";

declare global {
  // The counter the stub below keeps in the main process, read back through
  // `app.evaluate`. It exists only while this spec runs.
  var __updateFeedRequests: number;
}

/** Wraps main's `fetch`, stubs the channel feed, and passes everything else through. */
function countUpdateFeedRequests() {
  globalThis.__updateFeedRequests = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    // `fetch` accepts a string, a `URL`, or a `Request`; only the last carries
    // the address on `.url`. Reading `.url` off the other two yielded
    // `undefined` and threw on the next line.
    const url =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
    if (!url.startsWith("https://mat4m0.github.io/gwonmac/updates/")) {
      return real(input, init);
    }
    globalThis.__updateFeedRequests += 1;
    // A real answer, so the renderer takes the success path; no packet leaves
    // this machine.
    return Promise.resolve(
      new globalThis.Response(JSON.stringify({
        url: "https://github.com/Mat4m0/gwonmac/releases/download/v2026.8.9/Guild-Wars-Reforged-2026.8.9-macOS-arm64.zip",
        name: "Guild Wars Reforged v2026.8.9",
        version: "2026.8.9",
        tag: "v2026.8.9",
        pub_date: "2026-08-22T00:00:00.000Z",
        notes: "",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

test.describe("release check network policy", () => {
  for (const channel of [null, "preview", "development"] as const) {
    test(`${channel ?? "unmarked"} cannot reach the update feed`, async () => {
      const environment = channel
        ? { GW_TEST_DISTRIBUTION_CHANNEL: channel }
        : {};
      const fixture = await launchOffline(
        `gw-release-check-${channel ?? "unmarked"}-e2e-`,
        environment,
      );
      try {
        const { app, page } = fixture;
        await expect
          .poll(() => page.evaluate(() => window.gwNative.settings.get()))
          .toMatchObject({ autoCheckUpdates: true });
        await expect(page.locator("#loading-update-status")).toBeHidden();
        expect(
          await page.evaluate(async () =>
            (await window.gwNative.settings.get()).lastUpdateCheckAt),
        ).toBeNull();

        // Prove the same denial for fresh user intent, after installing a
        // counter around the main process's actual fetch implementation.
        await app.evaluate(countUpdateFeedRequests);
        await page.locator("#loading-update-check").click();
        await expect(page.locator("#loading-update-status")).toContainText(
          "must be updated manually",
        );
        expect(await app.evaluate(() => globalThis.__updateFeedRequests)).toBe(0);
      } finally {
        await closeOffline(fixture);
      }
    });
  }

  test("opted out means zero requests; preference changes wait for an update check", async () => {
    const fixture = await launchOffline(
      "gw-release-check-optout-e2e-",
      { GW_TEST_DISTRIBUTION_CHANNEL: "release" },
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
      await app.evaluate(countUpdateFeedRequests);

      // Opted out, and mounting every renderer surface must not turn that
      // into a release request.
      await expect
        .poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ autoCheckUpdates: false });
      expect(await app.evaluate(() => globalThis.__updateFeedRequests)).toBe(0);
      // The answer surface stayed empty: nothing was asked, so nothing is
      // claimed — not even "up to date".
      await expect(page.locator("#loading-update-status")).toBeHidden();

      // A settings write is not a network command. Re-enabling the schedule
      // changes future launch/periodic behaviour without starting an automatic
      // download over a game connection that may already be open.
      await page.evaluate(() =>
        window.gwNative.settings.set({ autoCheckUpdates: true }),
      );
      expect(await app.evaluate(() => globalThis.__updateFeedRequests)).toBe(0);

      // A manual press is fresh user intent and remains the immediate path.
      await page.locator("#loading-update-check").click();
      await expect(page.locator("#loading-update-check")).toHaveText(
        "Check for updates",
      );
      expect(await app.evaluate(() => globalThis.__updateFeedRequests)).toBe(1);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("a recent settled attempt suppresses the next launch request", async () => {
    const checkedAt = Date.now();
    const fixture = await launchOffline(
      "gw-release-check-recent-e2e-",
      { GW_TEST_DISTRIBUTION_CHANNEL: "release" },
      async (userData) => {
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({ autoCheckUpdates: true, lastUpdateCheckAt: checkedAt }),
          { mode: 0o600 },
        );
      },
    );
    try {
      const { app, page } = fixture;
      await expect(page.locator("#loading-update-check")).toBeVisible();
      await expect(page.locator("#loading-update-status")).toBeHidden();
      expect(
        await page.evaluate(async () =>
          (await window.gwNative.settings.get()).lastUpdateCheckAt),
      ).toBe(checkedAt);

      await app.evaluate(countUpdateFeedRequests);
      await page.locator("#loading-update-check").click();
      await expect(page.locator("#loading-update-check")).toHaveText(
        "Check for updates",
      );
      expect(await app.evaluate(() => globalThis.__updateFeedRequests)).toBe(1);
    } finally {
      await closeOffline(fixture);
    }
  });
});
