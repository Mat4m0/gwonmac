import { mkdir, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  closeOffline,
  expect,
  launchOffline,
  test,
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

  test("connects the shipped renderer socket bridge to main", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(6112, "127.0.0.1", resolve);
    });
    const fixture = await launchOffline("gw-client-host-e2e-");
    try {
      await fixture.page.waitForFunction(() => {
        const game = window.Module as ModuleWithSocket | undefined;
        return typeof game?.socket?.connect === "function";
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
            state: "uncertified",
            enhancementActive: false,
            clientSha256: "a".repeat(64),
          },
          { nativeCursor: true, targetReadout: false },
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
      expect(after.dock.height).toBeGreaterThan(before.dock.height);
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
      const applicationWindow = await fixture.app.browserWindow(fixture.page);
      await applicationWindow.evaluate((win) => {
        win.webContents.emit(
          "render-process-gone",
          {} as never,
          { reason: "crashed", exitCode: 1 } as never,
        );
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
