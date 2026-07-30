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
import type { AppSettings } from "../../src/shared/contracts.js";
import type { PublishedClientManifest } from "../../src/main/core/published-client.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const electronBin = path.join(
  root,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);
const userData = path.join(root, "test-results", "live-user-data");

/**
 * Emscripten's `FS`, as this smoke drives it. The host mounts it in
 * `src/renderer/harness.ts`; the client publishes it as a page global, so
 * there is no module to import the shape from.
 */
type EmscriptenFilesystem = {
  cwd(): string;
  writeFile(file: string, data: Uint8Array | string): void;
  readFile(file: string): Uint8Array;
  rename(from: string, to: string): void;
  unlink(file: string): void;
  analyzePath(file: string): { error: unknown };
  syncfs(populate: boolean, callback: (error: unknown) => void): void;
};

/** One entry of Emscripten's DOM event-handler registry. */
type EmscriptenEventHandler = {
  eventTypeString: string;
  target: (EventTarget & { id?: string }) | null;
  useCapture: number;
};

/** The page once the generated glue has published its runtime globals. */
type GameGlobals = typeof globalThis & {
  FS: EmscriptenFilesystem;
  JSEvents?: { eventHandlers?: readonly EmscriptenEventHandler[] };
};

/**
 * The same page before the glue has run: a relaunch reaches
 * `domcontentloaded` long before `FS` exists, which is the state the
 * persistence poll below is waiting out.
 */
type LoadingGlobals = typeof globalThis & { FS?: EmscriptenFilesystem };

/** One host-filesystem probe: the bytes read back, or where it failed. */
type FilesystemProbe = {
  bytes: number;
  error: { step: string; name: string; errno: number | null } | null;
};

/**
 * The environment the client launches under. `process.env` types every value
 * `string | undefined` and Playwright's launch environment takes defined
 * values only; `ELECTRON_RUN_AS_NODE` is dropped because it would start the
 * binary as a plain Node process, with no application and no window.
 */
const launchEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && name !== "ELECTRON_RUN_AS_NODE") {
      env[name] = value;
    }
  }
  return env;
};

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
        renderScale: 2,
        nativeCursor: false,
        touchMode: "dbltap",
        showDiagnostics: false,
        dataStrategy: "quick",
      }),
      { mode: 0o600 },
    );
    const env = launchEnv();
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
              if (progress.phase === "error") throw new Error(progress.errorCode);
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
        const game = globalThis as GameGlobals;
        const diagnostics = await window.gwNative.diagnostics.current();
        return {
          jspi: "Suspending" in WebAssembly,
          renderer: diagnostics.latest["graphics.renderer"],
          hardware: diagnostics.latest["graphics.hardwareAcceleration"],
          browserGamepads: typeof globalThis.navigator.getGamepads === "function",
          wheelHandlers: (game.JSEvents?.eventHandlers ?? [])
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
      const publishedClient: PublishedClientManifest = JSON.parse(
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
        // Every assertion below reads through the compatibility state, and an
        // `expect` states the requirement without narrowing it away, so the
        // absent case is the throw rather than a matcher.
        const { compatibility } = identity;
        if (compatibility === null) {
          throw new Error(
            "the main process published no compatibility state for a ready client",
          );
        }
        expect(compatibility.clientSha256).toMatch(/^[a-f0-9]{64}$/);
        // Certification is keyed by hash, so a new ArenaNet build fails here
        // even though every other assertion in this file still passes. That is
        // the alert: run `pnpm template:recertify`, then recertify the Enhancement
        // build. `template-only` means saving works and selected Enhancement tools
        // do not.
        expect(
          compatibility.state,
          `client module ${compatibility.clientSha256} is not a certified build`,
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
          const { FS } = globalThis as GameGlobals;
          const probes: Record<string, FilesystemProbe> = {};
          for (const file of [
            "Templates/Skills/CodexProbe.st",
            "Templates\\Skills\\CodexProbe.st",
            "\\CodexProbe.st",
          ]) {
            let step = "write";
            try {
              const temporary = `${file}.tmp`;
              FS.writeFile(temporary, new Uint8Array([1, 2, 3]));
              step = "rename";
              FS.rename(temporary, file);
              step = "read";
              const bytes = FS.readFile(file).byteLength;
              step = "unlink";
              FS.unlink(file);
              probes[file] = { bytes, error: null };
            } catch (error) {
              // `FS` throws its own `ErrnoError`, which carries `errno`;
              // anything else is reported for what it is rather than reshaped.
              const failure = error as
                | Partial<{ name: string; errno: number }>
                | null
                | undefined;
              probes[file] = {
                bytes: 0,
                error: {
                  step,
                  name: failure?.name ?? "UnknownError",
                  errno: failure?.errno ?? null,
                },
              };
            }
          }
          return {
            cwd: FS.cwd(),
            skills: !FS.analyzePath("Templates/Skills").error,
            equipment: !FS.analyzePath("Templates/Equipment").error,
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

      const applyScale = (renderScale: AppSettings["renderScale"]) =>
        page.evaluate(async (scale) => {
          const current = await window.gwNative.settings.get();
          const saved = await window.gwNative.settings.set({
            ...current,
            renderScale: scale,
          });
          const apply = window.gwApplySettings;
          if (!apply) throw new Error("the renderer published no gwApplySettings");
          apply(saved);
        }, renderScale);
      const dimensions = () =>
        page.evaluate(async () => {
          const canvas = globalThis.document.getElementById("canvas");
          if (!(canvas instanceof globalThis.HTMLCanvasElement)) {
            throw new Error("the game canvas is missing");
          }
          const latest = (await window.gwNative.diagnostics.current()).latest;
          // Every gauge is a `DiagnosticScalar`. A graphics dimension that is
          // not a number is one the renderer has not published yet, which is
          // the same "no buffer" the `|| 0` here has always meant.
          const gauge = (name: string) => {
            const value = latest[name];
            return typeof value === "number" ? value : 0;
          };
          return {
            cssWidth: canvas.clientWidth,
            cssHeight: canvas.clientHeight,
            canvasWidth: gauge("graphics.canvasWidth"),
            canvasHeight: gauge("graphics.canvasHeight"),
            width: gauge("graphics.drawingBufferWidth"),
            height: gauge("graphics.drawingBufferHeight"),
            offscreenWidth: gauge("graphics.offscreenWidth"),
            offscreenHeight: gauge("graphics.offscreenHeight"),
          };
        });

      await test.step("the initial Retina buffer is really 2x", async () => {
        await expect
          .poll(async () => {
            const value = await dimensions();
            const expectedWidth = Math.round(value.cssWidth * 2);
            const expectedHeight = Math.round(value.cssHeight * 2);
            return Math.max(
              Math.abs(value.canvasWidth - expectedWidth),
              Math.abs(value.canvasHeight - expectedHeight),
              Math.abs(value.offscreenWidth - expectedWidth),
              Math.abs(value.offscreenHeight - expectedHeight),
              Math.abs(value.width - expectedWidth),
              Math.abs(value.height - expectedHeight),
            );
          }, { timeout: 30_000 })
          .toBeLessThanOrEqual(1);
        const initial = await dimensions();
        expect(initial.offscreenWidth).toBe(initial.canvasWidth);
        expect(initial.offscreenHeight).toBe(initial.canvasHeight);
        expect(initial.width).toBe(initial.canvasWidth);
        expect(initial.height).toBe(initial.canvasHeight);
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
            new Promise<void>((resolve, reject) => {
              const { FS } = globalThis as GameGlobals;
              FS.writeFile(file, contents);
              FS.syncfs(false, (error) =>
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
              reopenedPage.evaluate(() => {
                const { FS } = globalThis as LoadingGlobals;
                return FS === undefined ? "" : FS.cwd();
              }),
            { timeout: 5 * 60_000, intervals: [500, 1_000] },
          )
          .toBe("/app:");
        expect(
          await reopenedPage.evaluate(
            (file) =>
              new globalThis.TextDecoder().decode(
                (globalThis as GameGlobals).FS.readFile(file),
              ),
            persistenceProbe,
          ),
        ).toBe("persistent");
        await reopenedPage.evaluate(
          (file) =>
            new Promise<void>((resolve, reject) => {
              const { FS } = globalThis as GameGlobals;
              FS.unlink(file);
              FS.syncfs(false, (error) =>
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
