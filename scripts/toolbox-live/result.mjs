export function projectLiveResult(page, cadence, scenario) {
  return page.evaluate(async ({ ticks, elapsedMs, scenario: name }) => {
    const state = window.gwToolboxState;
    const runtime = window.gwToolboxRuntime;
    const diagnostics = await window.gwNative.diagnostics.current();
    const settings = await window.gwNative.settings.get();
    const storage = await window.navigator.storage.estimate();
    const p95 = (metric) => diagnostics.histograms[metric]?.p95Us ?? 0;
    const renderSamples = [...(runtime?.renderSamples ?? [])]
      .sort((left, right) => left - right);
    const p95Index = Math.max(0, Math.ceil(renderSamples.length * 0.95) - 1);
    const mib = (bytes) => Number((bytes / (1024 ** 2)).toFixed(1));
    const latestMib = (metric) =>
      mib(Number(diagnostics.latest[metric]) || 0);
    const milestoneMs = (metric) =>
      Number(((Number(diagnostics.latest[metric]) || 0) / 1_000).toFixed(1));
    return {
      scenario: name,
      supported: runtime?.status === "installed",
      buildId: runtime?.buildId ?? null,
      hookCount: state?.tickCount ?? 0,
      hookHertz: Number(((ticks * 1_000) / elapsedMs).toFixed(2)),
      sequence: state?.sequence ?? 0,
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
      renderUs: Number((runtime?.lastRenderUs ?? 0).toFixed(2)),
      renderP95Us: Number((renderSamples[p95Index] ?? 0).toFixed(2)),
      snapshotReads: runtime?.snapshotReads ?? 0,
      rejectedSnapshots: runtime?.rejectedSnapshots ?? 0,
      lifecycle: window.gwAutomation?.read() ?? null,
      installation: runtime?.installation ?? 0,
      host: {
        renderScale: settings.renderScale,
        wasmMemoryMiB: mib(runtime?.memory?.buffer?.byteLength ?? 0),
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
