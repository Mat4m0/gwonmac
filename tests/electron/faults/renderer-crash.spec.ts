import {
  expect,
  launchOffline,
  test,
} from "../fixtures.mjs";

test("recovers the sandbox after a real renderer crash", async () => {
  const fixture = await launchOffline("gw-renderer-recovery-fault-");
  const crash = await fixture.app.evaluate(async ({ BrowserWindow, app }) => {
    const windows = BrowserWindow.getAllWindows();
    const [window] = windows;
    if (!window) throw new Error("fault probe found no game window");
    const oldRendererId = window.webContents.id;
    const oldRendererPid = window.webContents.getOSProcessId();
    const otherWindowSharesRenderer = windows.some(
      (candidate) =>
        candidate !== window
        && candidate.webContents.getOSProcessId() === oldRendererPid,
    );
    const gone = new Promise<Electron.RenderProcessGoneDetails>((resolve) => {
      const onGone = (
        _event: Electron.Event,
        contents: Electron.WebContents,
        details: Electron.RenderProcessGoneDetails,
      ): void => {
        if (contents.id !== oldRendererId) return;
        app.off("render-process-gone", onGone);
        resolve(details);
      };
      app.on("render-process-gone", onGone);
    });
    if (process.platform === "linux") {
      // Chromium's self-crash path can hang under hosted Xvfb after logging its
      // fatal assertion. Killing this exact, non-shared renderer proves the
      // same real process-death boundary without depending on crashpad.
      process.kill(oldRendererPid, "SIGKILL");
    } else {
      window.webContents.forcefullyCrashRenderer();
    }
    const details = await gone;
    return {
      oldRendererPid,
      otherWindowSharesRenderer,
      reason: details.reason,
      exitCode: details.exitCode,
    };
  });
  expect(crash.otherWindowSharesRenderer).toBe(false);
  expect([
    "abnormal-exit",
    "killed",
    "crashed",
    "oom",
    "launch-failed",
    "integrity-failure",
  ]).toContain(crash.reason);
  expect(Number.isInteger(crash.exitCode)).toBe(true);

  const readRecovery = () =>
    fixture.app.evaluate(({ BrowserWindow, app }) => {
      const windows = BrowserWindow.getAllWindows();
      const [window] = windows;
      if (windows.length !== 1 || !window) return null;
      const contents = window.webContents;
      if (contents.isCrashed() || contents.isDestroyed()) return null;
      const preferences = (
        contents as typeof contents & {
          getLastWebPreferences(): Electron.WebPreferences | null;
        }
      ).getLastWebPreferences();
      return {
        newRendererPid: contents.getOSProcessId(),
        sandbox: preferences?.sandbox,
        noSandbox: app.commandLine.hasSwitch("no-sandbox"),
      };
    });
  await expect.poll(readRecovery, { timeout: 15_000 }).not.toBeNull();
  const state = await readRecovery();
  if (!state) throw new Error("renderer recovery state disappeared");
  expect(state.newRendererPid).not.toBe(crash.oldRendererPid);
  expect(state.sandbox).toBe(true);
  expect(state.noSandbox).toBe(false);

  await expect
    .poll(async () => {
      for (const page of [...fixture.app.windows()].reverse()) {
        try {
          const ready = await page.evaluate(
            () =>
              globalThis.location.protocol === "gw:" &&
              typeof window.gwNative === "object" &&
              globalThis.document.documentElement.dataset.gwRendererSandboxed
                === "true",
          );
          if (ready) return true;
        } catch {
          // Playwright retains the crashed page until its context closes.
        }
      }
      return false;
    }, { timeout: 15_000 })
    .toBe(true);
});
