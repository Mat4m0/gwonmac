import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
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

  test("promotes a candidate only after the first submitted frame", async () => {
    const fingerprint = "a".repeat(64);
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
      expect(await pathExists(previous)).toBe(true);
      await fixture.page.evaluate(() =>
        window.gwNative.diagnostics.recordRendererMilestone(
          "frame.firstSubmit",
          performance.now() * 1_000,
        ),
      );
      await expect
        .poll(() => pathExists(path.join(artifacts, ".candidate.json")))
        .toBe(false);
      expect(await pathExists(previous)).toBe(false);
      expect(await pathExists(rejected)).toBe(false);
    } finally {
      await closeOffline(fixture);
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
            clientFingerprint: "d".repeat(64),
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
