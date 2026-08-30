import type { Page } from "playwright";

/** Collapse startup failures before they enter the character-probe artifact. */
export function closedCharacterProbeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Electron exited before connection")) return "app-exited-before-debugger";
  if (message === "Electron did not expose its debugging endpoint") return "debugger-timeout";
  if (message === "Electron exposed no browser context") return "browser-context-missing";
  if (message === "No Guild Wars account window opened within 30 minutes") {
    return "account-window-timeout";
  }
  if (message === "Enhancement live run requires exactly one open account window") {
    return "account-window-ambiguous";
  }
  if (/^[a-z][a-z0-9_]{0,63}$/u.test(message)) return `client-${message}`;
  return "runner-internal";
}

/**
 * Reduce the character probe's live result to its privacy-safe contract.
 * Passing the generic live projection is intentional: this boundary proves
 * that map/player/target diagnostics cannot reach stdout or failure artifacts.
 */
export function projectCharacterProbeLiveResult(
  result: Readonly<{
    scenario: string;
    supported: boolean;
    buildId: number | null;
    installation: number;
  }>,
  evidence: unknown,
  rendererErrorCount: number,
) {
  return {
    scenario: result.scenario,
    supported: result.supported,
    buildId: result.buildId,
    installation: result.installation,
    rendererErrorCount,
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * The whole live-run readout, projected inside the page in one round trip.
 *
 * @param cadence hook ticks counted over a measured window, which is the only
 *   figure the page cannot derive itself.
 * @param scenario the scenario that ran, echoed into the result.
 */
export function projectLiveResult(
  page: Page,
  cadence: { ticks: number; elapsedMs: number },
  scenario: string,
) {
  return page.evaluate(async ({ ticks, elapsedMs, scenario: name }) => {
    const state = window.gwCompanionState;
    const ready = state?.status === "ready" ? state : null;
    const runtime = window.gwCompanionRuntime;
    const diagnostics = await window.gwNative.diagnostics.current();
    const clientSession = await window.gwNative.client.session();
    const settings = await window.gwNative.settings.get();
    const storage = await window.navigator.storage.estimate();
    const p95 = (metric: string) =>
      diagnostics.histograms[metric]?.p95Us ?? 0;
    // The developer runtime is a frozen scalar projection. Game memory,
    // allocator pointers, the hook table and mutable counters remain private
    // to the installer closure.
    const numeric = (value: unknown) => typeof value === "number" ? value : 0;
    const mib = (bytes: number) => Number((bytes / (1024 ** 2)).toFixed(1));
    const latestMib = (metric: string) =>
      mib(Number(diagnostics.latest[metric]) || 0);
    const milestoneMs = (metric: string) =>
      Number(((Number(diagnostics.latest[metric]) || 0) / 1_000).toFixed(1));
    return {
      scenario: name,
      appVersion: clientSession.appVersion,
      supported: runtime?.status === "installed",
      buildId: typeof runtime?.buildId === "number" ? runtime.buildId : null,
      companionAbi: numeric(runtime?.companionAbi),
      kernelSha256:
        typeof runtime?.kernelSha256 === "string" ? runtime.kernelSha256 : null,
      hookCount: numeric(ready?.tickCount),
      hookHertz: Number(((ticks * 1_000) / elapsedMs).toFixed(2)),
      sequence: numeric(ready?.sequence),
      map: ready
        ? {
            id: ready.mapId,
            instance: ready.instanceName,
            player: { id: ready.playerId, x: ready.playerX, y: ready.playerY },
          }
        : null,
      target: ready?.targetValid
        ? {
            id: ready.targetId,
            type: ready.targetKind,
            x: ready.targetX,
            y: ready.targetY,
            distance: ready.distance,
            range: ready.rangeName,
          }
        : null,
      renderUs: Number(numeric(runtime?.lastRenderUs).toFixed(2)),
      renderP95Us: Number(numeric(runtime?.renderP95Us).toFixed(2)),
      snapshotReads: numeric(runtime?.snapshotReads),
      rejectedSnapshots: numeric(runtime?.rejectedSnapshots),
      lifecycle: window.gwAutomation?.read() ?? null,
      installation: numeric(runtime?.installation),
      host: {
        renderScale: settings.renderScale,
        wasmMemoryMiB: mib(numeric(runtime?.wasmMemoryBytes)),
        browserStorageMiB: mib(storage.usage ?? 0),
        rendererCacheMiB: latestMib("renderer.memoryCacheBytes"),
        mainRssMiB: latestMib("main.rssBytes"),
        mainPeakRssMiB: latestMib("main.peakRssBytes"),
        mainPeakArrayBuffersMiB: latestMib("main.peakArrayBuffersBytes"),
        rendererRssMiB: latestMib("process.tab.rssBytes"),
        gpuRssMiB: latestMib("process.gpu.rssBytes"),
        mainEventLoopP99Us:
          Number(diagnostics.latest["main.eventLoopP99Us"]) || 0,
        submittedFps:
          Number(diagnostics.latest["renderer.submittedFps"]) || 0,
        snapshotReads: diagnostics.counters["snapshot.reads"] ?? 0,
        snapshotMiB: mib(diagnostics.counters["snapshot.bytes"] ?? 0),
        socketSends: diagnostics.counters["socket.rendererSendCalls"] ?? 0,
        socketKiB: Number(
          ((diagnostics.counters["socket.rendererPayloadBytes"] ?? 0) / 1_024)
            .toFixed(1),
        ),
        p95Us: {
          frameSubmit: p95("renderer.visibleSubmitInterval"),
          swap: p95("renderer.swap"),
          bitmapOut: p95("renderer.bitmapOut"),
          bitmapPresent: p95("renderer.bitmapPresent"),
          snapshotRead: p95("snapshot.rendererRead"),
          socketSync: p95("socket.rendererSync"),
          socketSettle: p95("socket.rendererSettle"),
          socketWrite: p95("socket.writeCallback"),
        },
        milestonesMs: {
          wasmInstantiate: Number(
            (
              (
                (Number(
                  diagnostics.latest["milestone.wasm.instantiate.endUs"],
                ) || 0)
                - (
                  Number(
                    diagnostics.latest["milestone.wasm.instantiate.beginUs"],
                  ) || 0
                )
              ) / 1_000
            ).toFixed(1),
          ),
          firstFrame: milestoneMs("milestone.frame.firstSubmitUs"),
          startupComplete: milestoneMs("milestone.startup.completeUs"),
        },
      },
    };
  }, { ...cadence, scenario });
}
