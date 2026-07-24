import { test, expect, _electron as electron } from "@playwright/test";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const electronBin = path.join(
  root,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);
const userData = path.join(root, "test-results", "live-user-data");

test.describe("live client", () => {
  test.skip(
    process.env.GW_LIVE_SMOKE !== "1",
    "set GW_LIVE_SMOKE=1 to contact ArenaNet and exercise the real client",
  );

  test("downloads, initializes JSPI, and submits a hardware frame", async () => {
    test.setTimeout(10 * 60_000);
    rmSync(userData, { recursive: true, force: true });
    mkdirSync(userData, { recursive: true });
    writeFileSync(
      path.join(userData, "settings.json"),
      JSON.stringify({
        renderScale: 1,
        pointerLock: true,
        cursorTheme: "guild-wars",
        touchMode: "dbltap",
        showDiagnostics: false,
        dataStrategy: "quick",
      }),
      { mode: 0o600 },
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const application = await electron.launch({
      cwd: root,
      args: [".", `--user-data-dir=${userData}`],
      env,
      executablePath: electronBin,
    });
    try {
      const page = await application.firstWindow({ timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded");
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              const progress = await window.gwNative.progress.current();
              if (progress.error) throw new Error(progress.error);
              return progress.phase;
            }),
          { timeout: 5 * 60_000, intervals: [500, 1_000, 2_000] },
        )
        .toBe("ready");

      await expect
        .poll(
          () =>
            page.evaluate(
              () => performance.getEntriesByName("gw.frame.first-submit").length,
            ),
          { timeout: 5 * 60_000, intervals: [500, 1_000] },
        )
        .toBeGreaterThan(0);

      const state = await page.evaluate(async () => {
        const diagnostics = await window.gwNative.diagnostics.current();
        return {
          jspi: "Suspending" in WebAssembly,
          renderer: diagnostics.latest["graphics.renderer"],
          hardware: diagnostics.latest["graphics.hardwareAcceleration"],
          browserGamepads: typeof globalThis.navigator.getGamepads === "function",
          stats: window.gwStats(),
        };
      });
      expect(state.jspi).toBe(true);
      expect(state.hardware).toBe(true);
      expect(state.browserGamepads).toBe(true);
      expect(state.stats.gamepadImports).toBe(true);
      expect(String(state.renderer)).not.toMatch(/swiftshader|llvmpipe|software/i);
      expect(state.stats.reads).toBeGreaterThan(0);
      const publishedClient = JSON.parse(
        readFileSync(
          path.join(userData, "game", "artifacts", "manifest.json"),
          "utf8",
        ),
      );
      expect(publishedClient.clientFingerprint).toMatch(/^[a-f0-9]{64}$/);
      console.log(
        `ArenaNet client fingerprint: ${publishedClient.clientFingerprint}`,
      );
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          [
            "## ArenaNet client canary",
            "",
            `- Client fingerprint: \`${publishedClient.clientFingerprint}\``,
            `- Renderer: ${String(state.renderer)}`,
            "- JSPI initialized: yes",
            "- Hardware frame submitted: yes",
            "- Gamepad host imports: available",
            "",
          ].join("\n"),
        );
      }

      const applyScale = (renderScale) =>
        page.evaluate(async (scale) => {
          const current = await window.gwNative.settings.get();
          const saved = await window.gwNative.settings.set({
            ...current,
            renderScale: scale,
          });
          window.gwApplySettings(saved);
        }, renderScale);
      const dimensions = () =>
        page.evaluate(async () => {
          const latest = (await window.gwNative.diagnostics.current()).latest;
          return {
            width: latest["graphics.drawingBufferWidth"] || 0,
            height: latest["graphics.drawingBufferHeight"] || 0,
          };
        });

      await applyScale(1);
      await expect
        .poll(async () => {
          const value = await dimensions();
          return value.width * value.height;
        }, { timeout: 30_000 })
        .toBeGreaterThan(0);
      const oneX = await dimensions();
      expect(oneX.width * oneX.height).toBeGreaterThan(0);
      await applyScale(2);
      await expect
        .poll(async () => {
          const twoX = await dimensions();
          return (twoX.width * twoX.height) / (oneX.width * oneX.height);
        }, { timeout: 30_000 })
        .toBeGreaterThan(3.5);
      await applyScale(1);
    } finally {
      await application.close();
    }
  });
});
