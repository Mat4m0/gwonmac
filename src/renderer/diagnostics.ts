// Cheap renderer-side aggregation. Hot paths only mutate numbers; one bounded
// batch crosses IPC every two seconds.
//
// index.html loads this as a classic script, so the file carries no top-level
// import or export and names the contracts through type-only `import(…)`.
(function () {
  'use strict';

  type Metrics = import('../shared/diagnostics.js').RendererMetrics;
  type RendererEventName = import('../shared/diagnostics.js').RendererEventName;
  // Every RendererMetrics field that is a plain counter, derived from the
  // contract rather than listed again here: a second copy of forty field names
  // is a second source of truth, and this one would be free to drift.
  type CounterKey = {
    [K in keyof Metrics]: Metrics[K] extends number ? K : never;
  }[keyof Metrics];
  // Every metric family the histogram helper below can be asked for: a name P
  // for which the contract declares all four of `${P}Histogram`, `${P}TotalUs`,
  // `${P}MinUs` and `${P}MaxUs`. Derived for the same reason, and it is what
  // makes the computed field names safe — a family RendererMetrics does not
  // declare fails to compile at the call site instead of the recorder adding
  // to a field that is not there.
  type MetricFamily = {
    [K in keyof Metrics]: K extends `${infer P}Histogram`
      ? `${P}TotalUs` | `${P}MinUs` | `${P}MaxUs` extends keyof Metrics
        ? P
        : never
      : never;
  }[keyof Metrics];

  const histogramLimitsUs = [
    100, 250, 500, 1_000, 2_000, 4_000, 8_000, 12_000, 16_667,
    25_000, 33_333, 50_000, 100_000, 250_000, 500_000, 1_000_000,
    5_000_000, Number.MAX_SAFE_INTEGER,
  ];
  const rendererEventNames = new Set([
    'renderer.windowError',
    'renderer.unhandledRejection',
    'graphics.contextLost',
    'graphics.contextRestored',
    'graphics.presentationFailed',
    'client.glueLoadFailed',
    'filesystem.persistenceFailed',
    'audio.resumeFailed',
    'pointerLock.failed',
  ]);
  const histogram = (): number[] =>
    new Array<number>(histogramLimitsUs.length).fill(0);

  // Dynamic metric keys are confined to this histogram helper, and the family
  // it is asked for is checked rather than trusted. The counter is a separate
  // argument because it is not always `${prefix}Count` — bitmapOut and
  // bitmapPresent share swapCount, snapshot has snapshotReads — so the default
  // that used to compute it was right for five of the ten call sites and
  // unchecked for all ten. Naming it makes it the contract's key too.
  const observe = (
    target: Metrics,
    prefix: MetricFamily,
    valueUs: number,
    countKey: CounterKey,
    increment = true,
  ) => {
    const first = increment ? target[countKey] === 0 : target[countKey] === 1;
    if (increment) target[countKey]++;
    const total = `${prefix}TotalUs` as const;
    target[total] += valueUs;
    const min = `${prefix}MinUs` as const;
    target[min] = first ? valueUs : Math.min(target[min], valueUs);
    const max = `${prefix}MaxUs` as const;
    target[max] = Math.max(target[max], valueUs);
    const index = histogramLimitsUs.findIndex((limit) => valueUs <= limit);
    const bucket = index < 0 ? histogramLimitsUs.length - 1 : index;
    const buckets = target[`${prefix}Histogram` as const];
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
  };

  const fresh = (): Metrics => ({
    intervalMs: 0,
    visible: !document.hidden,
    focused: document.hasFocus(),
    rafCount: 0,
    rafTotalUs: 0,
    rafMinUs: 0,
    rafMaxUs: 0,
    rafOver33: 0,
    rafOver50: 0,
    swapCount: 0,
    swapTotalUs: 0,
    swapMinUs: 0,
    swapMaxUs: 0,
    presentationFailures: 0,
    submitIntervalCount: 0,
    submitIntervalTotalUs: 0,
    submitIntervalMinUs: 0,
    submitIntervalMaxUs: 0,
    visibleSubmitIntervalCount: 0,
    visibleSubmitIntervalTotalUs: 0,
    visibleSubmitIntervalMinUs: 0,
    visibleSubmitIntervalMaxUs: 0,
    hiddenSubmitIntervalCount: 0,
    hiddenSubmitIntervalTotalUs: 0,
    hiddenSubmitIntervalMinUs: 0,
    hiddenSubmitIntervalMaxUs: 0,
    bitmapOutTotalUs: 0,
    bitmapOutMinUs: 0,
    bitmapOutMaxUs: 0,
    bitmapPresentTotalUs: 0,
    bitmapPresentMinUs: 0,
    bitmapPresentMaxUs: 0,
    snapshotReads: 0,
    snapshotBytes: 0,
    snapshotTotalUs: 0,
    snapshotMinUs: 0,
    snapshotMaxUs: 0,
    memoryHits: 0,
    nativeHits: 0,
    coalesced: 0,
    glProgramQueryHits: 0,
    glProgramQueryMisses: 0,
    memoryCacheBytes: 0,
    memoryCacheChunks: 0,
    pendingChunks: 0,
    activeDemand: 0,
    activePrefetch: 0,
    queuedDemand: 0,
    queuedPrefetch: 0,
    cacheEvictions: 0,
    queuePromotions: 0,
    socketSendCalls: 0,
    socketPayloadBytes: 0,
    socketSourceBackingMaxBytes: 0,
    socketCompactBytes: 0,
    socketSyncTotalUs: 0,
    socketSyncMinUs: 0,
    socketSyncMaxUs: 0,
    socketSettles: 0,
    socketSettleTotalUs: 0,
    socketSettleMinUs: 0,
    socketSettleMaxUs: 0,
    inputToSubmitCount: 0,
    inputToSubmitTotalUs: 0,
    inputToSubmitMinUs: 0,
    inputToSubmitMaxUs: 0,
    droppedRecords: 0,
    rendererEvents: [],
    rafHistogram: histogram(),
    swapHistogram: histogram(),
    submitIntervalHistogram: histogram(),
    visibleSubmitIntervalHistogram: histogram(),
    hiddenSubmitIntervalHistogram: histogram(),
    bitmapOutHistogram: histogram(),
    bitmapPresentHistogram: histogram(),
    snapshotHistogram: histogram(),
    socketSyncHistogram: histogram(),
    socketSettleHistogram: histogram(),
    inputToSubmitHistogram: histogram(),
    socketSendEvents: [],
  });

  let metrics = fresh();
  let periodStarted = performance.now();
  let lastRaf = 0;
  let pendingInput = 0;
  let lastSubmitted = 0;
  let flushing = false;
  let overlayVisible = false;
  let clockSyncRunning = false;
  let clockOffsetUs = 0;
  let captureLevel = 0;
  let captureStartedAt = 0;
  let captureStatusTimer: number | null = null;
  let frameData: number[] = [];

  function updateCaptureStatus() {
    const status = document.getElementById('capture-status');
    const label = document.getElementById('capture-label');
    if (!status || !label || captureLevel === 0) return;
    const elapsed = Math.max(0, Math.floor((performance.now() - captureStartedAt) / 1000));
    const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const seconds = String(elapsed % 60).padStart(2, '0');
    label.textContent =
      `${captureLevel === 2 ? 'Chromium trace' : 'Performance capture'} · ` +
      `${minutes}:${seconds}`;
  }

  function announceCapture(message: string) {
    const output = document.getElementById('capture-announcement');
    if (output) output.textContent = message;
  }

  function traceMark(name: 'gw.snapshot.resolve' | 'gw.frame.submit') {
    if (captureLevel !== 2) return;
    performance.mark(name);
    performance.clearMarks(name);
  }

  function fingerprint(value: unknown) {
    const input = value instanceof Error
      ? `${value.name}:${value.stack || value.message}`
      : String(
        value &&
          typeof value === 'object' &&
          'name' in value
          ? value.name
          : typeof value,
      );
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function recordEvent(name: RendererEventName, value?: unknown) {
    if (!rendererEventNames.has(name)) {
      metrics.droppedRecords += 1;
      return;
    }
    if (metrics.rendererEvents.length >= 64) {
      metrics.droppedRecords += 1;
      return;
    }
    metrics.rendererEvents.push({
      timestampUs: performance.now() * 1000 + clockOffsetUs,
      name,
      ...(value === undefined ? {} : { fingerprint: fingerprint(value) }),
    });
  }

  async function synchronizeClock() {
    if (clockSyncRunning || !window.gwNative) return;
    clockSyncRunning = true;
    try {
      let best: { rttUs: number; offsetUs: number } | null = null;
      for (let i = 0; i < 7; i++) {
        const r0 = performance.now() * 1000;
        const { mainReceiveUs, mainSendUs } =
          await window.gwNative.diagnostics.clockSync(r0);
        const r3 = performance.now() * 1000;
        const rttUs = Math.max(0, (r3 - r0) - (mainSendUs - mainReceiveUs));
        const offsetUs = ((mainReceiveUs - r0) + (mainSendUs - r3)) / 2;
        if (!best || rttUs < best.rttUs) best = { rttUs, offsetUs };
      }
      if (best) {
        clockOffsetUs = best.offsetUs;
        await window.gwNative.diagnostics.recordClockOffset(best.offsetUs, best.rttUs);
        performance.mark('gw.clock.synchronized', { detail: best });
      }
    } catch {
      metrics.droppedRecords += 1;
    } finally {
      clockSyncRunning = false;
    }
  }

  function frame(now: number) {
    if (lastRaf) {
      const deltaUs = (now - lastRaf) * 1000;
      observe(metrics, 'raf', deltaUs, 'rafCount');
      if (deltaUs > 33333) metrics.rafOver33++;
      if (deltaUs > 50000) metrics.rafOver50++;
    }
    lastRaf = now;
    requestAnimationFrame(frame);
  }

  function markInput(event: Event) {
    if (event.isTrusted && !pendingInput) pendingInput = performance.now();
  }

  async function flush() {
    if (flushing || !window.gwNative) return;
    const now = performance.now();
    const batch = metrics;
    Object.assign(batch, window.gwSnapshotState?.() || {});
    const frames = frameData;
    metrics = fresh();
    frameData = [];
    batch.intervalMs = now - periodStarted;
    batch.visible = !document.hidden;
    batch.focused = document.hasFocus();
    periodStarted = now;
    flushing = true;
    try {
      await window.gwNative.diagnostics.recordRendererMetrics(batch);
      if (frames.length) {
        await window.gwNative.diagnostics.recordRendererFrames({ stride: 7, data: frames });
      }
      captureLevel = (await window.gwNative.diagnostics.current()).captureLevel;
    } catch {
      metrics.droppedRecords += 1;
      if (frameData.length + frames.length <= 20_000) frameData.unshift(...frames);
    } finally {
      flushing = false;
    }
  }

  // Annotated rather than inferred: the ambient RendererDiagnostics is the
  // contract every caller reads, so it also supplies these parameter types
  // instead of a second copy of them being written out here.
  const diagnostics: RendererDiagnostics = {
    async resetForCapture() {
      while (flushing) await new Promise((resolve) => setTimeout(resolve, 0));
      await flush();
      frameData = [];
      periodStarted = performance.now();
      lastRaf = 0;
      lastSubmitted = 0;
      pendingInput = 0;
    },
    captureStarted(level) {
      captureLevel = level === 2 ? 2 : 1;
      captureStartedAt = performance.now();
      const status = document.getElementById('capture-status');
      const marker = document.getElementById('capture-marker');
      if (status) status.hidden = false;
      if (marker) marker.hidden = true;
      updateCaptureStatus();
      if (captureStatusTimer !== null) {
        window.clearInterval(captureStatusTimer);
      }
      captureStatusTimer = setInterval(updateCaptureStatus, 1_000);
      announceCapture(
        captureLevel === 2
          ? 'Chromium trace started.'
          : 'Performance capture started.',
      );
    },
    captureStopped() {
      captureLevel = 0;
      frameData = [];
      if (captureStatusTimer !== null) {
        window.clearInterval(captureStatusTimer);
      }
      captureStatusTimer = null;
      const status = document.getElementById('capture-status');
      if (status) status.hidden = true;
      announceCapture('Capture stopped.');
    },
    problemMarked() {
      if (captureLevel === 0) return;
      const marker = document.getElementById('capture-marker');
      if (marker) marker.hidden = false;
      announceCapture('Performance problem marked.');
    },
    event: recordEvent,
    snapshot(durationUs, bytes, source) {
      observe(metrics, 'snapshot', durationUs, 'snapshotReads');
      metrics.snapshotBytes += bytes;
      if (source === 'memory') metrics.memoryHits++;
      else if (source === 'native') metrics.nativeHits++;
      traceMark('gw.snapshot.resolve');
    },
    cache(source) {
      if (source === 'memory') metrics.memoryHits++;
      else if (source === 'native') metrics.nativeHits++;
      else if (source === 'coalesced') metrics.coalesced++;
    },
    // Proves the GL program-state cache is engaged against the live client:
    // the glue is downloaded at runtime, so a renamed import would otherwise
    // look identical to "the fix stopped helping".
    glProgramQuery(hit) {
      if (hit) metrics.glProgramQueryHits++;
      else metrics.glProgramQueryMisses++;
    },
    scheduler(event) {
      if (event === 'eviction') metrics.cacheEvictions++;
      else if (event === 'promotion') metrics.queuePromotions++;
    },
    socketSend(
      started,
      syncUs,
      payloadBytes,
      sourceBackingBytes,
      compactBytes,
      pending,
    ) {
      metrics.socketSendCalls++;
      metrics.socketPayloadBytes = Math.min(
        Number.MAX_SAFE_INTEGER,
        metrics.socketPayloadBytes + payloadBytes,
      );
      metrics.socketSourceBackingMaxBytes = Math.max(
        metrics.socketSourceBackingMaxBytes,
        sourceBackingBytes,
      );
      metrics.socketCompactBytes = Math.min(
        Number.MAX_SAFE_INTEGER,
        metrics.socketCompactBytes + compactBytes,
      );
      observe(metrics, 'socketSync', syncUs, 'socketSendCalls', false);
      const timestampUs = started * 1000 + clockOffsetUs;
      void Promise.resolve(pending).then(
        () => settle(1),
        () => settle(0),
      );
      function settle(status: 0 | 1) {
        const durationUs = (performance.now() - started) * 1000;
        metrics.socketSettles++;
        observe(metrics, 'socketSettle', durationUs, 'socketSettles', false);
        if (metrics.socketSendEvents.length <= 7 * 255) {
          metrics.socketSendEvents.push(
            timestampUs,
            syncUs,
            durationUs,
            payloadBytes,
            sourceBackingBytes,
            compactBytes,
            status,
          );
        } else {
          metrics.droppedRecords++;
        }
      }
    },
    setVisible(visible) {
      overlayVisible = !!visible;
      const output = document.getElementById('diagnostics');
      if (output) output.style.display = overlayVisible ? 'block' : 'none';
    },
    swap(swapUs, bitmapOutUs, bitmapPresentUs, presented = true) {
      observe(metrics, 'swap', swapUs, 'swapCount');
      observe(metrics, 'bitmapOut', bitmapOutUs, 'swapCount', false);
      observe(metrics, 'bitmapPresent', bitmapPresentUs, 'swapCount', false);
      if (!presented) {
        metrics.presentationFailures++;
        return;
      }
      const submittedAt = performance.now();
      if (lastSubmitted) {
        const intervalUs = (submittedAt - lastSubmitted) * 1000;
        observe(metrics, 'submitInterval', intervalUs, 'submitIntervalCount');
        if (document.hidden) {
          observe(
            metrics,
            'hiddenSubmitInterval',
            intervalUs,
            'hiddenSubmitIntervalCount',
          );
        } else {
          observe(
            metrics,
            'visibleSubmitInterval',
            intervalUs,
            'visibleSubmitIntervalCount',
          );
        }
      }
      lastSubmitted = submittedAt;
      traceMark('gw.frame.submit');
      if (captureLevel > 0 && frameData.length <= 19_993) {
        const canvas = document.getElementById('canvas');
        const backing =
          canvas instanceof globalThis.HTMLCanvasElement ? canvas : null;
        frameData.push(
          submittedAt * 1000 + clockOffsetUs,
          swapUs,
          bitmapOutUs,
          bitmapPresentUs,
          backing?.width || 0,
          backing?.height || 0,
          document.hidden ? 0 : 1,
        );
      }
      if (pendingInput) {
        const durationUs = (submittedAt - pendingInput) * 1000;
        observe(metrics, 'inputToSubmit', durationUs, 'inputToSubmitCount');
        pendingInput = 0;
      }
    },
    flush,
  };
  window.gwDiagnostics = Object.freeze(diagnostics);

  for (const type of ['pointerdown', 'keydown']) {
    addEventListener(type, markInput, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    lastRaf = 0;
    lastSubmitted = 0;
    if (captureLevel > 0 && frameData.length <= 19_993) {
      frameData.push(
        performance.now() * 1000 + clockOffsetUs,
        0, 0, 0, 0, 0,
        0,
      );
    }
    if (!document.hidden) void synchronizeClock();
  });
  addEventListener('error', (event) => {
    recordEvent('renderer.windowError', event.error);
    void flush();
  });
  addEventListener('unhandledrejection', (event) => {
    recordEvent('renderer.unhandledRejection', event.reason);
    void flush();
  });
  void synchronizeClock();
  setInterval(() => void synchronizeClock(), 5 * 60 * 1000);
  requestAnimationFrame(frame);
  setInterval(() => void flush(), 2000);
  setInterval(async () => {
    if (!overlayVisible || !window.gwNative) return;
    try {
      const summary = await window.gwNative.diagnostics.current();
      const h = summary.histograms;
      const latest = summary.latest;
      const output = document.getElementById('diagnostics');
      if (!output) return;
      output.textContent = [
        `SUBMITTED  ${latest['renderer.submittedFps'] || 0} fps`,
        `FRAME P95  ${((h['renderer.submitInterval']?.p95Us || 0) / 1000).toFixed(1)} ms`,
        `RAF P95    ${((h['renderer.rafInterval']?.p95Us || 0) / 1000).toFixed(1)} ms`,
        `SWAP P95   ${((h['renderer.swap']?.p95Us || 0) / 1000).toFixed(2)} ms`,
        `READ P95   ${((h['snapshot.rendererRead']?.p95Us || 0) / 1000).toFixed(1)} ms`,
        `SOCKET P95 ${((h['socket.rendererSync']?.p95Us || 0) / 1000).toFixed(2)} ms`,
        `QUEUE      ${latest['snapshot.queuedDemand'] || 0} demand / ` +
          `${latest['snapshot.queuedPrefetch'] || 0} prefetch`,
        `CACHE      ${summary.counters['cache.memoryHits'] || 0} mem / ` +
          `${summary.counters['cache.nativeHits'] || 0} native`,
        `MAIN RSS   ${((Number(latest['main.rssBytes']) || 0) / 1048576).toFixed(0)} MB`,
        `LOOP P99   ${((Number(latest['main.eventLoopP99Us']) || 0) / 1000).toFixed(1)} ms`,
        `CAPTURE    L${summary.captureLevel}`,
      ].join('\n');
    } catch {
      // Overlay is disposable; recording continues if it cannot update.
    }
  }, 500);
})();
