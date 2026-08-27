import { expect, test } from "@playwright/test";
import { mkdir, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  closeOffline,
  launchOffline,
} from "./fixtures.mjs";

/**
 * `gw-native.d.ts` declares the graphics half of ArenaNet's `Module`; the
 * socket host installs itself on the same object, and what it installs is
 * described by the host's own return type rather than restated here.
 */
type ModuleWithSocket = NonNullable<Window["Module"]> & {
  socket?: ReturnType<
    typeof import("../../src/renderer/socket-host.js").createSocketHost
  >["socket"];
};

async function pathExists(target: string) {
  return stat(target).then(
    () => true,
    () => false,
  );
}

test.describe("client compatibility", () => {
  test("reports one first frame and opens a game socket", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(6112, "127.0.0.1", resolve);
    });
    const fixture = await launchOffline("gw-client-host-e2e-", {
      GW_TEST_SOCKET_LOOPBACK: "1",
    });
    try {
      await fixture.page.waitForFunction(() => {
        const game = window.Module as ModuleWithSocket | undefined;
        return typeof game?.socket?.connect === "function";
      });
      expect(
        await fixture.page.evaluate(async () => {
          // The page serves renderer modules under `gw://app`; no path from
          // this spec resolves that specifier, so the shape is taken from the
          // source module instead of from the address.
          const importRenderer = async <T>(specifier: string): Promise<T> =>
            import(specifier);
          const { installGraphics } = await importRenderer<
            typeof import("../../src/renderer/graphics.js")
          >("./graphics.js");
          const canvas: HTMLCanvasElement & { offscreen?: OffscreenCanvas } =
            globalThis.document.createElement("canvas");
          canvas.width = 32;
          canvas.height = 32;
          const module: ArenaNetGraphicsModule = { canvas };
          let frames = 0;
          // Every member is present here, so none of them is optional: the spec
          // calls all four back after `installGraphics` has replaced them.
          const env: ArenaNetEglImports & {
            emscripten_get_device_pixel_ratio: () => number;
            emscripten_set_canvas_element_size: (
              target: unknown,
              width: number,
              height: number,
            ) => unknown;
          } = {
            eglCreateContext: () => {
              module.canvas.getContext("webgl");
              return 1;
            },
            eglSwapBuffers: () => 1,
            emscripten_get_device_pixel_ratio: () => 1,
            emscripten_set_canvas_element_size: () => 0,
          };
          installGraphics({
            env,
            module,
            renderScale: () => 2,
            firstFrame: () => {
              frames += 1;
            },
            log: () => undefined,
          });
          env.eglCreateContext();
          env.emscripten_set_canvas_element_size(null, 64, 64);
          env.eglSwapBuffers();
          env.eglSwapBuffers();
          if (!canvas.offscreen) {
            throw new Error("installGraphics attached no offscreen canvas");
          }
          return {
            frames,
            density: env.emscripten_get_device_pixel_ratio(),
            visibleRestored: module.canvas === canvas,
            offscreen: [canvas.offscreen.width, canvas.offscreen.height],
          };
        }),
      ).toEqual({
        frames: 1,
        density: 2,
        visibleRestored: true,
        offscreen: [64, 64],
      });
      // The cache is a separate renderer module; prove it ships and resolves as
      // ESM under gw://app — a copy-renderer or protocol regression rejects the
      // import — that an incomplete program is never frozen, and that a
      // completed one stops costing a round trip. Whether *boot* installs it is
      // not assertable here: installGlProgramCache runs from
      // Module.instantiateWasm, and this cached-only fixture has no client, so the
      // glue never loads.
      expect(
        await fixture.page.evaluate(async () => {
          const importRenderer = async <T>(specifier: string): Promise<T> =>
            import(specifier);
          const { installGlProgramCache } = await importRenderer<
            typeof import("../../src/renderer/gl-program-cache.js")
          >("./gl-program-cache.js");
          // Installing into the live page overwrites gwGlRecon and would bump
          // the session's real query counters; both are put back below.
          const realRecon = window.gwGlRecon;
          const realDiagnostics = window.gwDiagnostics;
          window.gwDiagnostics = { ...realDiagnostics, glProgramQuery: () => {} };
          const module = { HEAPU8: new Uint8Array(new ArrayBuffer(1024)) };
          const calls: number[] = [];
          let answer = 0;
          const env = {
            glGetProgramiv: (_program: number, pname: number, p: number) => {
              calls.push(pname);
              new Int32Array(module.HEAPU8.buffer)[p >>> 2] = answer;
            },
            glCreateProgram: () => 1,
            glLinkProgram: () => undefined,
            glDeleteProgram: () => undefined,
          };
          installGlProgramCache({
            imports: { env },
            module,
            log: () => undefined,
          });
          const read = (pname: number) => {
            env.glGetProgramiv(1, pname, 64);
            return new Int32Array(module.HEAPU8.buffer)[16];
          };
          env.glCreateProgram();
          const polling = [read(0x91b1), read(0x91b1)];
          answer = 1;
          const completed = read(0x91b1);
          answer = 0;
          const held = read(0x91b1);
          // Exact restoration: the property is optional, so an absent probe is
          // put back as absent rather than as an explicit `undefined`.
          if (realRecon) window.gwGlRecon = realRecon;
          else delete window.gwGlRecon;
          window.gwDiagnostics = realDiagnostics;
          return { polling, completed, held, calls: calls.length };
        }),
      ).toEqual({
        polling: [0, 0],
        completed: 1,
        held: 1,
        calls: 3,
      });
      await fixture.page.evaluate(async () => {
        const game = window.Module as ModuleWithSocket | undefined;
        if (!game?.socket) throw new Error("the socket host is not installed");
        const socket = game.socket.connect("127.0.0.1:6112");
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("candidate socket did not open")),
            5_000,
          );
          socket.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
          socket.onclose = () => {
            clearTimeout(timeout);
            reject(new Error("candidate socket closed before opening"));
          };
        });
        socket.close();
      });
    } finally {
      await closeOffline(fixture);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("the notice grows the dock without covering the legal footer", async () => {
    // The notice makes the dock half as tall again. While the footer was
    // pinned to a constant it went behind the dock's opaque gradient, and the
    // attribution index.html renders statically — precisely so it cannot
    // depend on anything succeeding — was unreadable on the one launch that
    // shows the notice. Real copy, real stylesheet, real Chromium layout.
    const fixture = await launchOffline("gw-compat-notice-layout-e2e-");
    try {
      const { page } = fixture;
      const rects = () =>
        page.evaluate(() => {
          const box = (id: string) => {
            const element = globalThis.document.getElementById(id);
            if (!element) throw new Error(`#${id} is missing`);
            return element.getBoundingClientRect();
          };
          return {
            dock: box("loading-dock"),
            legal: box("loading-legal"),
            notice: box("client-compat"),
          };
        });
      await expect(page.locator("#loading-dock")).toBeVisible();
      const before = await rects();

      await page.evaluate(async () => {
        const importRenderer = async <T>(specifier: string): Promise<T> =>
          import(specifier);
        const { compatibilityReport } = await importRenderer<
          typeof import("../../src/renderer/client-compatibility-notice.js")
        >("./client-compatibility-notice.js");
        const report = compatibilityReport(
          {
            clientSha256: "a".repeat(64),
            features: {
              gameFileSaving: { status: "unavailable", reason: "game-update" },
              nativeDoubleClick: { status: "unavailable", reason: "game-update" },
              nativeCursor: { status: "unavailable", reason: "game-update" },
              playRegionObservation: { status: "off" },
        preGameControls: { status: "off" },
              targetObservation: { status: "off" },
              partyObservation: { status: "off" },
              teamApply: { status: "off" },
              travelAction: { status: "off" },
              xunlaiAction: { status: "off" },
              chatAliases: { status: "off" },
              skillSlotGeometry: { status: "off" },
              skillCooldownObservation: { status: "off" },
            },
          },
        );
        const byId = (id: string) => {
          const element = globalThis.document.getElementById(id);
          if (!element) throw new Error(`#${id} is missing`);
          return element;
        };
        byId("client-compat-title").textContent = report.summary;
        byId("client-compat-detail").textContent = report.details.join(" ");
        byId("client-compat-version").textContent =
          "App version 2026.7.0-alpha.1.";
        const answer = byId("client-compat-update");
        answer.textContent =
          "Couldn't check — GitHub did not answer within five seconds.";
        answer.hidden = false;
        byId("client-compat").hidden = false;
      });
      const after = await rects();

      // Not a vacuous pass: the notice is on screen and the dock did grow.
      expect(after.notice.height).toBeGreaterThan(0);
      expect(after.dock.height).toBeGreaterThanOrEqual(before.dock.height);
      expect(after.legal.bottom).toBeLessThanOrEqual(after.dock.top);
      expect(before.legal.bottom).toBeLessThanOrEqual(before.dock.top);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("rolls back a candidate when its renderer crashes before a frame", async () => {
    const fingerprint = "c".repeat(64);
    let artifacts!: string;
    let rejected!: string;
    const fixture = await launchOffline(
      "gw-client-crash-rollback-e2e-",
      {},
      async (userData) => {
        artifacts = path.join(userData, "game", "artifacts");
        const previous = path.join(userData, "game", "artifacts.previous");
        rejected = path.join(userData, "game", "rejected-client.json");
        await mkdir(artifacts, { recursive: true });
        await mkdir(previous, { recursive: true });
        await writeFile(
          path.join(artifacts, ".candidate.json"),
          JSON.stringify({ formatVersion: 1, fingerprint }),
        );
        await writeFile(
          path.join(previous, "manifest.json"),
          JSON.stringify({
            compressionMode: "none",
            chunkSize: 1,
            snapshot: "Gw.snapshot",
            size: 1,
            chunkHashes: ["e".repeat(32)],
          }),
        );
      },
    );
    try {
      await fixture.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer();
      });
      await expect
        .poll(() => pathExists(path.join(artifacts, "manifest.json")), {
          timeout: 15_000,
        })
        .toBe(true);
      expect(await pathExists(path.join(artifacts, ".candidate.json"))).toBe(
        false,
      );
      expect(await pathExists(rejected)).toBe(true);
      await expect
        .poll(() => fixture.app.windows().length, { timeout: 15_000 })
        .toBe(1);
    } finally {
      await closeOffline(fixture);
    }
  });
});
