import {
  expect,
  launchOffline,
  test,
} from "../fixtures.mjs";

test("recovers the sandbox after a real renderer crash", async () => {
  const fixture = await launchOffline("gw-renderer-recovery-fault-");
  const applicationWindow = await fixture.app.browserWindow(fixture.page);
  const before = await fixture.app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const [window] = windows;
    if (!window) throw new Error("fault probe found no game window");
    const oldRendererPid = window.webContents.getOSProcessId();
    const otherWindowSharesRenderer = windows.some(
      (candidate) =>
        candidate !== window
        && candidate.webContents.getOSProcessId() === oldRendererPid,
    );
    const state: {
      oldRendererPid: number;
      reason: string | null;
      exitCode: number | null;
    } = {
      oldRendererPid,
      reason: null,
      exitCode: null,
    };
    (
      globalThis as typeof globalThis & {
        __gwFaultProbe?: typeof state;
      }
    ).__gwFaultProbe = state;
    window.webContents.once("render-process-gone", (_event, details) => {
      state.reason = details.reason;
      state.exitCode = details.exitCode;
    });
    return { oldRendererPid, otherWindowSharesRenderer };
  });
  expect(before.otherWindowSharesRenderer).toBe(false);

  await applicationWindow.evaluate((window) => {
    window.webContents.forcefullyCrashRenderer();
  });

  const readRecovery = () =>
    fixture.app.evaluate(({ BrowserWindow, app }) => {
      const state = (
        globalThis as typeof globalThis & {
          __gwFaultProbe?: {
            oldRendererPid: number;
            reason: string | null;
            exitCode: number | null;
          };
        }
      ).__gwFaultProbe;
      const windows = BrowserWindow.getAllWindows();
      const [window] = windows;
      if (
        !state
        || state.reason === null
        || state.exitCode === null
        || windows.length !== 1
        || !window
      ) {
        return null;
      }
      const contents = window.webContents;
      if (contents.isCrashed() || contents.isDestroyed()) return null;
      const preferences = (
        contents as typeof contents & {
          getLastWebPreferences(): Electron.WebPreferences | null;
        }
      ).getLastWebPreferences();
      return {
        reason: state.reason,
        exitCode: state.exitCode,
        oldRendererPid: state.oldRendererPid,
        newRendererPid: contents.getOSProcessId(),
        sandbox: preferences?.sandbox,
        noSandbox: app.commandLine.hasSwitch("no-sandbox"),
      };
    });
  await expect.poll(readRecovery, { timeout: 15_000 }).not.toBeNull();
  const state = await readRecovery();
  if (!state) throw new Error("renderer recovery state disappeared");
  expect([
    "abnormal-exit",
    "killed",
    "crashed",
    "oom",
    "launch-failed",
    "integrity-failure",
  ]).toContain(state.reason);
  expect(Number.isInteger(state.exitCode)).toBe(true);
  expect(state.newRendererPid).not.toBe(state.oldRendererPid);
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
