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
        nativeCursor: false,
        touchMode: "dbltap",
        showDiagnostics: false,
        dataStrategy: "quick",
      }),
      { mode: 0o600 },
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    let application = await electron.launch({
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

      const platform = await page.evaluate(async () => {
        const diagnostics = await window.gwNative.diagnostics.current();
        return {
          jspi: "Suspending" in WebAssembly,
          renderer: diagnostics.latest["graphics.renderer"],
          hardware: diagnostics.latest["graphics.hardwareAcceleration"],
          browserGamepads: typeof globalThis.navigator.getGamepads === "function",
          wheelHandlers: (globalThis.JSEvents?.eventHandlers ?? [])
            .filter((handler) => handler.eventTypeString === "wheel")
            .map((handler) => ({
              target:
                handler.target === globalThis.window
                  ? "window"
                  : handler.target === globalThis.document
                    ? "document"
                    : handler.target?.id || handler.target?.constructor?.name,
              capture: handler.useCapture,
            })),
          stats: window.gwStats(),
        };
      });

      // The build's identity, read from the one owner of the three
      // certification states and from the gauges a `.gwdiag` carries.
      const identity = await page.evaluate(async () => {
        const session = await window.gwNative.client.session();
        const diagnostics = await window.gwNative.diagnostics.current();
        return {
          compatibility: session.compatibility,
          certificationGauge: diagnostics.latest["client.buildCertification"],
          templateSaveGauge: diagnostics.latest["wasm.templateSaveCompatible"],
        };
      });
      const publishedClient = JSON.parse(
        readFileSync(
          path.join(userData, "game", "artifacts", "manifest.json"),
          "utf8",
        ),
      );

      // Reported before the assertions run: when ArenaNet ships a new build the
      // canary goes red, and the two hashes below are exactly what
      // recertification needs. A summary written after the failing assertion
      // would be a summary nobody gets.
      const clientSha256 = identity.compatibility?.clientSha256 ?? "unavailable";
      console.log(
        `ArenaNet client fingerprint: ${publishedClient.clientFingerprint}`,
      );
      console.log(
        `ArenaNet client module sha256: ${clientSha256} (${identity.certificationGauge})`,
      );
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          [
            "## ArenaNet client canary",
            "",
            `- Client fingerprint: \`${publishedClient.clientFingerprint}\``,
            `- Client module sha256: \`${clientSha256}\``,
            `- Build certification: ${identity.certificationGauge}`,
            `- Renderer: ${String(platform.renderer)}`,
            `- JSPI initialized: ${platform.jspi ? "yes" : "no"}`,
            "- Hardware frame submitted: yes",
            `- Gamepad host imports: ${platform.stats.gamepadImports ? "available" : "missing"}`,
            "",
          ].join("\n"),
        );
      }

      await test.step("the live client is a build this app has certified", async () => {
        expect(publishedClient.clientFingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(
          identity.compatibility,
          "the main process published no compatibility state for a ready client",
        ).not.toBeNull();
        expect(identity.compatibility.clientSha256).toMatch(/^[a-f0-9]{64}$/);
        // Certification is keyed by hash, so a new ArenaNet build fails here
        // even though every other assertion in this file still passes. That is
        // the alert: run `pnpm template:recertify`, then recertify the Toolbox
        // build. `template-only` means saving works and the cursor does not.
        expect(
          identity.compatibility.state,
          `client module ${identity.compatibility.clientSha256} is not a certified build`,
        ).toBe("certified");
        expect(identity.certificationGauge).toBe("certified");
        // Emitted into every `.gwdiag`; a false here means templates, build
        // screenshots and chat logs are broken for every player on this build.
        expect(identity.templateSaveGauge).toBe(true);
      });

      // Not the client's own template save path: this drives Emscripten's `FS`
      // directly, and what it proves is that the host's IDBFS mount is where
      // the client will look and that Windows-style separators resolve there.
      await test.step("host-filesystem-smoke", async () => {
        const filesystem = await page.evaluate(async () => {
          const probes = {};
          for (const file of [
            "Templates/Skills/CodexProbe.st",
            "Templates\\Skills\\CodexProbe.st",
            "\\CodexProbe.st",
          ]) {
            let step = "write";
            try {
              const temporary = `${file}.tmp`;
              globalThis.FS.writeFile(temporary, new Uint8Array([1, 2, 3]));
              step = "rename";
              globalThis.FS.rename(temporary, file);
              step = "read";
              const bytes = globalThis.FS.readFile(file).byteLength;
              step = "unlink";
              globalThis.FS.unlink(file);
              probes[file] = { bytes, error: null };
            } catch (error) {
              probes[file] = {
                bytes: 0,
                error: {
                  step,
                  name: error?.name ?? "UnknownError",
                  errno: error?.errno ?? null,
                },
              };
            }
          }
          return {
            cwd: globalThis.FS.cwd(),
            skills: !globalThis.FS.analyzePath("Templates/Skills").error,
            equipment: !globalThis.FS.analyzePath("Templates/Equipment").error,
            probes,
          };
        });
        expect(filesystem).toEqual({
          cwd: "/app:",
          skills: true,
          equipment: true,
          probes: {
            "Templates/Skills/CodexProbe.st": { bytes: 3, error: null },
            "Templates\\Skills\\CodexProbe.st": { bytes: 3, error: null },
            "\\CodexProbe.st": { bytes: 3, error: null },
          },
        });
      });

      await test.step("the host's platform services reach the running client", async () => {
        expect(platform.jspi).toBe(true);
        expect(platform.hardware).toBe(true);
        expect(platform.browserGamepads).toBe(true);
        expect(platform.wheelHandlers).toEqual([
          { target: "canvas", capture: 0 },
        ]);
        expect(platform.stats.gamepadImports).toBe(true);
        expect(String(platform.renderer)).not.toMatch(
          /swiftshader|llvmpipe|software/i,
        );
        expect(platform.stats.reads).toBeGreaterThan(0);
      });

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
            offscreenWidth: latest["graphics.offscreenWidth"] || 0,
            offscreenHeight: latest["graphics.offscreenHeight"] || 0,
          };
        });

      await test.step("render scale changes the real drawing buffer", async () => {
        await applyScale(1);
        await expect
          .poll(async () => {
            const value = await dimensions();
            return value.width * value.height;
          }, { timeout: 30_000 })
          .toBeGreaterThan(0);
        const oneX = await dimensions();
        expect(oneX.width * oneX.height).toBeGreaterThan(0);
        expect(oneX.offscreenWidth).toBe(oneX.width);
        expect(oneX.offscreenHeight).toBe(oneX.height);
        await applyScale(1.5);
        await expect
          .poll(async () => {
            const oneAndHalfX = await dimensions();
            return (
              (oneAndHalfX.width * oneAndHalfX.height) /
              (oneX.width * oneX.height)
            );
          }, { timeout: 30_000 })
          .toBeGreaterThan(2);
        const oneAndHalfX = await dimensions();
        const oneAndHalfRatio =
          (oneAndHalfX.width * oneAndHalfX.height) /
          (oneX.width * oneX.height);
        expect(oneAndHalfRatio).toBeLessThan(2.5);
        expect(oneAndHalfX.offscreenWidth).toBe(oneAndHalfX.width);
        expect(oneAndHalfX.offscreenHeight).toBe(oneAndHalfX.height);
        await applyScale(2);
        await expect
          .poll(async () => {
            const twoX = await dimensions();
            return (twoX.width * twoX.height) / (oneX.width * oneX.height);
          }, { timeout: 30_000 })
          .toBeGreaterThan(3.5);
        const twoX = await dimensions();
        expect(
          (twoX.width * twoX.height) / (oneX.width * oneX.height),
        ).toBeLessThan(4.5);
        expect(twoX.offscreenWidth).toBe(twoX.width);
        expect(twoX.offscreenHeight).toBe(twoX.height);
        await applyScale(1);
      });

      await test.step("host-filesystem-smoke: the mount survives a relaunch", async () => {
        const persistenceProbe = "Templates/Skills/.gwonmac-persistence-check";
        await page.evaluate(
          ({ file, contents }) =>
            new Promise((resolve, reject) => {
              globalThis.FS.writeFile(file, contents);
              globalThis.FS.syncfs(false, (error) =>
                error ? reject(error) : resolve(),
              );
            }),
          { file: persistenceProbe, contents: "persistent" },
        );
        await application.close();

        application = await electron.launch({
          cwd: root,
          args: [".", `--user-data-dir=${userData}`],
          env,
          executablePath: electronBin,
        });
        const reopenedPage = await application.firstWindow({ timeout: 30_000 });
        await reopenedPage.waitForLoadState("domcontentloaded");
        await expect
          .poll(
            () =>
              reopenedPage.evaluate(() =>
                typeof globalThis.FS === "undefined"
                  ? ""
                  : globalThis.FS.cwd(),
              ),
            { timeout: 5 * 60_000, intervals: [500, 1_000] },
          )
          .toBe("/app:");
        expect(
          await reopenedPage.evaluate(
            (file) =>
              new globalThis.TextDecoder().decode(globalThis.FS.readFile(file)),
            persistenceProbe,
          ),
        ).toBe("persistent");
        await reopenedPage.evaluate(
          (file) =>
            new Promise((resolve, reject) => {
              globalThis.FS.unlink(file);
              globalThis.FS.syncfs(false, (error) =>
                error ? reject(error) : resolve(),
              );
            }),
          persistenceProbe,
        );
      });
    } finally {
      await application.close();
    }
  });
});
