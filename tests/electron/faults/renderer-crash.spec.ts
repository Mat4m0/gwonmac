import {
  expect,
  launchOffline,
  test,
} from "../fixtures.mjs";

test("recovers the sandbox after a real renderer crash", async () => {
  const fixture = await launchOffline("gw-renderer-recovery-fault-");
  const applicationWindow = await fixture.app.browserWindow(fixture.page);
  await applicationWindow.evaluate((window) => {
    window.webContents.forcefullyCrashRenderer();
  });
  await expect
    .poll(
      async () => {
        const [firstWindow] = fixture.app.windows();
        if (!firstWindow) return false;
        try {
          return await firstWindow.evaluate(
            () =>
              globalThis.location.protocol === "gw:" &&
              typeof window.gwNative === "object",
          );
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});
