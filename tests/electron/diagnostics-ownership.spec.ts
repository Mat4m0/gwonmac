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

      recorder.record({ k: "window.shown" }, {}, ownerId);
      recorder.record({ k: "window.hidden" }, {}, peerId);
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
      recorder.record({ k: "window.resized" }, {}, ownerId);
      recorder.record({ k: "window.moved" }, {}, peerId);
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
      const ownerEvents = JSON.parse(
        `[${(await recorder.exportedEvents(ownerId)).text.replaceAll("\n", ",")}]`,
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
        ownerEvents,
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
    expect(result.peerEvents).toContain("window.hidden");
    expect(result.peerEvents).toContain("window.moved");
    expect(result.peerEvents).not.toContain("window.focused");
    expect(result.peerEvents).not.toContain("window.shown");
    expect(result.peerEvents).not.toContain("window.resized");
    expect(result.ownerEvents).toContain("electron.ready");
    expect(result.ownerEvents).toContain("window.focused");
    expect(result.ownerEvents).toContain("window.shown");
    expect(result.ownerEvents).toContain("window.resized");
    expect(result.ownerEvents).not.toContain("window.blurred");
    expect(result.ownerEvents).not.toContain("window.hidden");
    expect(result.ownerEvents).not.toContain("window.moved");
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
          await peer.loadURL("data:text/html,peer");
          await diagnostics.startDiagnosticCapture(peer, 1);
          const { exportDiagnosticsReport } = load(
            modulePath.replace(/diagnostics\.js$/u, "diagnostics-export.js"),
          );
          await exportDiagnosticsReport(peer, async () => "saved");
          const samplers = load(
            modulePath.replace(/diagnostics\.js$/u, "diagnostics/samplers.js"),
          );
          for (let index = 0; index < 5; index += 1) {
            samplers.sampleProcesses();
          }
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
          const captureRecords = JSON.parse(
            `[${(await recorder.exportedEvents(202)).text.replaceAll("\n", ",")}]`,
          ) as Array<{ name: string; fields: { pid?: number } }>;
          const ownerId = windowRegistry.diagnosticOwnerForWindow(owner);
          if (ownerId === null) throw new Error("owner diagnostics unavailable");
          const ownerRecords = JSON.parse(
            `[${(await recorder.exportedEvents(ownerId)).text.replaceAll("\n", ",")}]`,
          ) as Array<{ name: string; fields: { pid?: number } }>;
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
            captureEvents: captureRecords.map((event) => event.name),
            ownerEvents: ownerRecords.map((event) => event.name),
            captureChromiumPids: captureRecords
              .filter((event) => event.name === "process.chromium")
              .map((event) => event.fields.pid),
            ownerChromiumPids: ownerRecords
              .filter((event) => event.name === "process.chromium")
              .map((event) => event.fields.pid),
            ownerPid: owner.webContents.getOSProcessId(),
            peerPid: peer.webContents.getOSProcessId(),
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

    expect(result).toMatchObject({
      ownerLevel: 0,
      peerLevel: 1,
      ownerIdDiffersFromWebContents: true,
      captureEvents: expect.arrayContaining([
        "diagnostics.exported",
        "snapshot.read.begin",
        "snapshot.read.end",
      ]),
      ownerEvents: expect.not.arrayContaining(["diagnostics.exported"]),
      levelTwoError: "Chromium tracing requires exactly one open game window",
    });
    expect(result.captureEvents).toContain("process.main");
    expect(result.ownerEvents).toContain("process.main");
    expect(result.captureChromiumPids).toContain(result.peerPid);
    expect(result.captureChromiumPids).not.toContain(result.ownerPid);
    expect(result.ownerChromiumPids).toContain(result.ownerPid);
    expect(result.ownerChromiumPids).not.toContain(result.peerPid);
  } finally {
    await closeOffline(fixture);
  }
});

test("keeps exports globally serialized and reports contention to its owner", async () => {
  const fixture = await launchOffline("gw-diagnostics-export-contention-e2e-");
  try {
    const result = await fixture.app.evaluate(
      async ({ BrowserWindow, dialog }, modulePath) => {
        const load = process
          .getBuiltinModule("node:module")
          .createRequire(modulePath);
        const { exportDiagnosticsReport } = load(modulePath);
        const { recorder } = load(
          modulePath.replace(/diagnostics-export\.js$/u, "diagnostics/recorder.js"),
        );
        const { windowRegistry } = load(
          modulePath.replace(/diagnostics-export\.js$/u, "window-registry.js"),
        );
        const first = new BrowserWindow({ show: false, title: "First owner" });
        const peer = new BrowserWindow({ show: false, title: "Peer owner" });
        windowRegistry.register(first, {
          mode: "multi",
          role: "game",
          profileId: "export-first",
        }, 301);
        windowRegistry.register(peer, {
          mode: "multi",
          role: "game",
          profileId: "export-peer",
        }, 302);

        const originalShowMessageBox = dialog.showMessageBox;
        const messages: Array<{
          parent: string | null;
          message: string;
          detail: string | undefined;
        }> = [];
        Object.defineProperty(dialog, "showMessageBox", {
          configurable: true,
          value: async (parent: unknown, options: {
            message: string;
            detail?: string;
          }) => {
            messages.push({
              parent: parent instanceof BrowserWindow ? parent.getTitle() : null,
              message: options.message,
              detail: options.detail,
            });
            return { response: 0, checkboxChecked: false };
          },
        });

        let releaseFirst: () => void = () => undefined;
        let markFirstEntered: () => void = () => undefined;
        const firstEntered = new Promise<void>((resolve) => {
          markFirstEntered = resolve;
        });
        const firstReleased = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        let firstCalls = 0;
        let peerCalls = 0;
        try {
          const exportingFirst = exportDiagnosticsReport(first, async () => {
            firstCalls += 1;
            markFirstEntered();
            await firstReleased;
            return "first.zip";
          });
          await firstEntered;
          // Ownership is captured before the work starts. Its completion remains
          // attributable even when the initiating window closes in the meantime.
          windowRegistry.unregister(first);
          first.destroy();
          await exportDiagnosticsReport(peer, async () => {
            peerCalls += 1;
            return "must-not-run.zip";
          });
          releaseFirst();
          await exportingFirst;
          await exportDiagnosticsReport(peer, async () => {
            peerCalls += 1;
            return "peer.zip";
          });
          await exportDiagnosticsReport(peer, async () => {
            peerCalls += 1;
            throw new Error("owned export failure");
          });

          const eventOwners = async (ownerId: number, name: string) =>
            (await recorder.exportedEvents(ownerId)).text
              .split("\n")
              .filter(Boolean)
              .map((line: string) => JSON.parse(line) as {
                name: string;
                ownerId?: number;
              })
              .filter((event: { name: string }) => event.name === name)
              .map((event: { ownerId?: number }) => event.ownerId);
          return {
            firstCalls,
            peerCalls,
            messages,
            firstExportOwners: await eventOwners(301, "diagnostics.exported"),
            peerExportOwners: await eventOwners(302, "diagnostics.exported"),
            peerFailureOwners: await eventOwners(302, "diagnostics.exportFailed"),
          };
        } finally {
          releaseFirst();
          Object.defineProperty(dialog, "showMessageBox", {
            configurable: true,
            value: originalShowMessageBox,
          });
          windowRegistry.unregister(first);
          windowRegistry.unregister(peer);
          if (!first.isDestroyed()) first.destroy();
          if (!peer.isDestroyed()) peer.destroy();
        }
      },
      path.join(root, "build/main/diagnostics-export.js"),
    );

    expect(result).toEqual({
      firstCalls: 1,
      peerCalls: 2,
      messages: [
        {
          parent: "Peer owner",
          message: "Another diagnostics export is in progress",
          detail: "Wait for it to finish, then try again.",
        },
        {
          parent: "Peer owner",
          message: "Diagnostics export failed",
          detail: "owned export failure",
        },
      ],
      firstExportOwners: [301],
      peerExportOwners: [302],
      peerFailureOwners: [302],
    });
  } finally {
    await closeOffline(fixture);
  }
});
