/**
 * The memory debug panel: a live reading of the client's WASM heap, and the
 * triggers that let one person answer questions about it in minutes instead of
 * hours of play.
 *
 * It owns the sample ring, the readout, the sparkline and its own buttons. It
 * owns no thresholds, no notice copy and no escalation state — those belong to
 * the harness and to `failure-messages.ts`, and this module reaches them only
 * through the callbacks it is constructed with. A simulated notice therefore
 * renders the sentence the player would really read; a panel with its own copy
 * would be rehearsing the wrong words.
 *
 * Deliberately not the diagnostics overlay: that one is a shipped, closed-schema
 * performance readout bound to a player setting, drawn from the main process's
 * summary. The heap curve is renderer-local and these controls are destructive,
 * so they get their own surface and their own gate.
 */

/**
 * A cap of zero means the harness has not yet resolved the client's compiled-in
 * maximum. The panel must render that as unknown rather than dividing by it —
 * and it must never import the contract itself, because a second importer of
 * `shared/contracts.js` disturbs the packaged proof that the Enhancement
 * runtime is what requested it. The cap arrives by callback.
 */
export interface HeapSample {
  atMs: number;
  bytes: number;
}

export interface HeapSummary {
  bytes: number;
  capBytes: number;
  /** Null when the cap is unknown. */
  fractionOfCap: number | null;
  /** Growth over the whole run, bytes per minute; null when unmeasurable. */
  runBytesPerMinute: number | null;
  /** Growth over the trailing window; null when the window is not covered. */
  recentBytesPerMinute: number | null;
  /** Minutes until the cap at the run rate; null when unmeasurable. */
  minutesToCap: number | null;
  /** Samples where the heap grew. Two steps inside one interval coalesce. */
  steps: number;
  lastStepBytes: number | null;
  lastStepAtMs: number | null;
}

const RECENT_WINDOW_MS = 30 * 60_000;
const MIB = 1_048_576;

/**
 * The run rate, not the recent one, drives the estimate. Heap growth is a step
 * function — the client takes the runtime's largest allowed chunk at a time —
 * so a short window reads as either zero or enormous depending on where the
 * sample landed. Both are shown, each labelled with its window, and the reader
 * decides.
 */
export function summarizeHeap(
  samples: readonly HeapSample[],
  capBytes: number,
  nowMs: number,
): HeapSummary {
  const latest = samples.at(-1);
  const bytes = latest?.bytes ?? 0;
  const summary: HeapSummary = {
    bytes,
    capBytes,
    fractionOfCap: capBytes > 0 ? bytes / capBytes : null,
    runBytesPerMinute: null,
    recentBytesPerMinute: null,
    minutesToCap: null,
    steps: 0,
    lastStepBytes: null,
    lastStepAtMs: null,
  };
  if (samples.length === 0) return summary;

  // A decrease is a reloaded client rather than a shrinking heap — WASM memory
  // never gives pages back — so it restarts the count instead of subtracting.
  let previous = samples[0]!.bytes;
  for (const sample of samples.slice(1)) {
    if (sample.bytes > previous) {
      summary.steps += 1;
      summary.lastStepBytes = sample.bytes - previous;
      summary.lastStepAtMs = sample.atMs;
    }
    previous = sample.bytes;
  }

  const slope = (from: HeapSample | undefined) => {
    if (!from || !latest) return null;
    const minutes = (latest.atMs - from.atMs) / 60_000;
    if (minutes <= 0) return null;
    return (latest.bytes - from.bytes) / minutes;
  };

  summary.runBytesPerMinute = slope(samples[0]);
  summary.recentBytesPerMinute = slope(
    [...samples].reverse().find((s) => s.atMs <= nowMs - RECENT_WINDOW_MS),
  );

  const rate = summary.runBytesPerMinute;
  if (capBytes > 0 && rate !== null && rate > 0) {
    summary.minutesToCap = Math.max(0, (capBytes - bytes) / rate);
  }
  return summary;
}

/**
 * Halve a full ring by dropping every second sample, keeping the first and the
 * last. Paired with a doubling interval this keeps the sparkline spanning the
 * whole run at a fixed cost, rather than showing an ever-shorter tail of a
 * session whose length is the interesting part.
 */
export function decimate(samples: readonly HeapSample[]): HeapSample[] {
  if (samples.length < 3) return [...samples];
  const kept = samples.filter((_, index) => index % 2 === 0);
  const last = samples.at(-1)!;
  if (kept.at(-1) !== last) kept.push(last);
  return kept;
}

const CAPACITY = 240;
const FIRST_INTERVAL_MS = 5_000;

const PANEL_CSS = `
/*
 * The right edge, vertically centred: the four corners are taken
 * (#capture-status, #diagnostics, #input-trace, Tools) and it must not cover
 * #memory-notice at the top centre, which is one of the things it exists to
 * judge. Only the buttons take the pointer.
 *
 * Above the launcher rather than below it, unlike every other overlay here.
 * The launcher covers the whole window, and it is what a simulated crash
 * raises — so a panel underneath it would hide its own Dismiss button at the
 * one moment that button is the way out.
 */
#dev-panel {
  position: fixed;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  z-index: 11;
  width: 310px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid #4a4740;
  border-radius: 3px;
  background: rgba(8, 8, 10, 0.97);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
  color: #e8e4d8;
  font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
#dev-panel[hidden] { display: none; }
#dev-panel h2 {
  margin: 0 0 6px;
  color: #c8aa6e;
  font: inherit;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
#dev-panel dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 10px;
  margin: 0;
}
#dev-panel dt { color: #8d8a82; }
#dev-panel dd { margin: 0; white-space: pre; }
#dev-panel dd[data-warn="true"] { color: #ffb488; }
#dev-panel svg { display: block; width: 100%; height: 44px; margin: 8px 0 4px; }
#dev-panel svg .cap { stroke: #6b4a3a; stroke-dasharray: 2 3; }
#dev-panel svg .curve { fill: none; stroke: #c8aa6e; stroke-width: 1.5; }
#dev-panel section {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid #332f29;
}
#dev-panel section h3 {
  margin: 0 0 5px;
  color: #8d8a82;
  font: inherit;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
#dev-panel section[data-danger="true"] h3 { color: #d98a6a; }
#dev-panel .row { display: flex; flex-wrap: wrap; gap: 4px; }
#dev-panel button {
  pointer-events: auto;
  padding: 3px 8px;
  border: 1px solid #524e44;
  border-radius: 2px;
  background: #1d1c19;
  color: #e8e4d8;
  font: inherit;
  cursor: default;
}
#dev-panel button:hover { background: #2a2823; border-color: #6b6557; }
#dev-panel button:active { transform: scale(0.97); }
#dev-panel button:focus-visible { outline: 1px solid #c8aa6e; outline-offset: 1px; }
#dev-panel section[data-danger="true"] button { border-color: #6b4438; }
#dev-panel section[data-danger="true"] button:hover { border-color: #a3634a; }
#dev-panel p { margin: 5px 0 0; color: #8d8a82; white-space: normal; }
`;

export interface DevPanelHost {
  parent: HTMLElement;
  log(...values: unknown[]): void;
  /** Current WASM linear memory, in bytes. */
  heapBytes(): number;
  /** The client's compiled-in maximum; 0 until the harness has resolved it. */
  capBytes(): number;
  /** The escalation the real watcher has reached. Read only. */
  realNoticeLevel(): string;
  /** Draws the notice without touching the watcher's own state. */
  previewNotice(level: 'low' | 'critical'): void;
  hideNotice(): void;
  /** Draws the crash overlay without recording a crash. */
  previewCrash(count: number): void;
  dismissOverlay(): void;
  openSockets(): number;
  /** Path (d): drop the connections, leave the client running. */
  dropSockets(): void;
  /** Path (a): sync the filesystem, then reload. */
  reloadSafely(): void;
  /** Path (c1): reload without closing anything, so no FIN is ever sent. */
  reloadOrphaning(): void;
}

export interface DevPanel {
  toggle(): boolean;
  visible(): boolean;
}

const minutesText = (minutes: number | null): string => {
  if (minutes === null) return '—';
  if (minutes < 60) return `~${Math.round(minutes)} m`;
  const hours = Math.floor(minutes / 60);
  return `~${hours} h ${String(Math.round(minutes % 60)).padStart(2, '0')} m`;
};

const clockText = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
};

const perHour = (bytesPerMinute: number | null): string =>
  bytesPerMinute === null
    ? '—'
    : `${bytesPerMinute >= 0 ? '+' : ''}${Math.round((bytesPerMinute * 60) / MIB)} MiB/h`;

export function createDevPanel(host: DevPanelHost): DevPanel {
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  const root = document.createElement('div');
  root.id = 'dev-panel';
  root.hidden = true;
  root.innerHTML = `
    <h2>Memory debug</h2>
    <dl>
      <dt>heap</dt><dd data-role="heap"></dd>
      <dt>notice</dt><dd data-role="notice"></dd>
      <dt>growth</dt><dd data-role="growth"></dd>
      <dt>to cap</dt><dd data-role="tocap"></dd>
      <dt>steps</dt><dd data-role="steps"></dd>
      <dt>sockets</dt><dd data-role="sockets"></dd>
      <dt>uptime</dt><dd data-role="uptime"></dd>
    </dl>
    <svg data-role="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <line class="cap" x1="0" y1="0.75" x2="100" y2="0.75"></line>
      <polyline class="curve" data-role="curve" points=""></polyline>
    </svg>
    <section>
      <h3>Simulate</h3>
      <div class="row">
        <button type="button" data-role="low">Low notice</button>
        <button type="button" data-role="critical">Critical notice</button>
        <button type="button" data-role="hide">Hide</button>
      </div>
      <div class="row" style="margin-top:4px">
        <button type="button" data-role="crash1">Crash 1st</button>
        <button type="button" data-role="crash2">Crash repeat</button>
        <button type="button" data-role="dismiss">Dismiss</button>
      </div>
    </section>
    <section data-danger="true">
      <h3>Reconnect triggers</h3>
      <div class="row">
        <button type="button" data-role="drop">d · drop sockets</button>
        <button type="button" data-role="reload-safe">a · sync + reload</button>
        <button type="button" data-role="reload-orphan">c1 · orphan + reload</button>
      </div>
      <p>b is View → Reload Game. c2 is Help → Diagnostics → Crash Renderer Process.
         Note uptime and sockets before each, and how long the re-login took.</p>
    </section>
  `;
  host.parent.append(style, root);

  const cell = (role: string) =>
    root.querySelector<HTMLElement>(`dd[data-role="${role}"]`)!;
  const heapCell = cell('heap');
  const noticeCell = cell('notice');
  const growthCell = cell('growth');
  const toCapCell = cell('tocap');
  const stepsCell = cell('steps');
  const socketsCell = cell('sockets');
  const uptimeCell = cell('uptime');
  const curve = root.querySelector<SVGPolylineElement>('[data-role="curve"]')!;

  const on = (role: string, run: () => void) => {
    root
      .querySelector<HTMLButtonElement>(`button[data-role="${role}"]`)!
      .addEventListener('click', run);
  };

  const startedAt = performance.now();
  let samples: HeapSample[] = [];
  let intervalMs = FIRST_INTERVAL_MS;
  let nextSampleAt = startedAt;
  let simulated: string | null = null;
  let visible = false;

  const sample = (nowMs: number) => {
    if (nowMs < nextSampleAt) return;
    nextSampleAt = nowMs + intervalMs;
    samples.push({ atMs: nowMs, bytes: host.heapBytes() });
    if (samples.length > CAPACITY) {
      samples = decimate(samples);
      intervalMs *= 2;
    }
  };

  const paintCurve = (summary: HeapSummary) => {
    if (samples.length < 2 || summary.capBytes <= 0) {
      curve.setAttribute('points', '');
      return;
    }
    const first = samples[0]!.atMs;
    const span = Math.max(1, samples.at(-1)!.atMs - first);
    curve.setAttribute(
      'points',
      samples
        .map((s) => {
          const x = ((s.atMs - first) / span) * 100;
          const y = 30 - Math.min(1, s.bytes / summary.capBytes) * 30;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' '),
    );
  };

  const paint = (nowMs: number) => {
    const summary = summarizeHeap(samples, host.capBytes(), nowMs);
    const cap = summary.capBytes > 0
      ? `${Math.round(summary.capBytes / MIB)}`
      : '?';
    const pct = summary.fractionOfCap === null
      ? ''
      : `  ${(summary.fractionOfCap * 100).toFixed(1)}%`;
    heapCell.textContent = `${Math.round(summary.bytes / MIB)} / ${cap} MiB${pct}`;
    heapCell.dataset.warn = String((summary.fractionOfCap ?? 0) > 0.85);

    // The real escalation is shown beside the simulated one precisely so a
    // preview can be seen not to have moved it.
    noticeCell.textContent = simulated === null
      ? `real ${host.realNoticeLevel()}`
      : `real ${host.realNoticeLevel()} · showing ${simulated} (sim)`;
    noticeCell.dataset.warn = String(simulated !== null);

    growthCell.textContent =
      `${perHour(summary.recentBytesPerMinute)} 30m · ${perHour(summary.runBytesPerMinute)} run`;
    toCapCell.textContent = minutesText(summary.minutesToCap);
    stepsCell.textContent = summary.lastStepBytes === null
      ? String(summary.steps)
      : `${summary.steps} · last +${Math.round(summary.lastStepBytes / MIB)} MiB`;
    socketsCell.textContent = String(host.openSockets());
    uptimeCell.textContent = clockText(nowMs - startedAt);
    paintCurve(summary);
  };

  // Sampling runs whether or not anyone is looking — the curve is worth having
  // for the whole session, and the panel is usually opened after something has
  // already gone wrong. Only the painting is conditional.
  setInterval(() => {
    const nowMs = performance.now();
    sample(nowMs);
    if (visible) paint(nowMs);
  }, 1_000);
  sample(startedAt);

  const preview = (level: 'low' | 'critical') => {
    simulated = level;
    host.previewNotice(level);
    host.log(`[dev] simulated ${level} notice — real level ${host.realNoticeLevel()}`);
  };

  on('low', () => preview('low'));
  on('critical', () => preview('critical'));
  on('hide', () => {
    simulated = null;
    host.hideNotice();
  });
  on('crash1', () => host.previewCrash(1));
  on('crash2', () => host.previewCrash(2));
  on('dismiss', () => host.dismissOverlay());
  on('drop', () => {
    host.log(`[dev] dropping ${host.openSockets()} socket(s), client stays running`);
    host.dropSockets();
  });
  on('reload-safe', () => {
    host.log('[dev] reload: filesystem sync, then reload');
    host.reloadSafely();
  });
  on('reload-orphan', () => {
    host.log('[dev] reload: orphaning sockets, no close sent');
    host.reloadOrphaning();
  });

  return Object.freeze({
    visible: () => visible,
    toggle() {
      visible = !visible;
      root.hidden = !visible;
      if (visible) paint(performance.now());
      return visible;
    },
  });
}
