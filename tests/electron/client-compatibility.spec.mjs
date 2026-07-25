import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  closeOffline,
  launchOffline,
  main,
} from "./fixtures.mjs";

async function pathExists(target) {
  return stat(target).then(
    () => true,
    () => false,
  );
}

test.describe("client compatibility", () => {
  test.skip(!existsSync(main), "run the build before Electron tests");

  test("promotes a candidate only after a frame and game socket open", async () => {
    const fingerprint = "a".repeat(64);
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(6112, "127.0.0.1", resolve);
    });
    let artifacts;
    let previous;
    let rejected;
    const fixture = await launchOffline(
      "gw-client-promotion-e2e-",
      {},
      async (userData) => {
        artifacts = path.join(userData, "game", "artifacts");
        previous = path.join(userData, "game", "artifacts.previous");
        rejected = path.join(userData, "game", "rejected-client.json");
        await mkdir(artifacts, { recursive: true });
        await mkdir(previous, { recursive: true });
        await writeFile(
          path.join(artifacts, ".candidate.json"),
          JSON.stringify({ formatVersion: 1, fingerprint }),
        );
        await writeFile(
          rejected,
          JSON.stringify({
            formatVersion: 1,
            fingerprint: "b".repeat(64),
            hostVersion: "older-host",
          }),
        );
      },
    );
    try {
      await fixture.page.waitForFunction(
        () => typeof window.Module?.socket?.connect === "function",
      );
      expect(await pathExists(previous)).toBe(true);
      expect(
        await fixture.page.evaluate(() => {
          const canvas = globalThis.document.createElement("canvas");
          canvas.width = 32;
          canvas.height = 32;
          const module = { canvas };
          let frames = 0;
          const env = {
            eglCreateContext: () => {
              module.canvas.getContext("webgl");
              return 1;
            },
            eglSwapBuffers: () => 1,
            emscripten_get_device_pixel_ratio: () => 1,
            emscripten_set_canvas_element_size: () => 0,
          };
          window.gwInstallGraphics({
            env,
            module,
            renderScale: () => 2,
            firstFrame: () => {
              frames += 1;
              void window.gwNative.client.healthy();
            },
            log: () => undefined,
          });
          env.eglCreateContext();
          env.emscripten_set_canvas_element_size(null, 64, 64);
          env.eglSwapBuffers();
          env.eglSwapBuffers();
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
      // The cache is a separate renderer script; prove index.html loads it,
      // that an incomplete program is never frozen, and that a completed one
      // stops costing a round trip.
      expect(
        await fixture.page.evaluate(() => {
          // Installing a second cache into the live page would otherwise
          // overwrite gwGlRecon and bump the session's real query counters.
          const realRecon = window.gwGlRecon;
          const realDiagnostics = window.gwDiagnostics;
          window.gwDiagnostics = { ...realDiagnostics, glProgramQuery: () => {} };
          const module = { HEAPU8: new Uint8Array(new ArrayBuffer(1024)) };
          const calls = [];
          let answer = 0;
          const env = {
            glGetProgramiv: (program, pname, p) => {
              calls.push(pname);
              new Int32Array(module.HEAPU8.buffer)[p >>> 2] = answer;
            },
            glCreateProgram: () => 1,
            glLinkProgram: () => undefined,
            glDeleteProgram: () => undefined,
          };
          window.gwInstallGlProgramCache({
            imports: { env },
            module,
            log: () => undefined,
          });
          const read = (pname) => {
            env.glGetProgramiv(1, pname, 64);
            return new Int32Array(module.HEAPU8.buffer)[16];
          };
          env.glCreateProgram();
          const polling = [read(0x91b1), read(0x91b1)];
          answer = 1;
          const completed = read(0x91b1);
          answer = 0;
          const held = read(0x91b1);
          window.gwGlRecon = realRecon;
          window.gwDiagnostics = realDiagnostics;
          return { polling, completed, held, calls: calls.length };
        }),
      ).toEqual({
        polling: [0, 0],
        completed: 1,
        held: 1,
        calls: 3,
      });
      expect(await pathExists(path.join(artifacts, ".candidate.json"))).toBe(true);
      await fixture.page.evaluate(async () => {
        const socket = window.Module.socket.connect("127.0.0.1:6112");
        await new Promise((resolve, reject) => {
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
      await expect
        .poll(() => pathExists(path.join(artifacts, ".candidate.json")))
        .toBe(false);
      expect(await pathExists(previous)).toBe(false);
      expect(await pathExists(rejected)).toBe(false);
    } finally {
      await closeOffline(fixture);
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("rolls back a candidate when its renderer crashes before a frame", async () => {
    const fingerprint = "c".repeat(64);
    let artifacts;
    let rejected;
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
