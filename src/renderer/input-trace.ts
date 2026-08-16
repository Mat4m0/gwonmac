/**
 * Player-visible input harness. This is the sole owner of trace memory,
 * presentation, and copied output. It never changes input or persists data.
 */
import type {
  InputTrace,
  InputTraceEntry,
  InputTraceRecord,
} from '../shared/input-trace.js';
import { CLIPBOARD_TEXT_CEILING } from '../shared/contracts.js';

const TRACE_CAPACITY = 1_000;
const VISIBLE_ROWS = 18;

const OVERLAY_CSS = `
#input-trace { position:fixed; bottom:12px; left:12px; z-index:5;
  width:min(720px,calc(100vw - 24px)); box-sizing:border-box; padding:8px 12px;
  border:1px solid #4a4740; border-radius:3px; background:rgba(8,8,10,.97);
  box-shadow:0 6px 20px rgba(0,0,0,.55); color:#e8e4d8;
  font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
  font-variant-numeric:tabular-nums; pointer-events:none; user-select:none; }
#input-trace[hidden] { display:none; }
#input-trace header { display:flex; align-items:center; gap:8px; margin-bottom:6px;
  color:#c8aa6e; text-transform:uppercase; letter-spacing:.06em; }
#input-trace header span[data-role="count"] { color:#8d8a82; margin-left:auto; }
#input-trace button { pointer-events:auto; padding:2px 8px; border:1px solid #524e44;
  border-radius:2px; background:#1d1c19; color:#e8e4d8; font:inherit;
  text-transform:none; letter-spacing:0; cursor:default; }
#input-trace button:hover { background:#2a2823; border-color:#6b6557; }
#input-trace button:focus-visible { outline:1px solid #c8aa6e; outline-offset:1px; }
#input-trace ol { margin:0; padding:0; list-style:none; display:grid; gap:1px; }
#input-trace li { white-space:pre; overflow:hidden; text-overflow:ellipsis; }
#input-trace li[data-tone="decision"] { color:#ffb488; }
#input-trace li[data-tone="refused"] { color:#8d8a82; }
#input-trace p { margin:6px 0 0; color:#8d8a82; white-space:normal; }
`;

const BUTTON_NAMES: Readonly<Record<number, string>> = {
  0: 'left', 1: 'middle', 2: 'right',
};

const label = (record: InputTraceRecord): { text: string; tone: string } => {
  const sequence = String(record.sequence).padStart(4, '0');
  const gap = record.sinceMs === null
    ? '    —'
    : `${String(Math.round(record.sinceMs)).padStart(4, ' ')}ms`;
  const prefix = `${sequence} ${gap} ${record.source.padEnd(8)}`;
  switch (record.kind) {
    case 'native-key':
      return {
        tone: record.decision === 'forwarded' ? 'event' : 'decision',
        text: `${prefix} key ${record.phase} ${record.key}`
          + `${record.repeat ? ' repeat' : ''} → ${record.decision}`,
      };
    case 'key':
      return {
        tone: record.decision === 'suppressed' ? 'decision' : 'event',
        text: `${prefix} key ${record.phase} ${record.owner}`
          + `${record.code ? ` ${record.code}` : ''}`
          + `${record.repeat ? ' repeat' : ''}`
          + ` trusted=${record.trusted} → ${record.decision}`,
      };
    case 'text':
      return {
        tone: 'event',
        text: `${prefix} text ${record.owner} ${record.phase}`
          + ` trusted=${record.trusted} type=${record.inputType}`,
      };
    case 'press':
      return {
        tone: 'event',
        text: `${prefix} press ${BUTTON_NAMES[record.button] ?? 'other'}`
          + ` run=${record.detail}`
          + record.modifiers.map((modifier) => ` +${modifier}`).join(''),
      };
    case 'release':
      return { tone: 'event', text: `${prefix} release ${BUTTON_NAMES[record.button] ?? 'other'} travel=${record.travel} remaining=${record.buttonsRemaining}` };
    case 'modifier':
      return { tone: 'event', text: `${prefix} ${record.key} ${record.down ? 'down' : 'up'}` };
    case 'double-click':
      return record.delivered
        ? { tone: 'decision', text: `${prefix} DOUBLE-CLICK flagged` }
        : { tone: 'refused', text: `${prefix} DOUBLE-CLICK unavailable` };
    case 'pointer-lock':
      return { tone: 'decision', text: `${prefix} pointer lock ${record.locked ? 'engaged' : 'released'}` };
    case 'wheel':
      return { tone: 'event', text: `${prefix} wheel ${record.direction} ${record.mode}` };
    case 'release-all':
      return { tone: 'refused', text: `${prefix} input released (${record.cause})` };
    case 'gamepad':
      return {
        tone: 'event',
        text: `${prefix} gamepad ${record.phase}`
          + `${record.control === undefined ? '' : ` control=${record.control}`}`
          + `${record.direction === undefined ? '' : ` direction=${record.direction}`}`,
      };
  }
};

export function createInputTrace(
  parent: HTMLElement,
  writeText: (text: string) => Promise<void>,
): InputTrace {
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  const root = document.createElement('div');
  root.id = 'input-trace';
  root.hidden = true;
  root.innerHTML = `
    <header>
      Input harness
      <button type="button" data-role="pause">Pause</button>
      <button type="button" data-role="copy">Copy</button>
      <button type="button" data-role="clear">Clear</button>
      <span data-role="count"></span>
    </header>
    <ol data-role="rows"></ol>
    <p>Reproduce the problem, Pause, then Copy and paste it into the issue.</p>
  `;
  parent.append(style, root);

  const rows = root.querySelector<HTMLOListElement>('[data-role="rows"]')!;
  const count = root.querySelector<HTMLElement>('[data-role="count"]')!;
  const pauseButton = root.querySelector<HTMLButtonElement>('[data-role="pause"]')!;
  const copyButton = root.querySelector<HTMLButtonElement>('[data-role="copy"]')!;
  const clearButton = root.querySelector<HTMLButtonElement>('[data-role="clear"]')!;
  const entries: InputTraceRecord[] = [];
  let active = false;
  let isPaused = false;
  let lastAt: number | null = null;
  let sequence = 0;
  let painting = false;

  const paint = () => {
    painting = false;
    rows.replaceChildren(...entries.slice(-VISIBLE_ROWS).map((record) => {
      const rendered = label(record);
      const li = document.createElement('li');
      li.dataset.tone = rendered.tone;
      li.textContent = rendered.text;
      return li;
    }));
    count.textContent = `${entries.length}/${TRACE_CAPACITY}`;
  };
  const schedulePaint = () => {
    if (painting) return;
    painting = true;
    requestAnimationFrame(paint);
  };
  const clear = () => {
    entries.length = 0;
    lastAt = null;
    sequence = 0;
    schedulePaint();
  };

  pauseButton.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseButton.textContent = isPaused ? 'Resume' : 'Pause';
  });
  clearButton.addEventListener('click', clear);
  copyButton.addEventListener('click', () => {
    void writeText(inputTraceTranscript(entries)).then(
      () => { copyButton.textContent = 'Copied'; },
      () => { copyButton.textContent = 'Copy failed'; },
    ).then(() => {
      setTimeout(() => { copyButton.textContent = 'Copy'; }, 1_500);
    });
  });

  return Object.freeze({
    enabled: () => active,
    paused: () => isPaused,
    setEnabled(enabled: boolean) {
      active = enabled;
      root.hidden = !enabled;
      if (!enabled) {
        isPaused = false;
        pauseButton.textContent = 'Pause';
        clear();
      } else {
        schedulePaint();
      }
    },
    record(entry: InputTraceEntry) {
      if (!active || isPaused) return;
      const atMs = performance.now();
      entries.push({
        ...entry,
        sequence: ++sequence,
        atMs,
        sinceMs: lastAt === null ? null : atMs - lastAt,
      } as InputTraceRecord);
      lastAt = atMs;
      if (entries.length > TRACE_CAPACITY) entries.shift();
      schedulePaint();
    },
  });
}

function inputTraceTranscript(
  entries: readonly InputTraceRecord[],
): string {
  const heading = [
    `gwonmac input harness — ${entries.length} events`,
    'privacy: text, clipboard data, field lengths, coordinates, account and device identifiers omitted',
    'columns: sequence  gap  source  event  decision',
  ];
  // Reserve enough room for the omission line before collecting the newest
  // complete rows. The main process enforces the same clipboard ceiling.
  const omissionReserve = 64;
  let used = heading.join('\n').length + 2 + omissionReserve;
  const rows: string[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const row = label(entries[index]!).text;
    if (used + row.length + 1 > CLIPBOARD_TEXT_CEILING) break;
    rows.unshift(row);
    used += row.length + 1;
  }
  const omitted = entries.length - rows.length;
  return [
    ...heading,
    ...(omitted > 0 ? [`${omitted} older events omitted`] : []),
    '',
    ...rows,
  ].join('\n');
}
