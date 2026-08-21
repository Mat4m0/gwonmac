import { expect, test } from "@playwright/test";
import path from "node:path";
import { closeOffline, launchOffline, root } from "./fixtures.mjs";

test("keeps renderer capture evidence with its owning window", async () => {
  const fixture = await launchOffline("gw-capture-owner-e2e-");
  try {
    const result = await fixture.app.evaluate(async (_electron, modulePath) => {
      const load = process
        .getBuiltinModule("node:module")
        .createRequire(modulePath);
      const { recorder } = load(
        modulePath.replace(/diagnostics\.js$/u, "diagnostics/recorder.js"),
      );
      const renderer = load(
        modulePath.replace(/diagnostics\.js$/u, "diagnostics/renderer.js"),
      );
      const ownerId = 101;
      const peerId = 202;
      const graphics = (name: string, width: number) => ({
        renderer: name,
        vendor: "vendor",
        version: "version",
        shadingLanguageVersion: "shader",
        hardwareAcceleration: true,
        jspi: true,
        canvasWidth: width,
        canvasHeight: 720,
        offscreenWidth: width,
        offscreenHeight: 720,
        drawingBufferWidth: width,
        drawingBufferHeight: 720,
        devicePixelRatio: 1,
        renderScale: 1,
        antialias: true,
        samples: 4,
      });

      await recorder.beginCapture(ownerId);
      renderer.recordGraphics(ownerId, graphics("owner-gpu", 1280));
      renderer.recordGraphics(peerId, graphics("peer-gpu", 1920));
      renderer.recordClockOffset(ownerId, 111, 11);
      renderer.recordClockOffset(peerId, 222, 22);
      recorder.count("test.appGlobal", 1);
      recorder.count("test.owner", 1, ownerId);
      recorder.count("test.peer", 1, peerId);
      recorder.record({ k: "electron.ready" });
      recorder.record({ k: "window.focused" }, {}, ownerId);
      recorder.record({ k: "window.blurred" }, {}, peerId);
      await recorder.appendFrames(
        { stride: 7, data: [1, 2, 3, 4, 5, 6, 7] },
        peerId,
      );
      const peerCreatedFrames = recorder.framePath() !== null;
      await recorder.appendFrames(
        { stride: 7, data: [8, 9, 10, 11, 12, 13, 14] },
        ownerId,
      );
      recorder.endCapture(1, "manual");
      const capture = recorder.captureResult();
      renderer.recordGraphics(ownerId, graphics("replacement-gpu", 1440));
      const captureGraphicsAfterReplacement =
        recorder.captureResult(ownerId)?.graphics?.renderer;
      const liveGraphicsAfterReplacement =
        renderer.graphicsSnapshot(ownerId)?.renderer;
      renderer.recordClockOffset(ownerId, 10_000_000, 10);
      renderer.resetRendererDiagnostics(ownerId);
      const milestoneBefore = recorder.timestampUs();
      renderer.recordRendererMilestone(ownerId, "renderer.loaded", 1);
      const milestoneAfter = recorder.timestampUs();
      const replacementMilestone = recorder.summaryForOwner(ownerId, 0)
        .latest["milestone.renderer.loadedUs"];
      const peerGraphicsBeforeForget =
        renderer.graphicsSnapshot(peerId)?.renderer;
      renderer.forgetRendererDiagnosticsOwner(peerId);
      const forgottenPeer = recorder.summaryForOwner(peerId, 0);
      const peerEvents = JSON.parse(
        `[${(await recorder.exportedEvents(peerId)).text.replaceAll("\n", ",")}]`,
      ).map((event: { name: string }) => event.name);
      return {
        counters: capture?.summary.counters,
        latest: capture?.summary.latest,
        peerCreatedFrames,
        ownerCreatedFrames: recorder.framePath() !== null,
        peerGraphicsBeforeForget,
        peerCapture: recorder.captureResult(peerId),
        peerFrames: recorder.framePath(peerId),
        peerEvents,
        captureGraphicsAfterReplacement,
        liveGraphicsAfterReplacement,
        milestoneBefore,
        milestoneAfter,
        replacementMilestone,
        forgottenPeerCounters: forgottenPeer.counters,
        forgottenPeerGraphics: renderer.graphicsSnapshot(peerId),
      };
    }, path.join(root, "build/main/diagnostics.js"));

    expect(result).toMatchObject({
      counters: { "test.appGlobal": 1, "test.owner": 1 },
      latest: {
        "graphics.renderer": "owner-gpu",
        "graphics.canvasWidth": 1280,
        "renderer.clockOffsetUs": 111,
      },
      peerCreatedFrames: false,
      ownerCreatedFrames: true,
      peerGraphicsBeforeForget: "peer-gpu",
      peerCapture: null,
      peerFrames: null,
      captureGraphicsAfterReplacement: "owner-gpu",
      liveGraphicsAfterReplacement: "replacement-gpu",
      forgottenPeerGraphics: null,
    });
    expect(result.forgottenPeerCounters?.["test.peer"]).toBeUndefined();
    expect(result.counters?.["test.peer"]).toBeUndefined();
    expect(result.peerEvents).toContain("electron.ready");
    expect(result.peerEvents).toContain("window.blurred");
    expect(result.peerEvents).not.toContain("window.focused");
    expect(result.replacementMilestone).toBeGreaterThanOrEqual(
      result.milestoneBefore,
    );
    expect(result.replacementMilestone).toBeLessThanOrEqual(
      result.milestoneAfter,
    );
  } finally {
    await closeOffline(fixture);
  }
});

test("only the owner observes a capture and Level 2 refuses shared tracing", async () => {
  const fixture = await launchOffline("gw-capture-window-owner-e2e-");
  try {
    const result = await fixture.app.evaluate(
      async ({ BrowserWindow }, modulePath) => {
        const load = process
          .getBuiltinModule("node:module")
          .createRequire(modulePath);
        const diagnostics = load(modulePath);
        const { windowRegistry } = load(
          modulePath.replace(/diagnostics\.js$/u, "window-registry.js"),
        );
        const owner = BrowserWindow.getAllWindows().find((win) =>
          windowRegistry.contextForWebContents(win.webContents.id)?.role ===
          "game"
        );
        if (!owner) throw new Error("game window is unavailable");
        const peer = new BrowserWindow({ show: false });
        windowRegistry.register(peer, {
          mode: "multi",
          role: "game",
          profileId: "diagnostics-peer",
        }, 202);
        try {
          await diagnostics.startDiagnosticCapture(peer, 1);
          const ownerLevel = diagnostics.diagnosticSummary(owner).captureLevel;
          const peerLevel = diagnostics.diagnosticSummary(peer).captureLevel;
          const span = diagnostics.startSnapshotReadSpan(
            { offsetBytes: 0, requestedBytes: 16, priority: "demand" },
            202,
          );
          span.end({ returnedBytes: 16, status: 206, code: null });
          await diagnostics.stopDiagnosticCapture("shutdown");
          const { recorder } = load(
            modulePath.replace(/diagnostics\.js$/u, "diagnostics/recorder.js"),
          );
          const captureEvents = JSON.parse(
            `[${(await recorder.exportedEvents(202)).text.replaceAll("\n", ",")}]`,
          ).map((event: { name: string }) => event.name);
          let levelTwoError = "";
          try {
            await diagnostics.startDiagnosticCapture(owner, 2);
          } catch (error) {
            levelTwoError =
              error instanceof Error ? error.message : String(error);
          }
          return {
            ownerLevel,
            peerLevel,
            ownerIdDiffersFromWebContents: peer.webContents.id !== 202,
            captureEvents,
            levelTwoError,
          };
        } finally {
          await diagnostics.stopDiagnosticCapture("shutdown");
          windowRegistry.unregister(peer);
          peer.destroy();
        }
      },
      path.join(root, "build/main/diagnostics.js"),
    );

    expect(result).toEqual({
      ownerLevel: 0,
      peerLevel: 1,
      ownerIdDiffersFromWebContents: true,
      captureEvents: expect.arrayContaining([
        "snapshot.read.begin",
        "snapshot.read.end",
      ]),
      levelTwoError: "Chromium tracing requires exactly one open game window",
    });
  } finally {
    await closeOffline(fixture);
  }
});
