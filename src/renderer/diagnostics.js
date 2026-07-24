// Cheap renderer-side aggregation. Hot paths only mutate numbers; one bounded
// batch crosses IPC every two seconds.
(function () {
  'use strict';

  const histogramLimitsUs = [
    100, 250, 500, 1_000, 2_000, 4_000, 8_000, 12_000, 16_667,
    25_000, 33_333, 50_000, 100_000, 250_000, 500_000, 1_000_000,
    5_000_000, Number.MAX_SAFE_INTEGER,
  ];
  /** @type {Set<string>} */
  const rendererEventNames = new Set([
    'renderer.windowError',
    'renderer.unhandledRejection',
    'graphics.contextLost',
    'graphics.contextRestored',
    'client.glueLoadFailed',
    'filesystem.persistenceFailed',
    'audio.resumeFailed',
    'pointerLock.failed',
  ]);
  /** @returns {number[]} */
  const histogram = () => Array(histogramLimitsUs.length).fill(0);
  /**
   * Dynamic metric keys are confined to this histogram helper; the complete
   * object returned by fresh() is checked against RendererMetrics below.
   * @param {Record<string, any>} target
   * @param {string} prefix
   * @param {number} valueUs
   * @param {string} [countKey]
   * @param {boolean} [increment]
   */
  const observe = (
    target,
    prefix,
    valueUs,
    countKey = `${prefix}Count`,
    increment = true,
  ) => {
    const first = increment ? target[countKey] === 0 : target[countKey] === 1;
    if (increment) target[countKey]++;
    target[`${prefix}TotalUs`] += valueUs;
    const min = `${prefix}MinUs`;
    target[min] = first ? valueUs : Math.min(target[min], valueUs);
    target[`${prefix}MaxUs`] = Math.max(target[`${prefix}MaxUs`], valueUs);
    const index = histogramLimitsUs.findIndex((limit) => valueUs <= limit);
    target[`${prefix}Histogram`][index < 0 ? histogramLimitsUs.length - 1 : index]++;
  };

  /** @returns {import('../shared/diagnostics.js').RendererMetrics} */
  const fresh = () => ({
    intervalMs: 0,
    visible: !document.hidden,
    rafCount: 0,
    rafTotalUs: 0,
    rafMinUs: 0,
    rafMaxUs: 0,
    rafOver16: 0,
    rafOver33: 0,
    rafOver50: 0,
    swapCount: 0,
    swapTotalUs: 0,
    swapMinUs: 0,
    swapMaxUs: 0,
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
    socketSourceBackingBytes: 0,
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
  /** @type {number | null} */
  let captureStatusTimer = null;
  /** @type {number[]} */
  let frameData = [];

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

  /** @param {string} message */
  function announceCapture(message) {
    const output = document.getElementById('capture-announcement');
    if (output) output.textContent = message;
  }

  /** @param {unknown} value */
  function fingerprint(value) {
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

  /**
   * @param {import('../shared/diagnostics.js').RendererEventName} name
   * @param {unknown} [value]
   */
  function recordEvent(name, value) {
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
      let best = null;
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

  /** @param {number} now */
  function frame(now) {
    if (lastRaf) {
      const deltaUs = (now - lastRaf) * 1000;
      observe(metrics, 'raf', deltaUs);
      if (deltaUs > 16667) metrics.rafOver16++;
      if (deltaUs > 33333) metrics.rafOver33++;
      if (deltaUs > 50000) metrics.rafOver50++;
    }
    lastRaf = now;
    requestAnimationFrame(frame);
  }

  /** @param {Event} event */
  function markInput(event) {
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

  window.gwDiagnostics = Object.freeze({
    async resetForCapture() {
      while (flushing) await new Promise((resolve) => setTimeout(resolve, 0));
      await flush();
      frameData = [];
      periodStarted = performance.now();
      lastRaf = 0;
      lastSubmitted = 0;
      pendingInput = 0;
    },
    /** @param {1 | 2} level */
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
    /** @param {string} name @param {unknown} [fields] */
    mark(name, fields) {
      try {
        performance.mark(`gw.${name}`, { detail: fields });
      } catch {
        performance.mark(`gw.${name}`);
      }
    },
    event: recordEvent,
    /**
     * @param {number} durationUs
     * @param {number} bytes
     * @param {'memory' | 'native'} source
     */
    snapshot(durationUs, bytes, source) {
      observe(metrics, 'snapshot', durationUs, 'snapshotReads');
      metrics.snapshotBytes += bytes;
      if (source === 'memory') metrics.memoryHits++;
      else if (source === 'native') metrics.nativeHits++;
    },
    /** @param {'memory' | 'native' | 'coalesced'} source */
    cache(source) {
      if (source === 'memory') metrics.memoryHits++;
      else if (source === 'native') metrics.nativeHits++;
      else if (source === 'coalesced') metrics.coalesced++;
    },
    /** @param {'eviction' | 'promotion'} event */
    scheduler(event) {
      if (event === 'eviction') metrics.cacheEvictions++;
      else if (event === 'promotion') metrics.queuePromotions++;
    },
    /**
     * @param {number} started
     * @param {number} syncUs
     * @param {number} payloadBytes
     * @param {number} sourceBackingBytes
     * @param {number} compactBytes
     * @param {PromiseLike<unknown>} pending
     */
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
      metrics.socketSourceBackingBytes = Math.min(
        Number.MAX_SAFE_INTEGER,
        metrics.socketSourceBackingBytes + sourceBackingBytes,
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
      /** @param {0 | 1} status */
      function settle(status) {
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
    /** @param {boolean} visible */
    setVisible(visible) {
      overlayVisible = !!visible;
      const output = document.getElementById('diagnostics');
      if (output) output.style.display = overlayVisible ? 'block' : 'none';
    },
    /**
     * @param {number} swapUs
     * @param {number} bitmapOutUs
     * @param {number} bitmapPresentUs
     * @param {boolean} [presented]
     */
    swap(swapUs, bitmapOutUs, bitmapPresentUs, presented = true) {
      if (!presented) return;
      const submittedAt = performance.now();
      if (lastSubmitted) {
        const intervalUs = (submittedAt - lastSubmitted) * 1000;
        observe(metrics, 'submitInterval', intervalUs);
        observe(
          metrics,
          document.hidden ? 'hiddenSubmitInterval' : 'visibleSubmitInterval',
          intervalUs,
        );
      }
      lastSubmitted = submittedAt;
      observe(metrics, 'swap', swapUs);
      observe(metrics, 'bitmapOut', bitmapOutUs, 'swapCount', false);
      observe(metrics, 'bitmapPresent', bitmapPresentUs, 'swapCount', false);
      if (captureLevel > 0 && frameData.length <= 19_993) {
        const canvas =
          /** @type {HTMLCanvasElement | null} */ (
            document.getElementById('canvas')
          );
        frameData.push(
          submittedAt * 1000 + clockOffsetUs,
          swapUs,
          bitmapOutUs,
          bitmapPresentUs,
          canvas?.width || 0,
          canvas?.height || 0,
          document.hidden ? 0 : 1,
        );
      }
      if (pendingInput) {
        const durationUs = (submittedAt - pendingInput) * 1000;
        observe(metrics, 'inputToSubmit', durationUs);
        pendingInput = 0;
      }
    },
    flush,
  });

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
  document.getElementById('canvas')?.addEventListener('webglcontextlost', () => {
    performance.mark('gw.graphics.context-lost');
    recordEvent('graphics.contextLost');
    void flush();
  });
  document.getElementById('canvas')?.addEventListener('webglcontextrestored', () => {
    performance.mark('gw.graphics.context-restored');
    recordEvent('graphics.contextRestored');
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
