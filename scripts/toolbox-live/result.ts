import type { Page } from "playwright";

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
    const state = window.gwToolboxState;
    const runtime = window.gwToolboxRuntime;
    const diagnostics = await window.gwNative.diagnostics.current();
    const settings = await window.gwNative.settings.get();
    const storage = await window.navigator.storage.estimate();
    const p95 = (metric: string) =>
      diagnostics.histograms[metric]?.p95Us ?? 0;
    // `window.gwToolboxRuntime` is an open record: the renderer publishes it
    // for observation and nothing constrains a field's type at this boundary
    // (src/renderer/gw-native.d.ts). So every number below is narrowed where
    // it is read. A field the renderer renames then reaches the report as the
    // same 0 the rest of this projection already uses for "not measured",
    // rather than as `undefined` or `NaN` in the JSON.
    const numeric = (value: unknown) => typeof value === "number" ? value : 0;
    const samples = runtime?.renderSamples;
    const renderSamples = (Array.isArray(samples) ? samples : [])
      .map(numeric)
      .sort((left, right) => left - right);
    const p95Index = Math.max(0, Math.ceil(renderSamples.length * 0.95) - 1);
    const mib = (bytes: number) => Number((bytes / (1024 ** 2)).toFixed(1));
    const latestMib = (metric: string) =>
      mib(Number(diagnostics.latest[metric]) || 0);
    const milestoneMs = (metric: string) =>
      Number(((Number(diagnostics.latest[metric]) || 0) / 1_000).toFixed(1));
    const memory = runtime?.memory;
    return {
      scenario: name,
      supported: runtime?.status === "installed",
      buildId: typeof runtime?.buildId === "number" ? runtime.buildId : null,
      hookCount: numeric(state?.tickCount),
      hookHertz: Number(((ticks * 1_000) / elapsedMs).toFixed(2)),
      sequence: numeric(state?.sequence),
      map: state?.status === "ready"
        ? {
            id: state.mapId,
            instance: state.instanceName,
            player: { id: state.playerId, x: state.playerX, y: state.playerY },
          }
        : null,
      target: state?.targetValid
        ? {
            id: state.targetId,
            type: state.targetKind,
            x: state.targetX,
            y: state.targetY,
            distance: state.distance,
            range: state.rangeName,
          }
        : null,
      renderUs: Number(numeric(runtime?.lastRenderUs).toFixed(2)),
      renderP95Us: Number((renderSamples[p95Index] ?? 0).toFixed(2)),
      snapshotReads: numeric(runtime?.snapshotReads),
      rejectedSnapshots: numeric(runtime?.rejectedSnapshots),
      lifecycle: window.gwAutomation?.read() ?? null,
      installation: numeric(runtime?.installation),
      host: {
        renderScale: settings.renderScale,
        wasmMemoryMiB: mib(
          memory instanceof WebAssembly.Memory ? memory.buffer.byteLength : 0,
        ),
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
