/**
 * The input trace: a live, bounded record of what the input host saw and what
 * it decided, drawn over the game so a player can reproduce a click bug and
 * hand back the sequence that caused it.
 *
 * It owns the ring buffer, the overlay, and the text it copies out. It decides
 * nothing about input — `input.ts` remains the one input policy and calls in
 * here at the points where it makes a choice. Turning the trace off must not
 * change a single client-visible event, so this module never dispatches, never
 * cancels, and never touches the canvas.
 *
 * Deliberately not the diagnostics recorder: that is the certified,
 * closed-schema, main-process path for shipped telemetry. This is a developer
 * and bug-reporter instrument the player can read on screen and paste into an
 * issue, and it never leaves the renderer unless the player copies it.
 */

// A hand cannot produce more than a few events per second that matter here,
// and a reporter needs the run-up to the mistake rather than the whole
// session. Two hundred entries is about a minute of deliberate clicking.
const TRACE_CAPACITY = 200;

// Rows drawn in the panel. The buffer keeps more than the panel shows so the
// copied text carries the run-up that scrolled away.
const VISIBLE_ROWS = 14;

const OVERLAY_CSS = `
/*
 * Bottom left: the other fixed overlays own the rest — #capture-status the top
 * left, #diagnostics the top right, Tools the bottom right — and a capture is
 * exactly the thing most likely to be running at the same time as this. Only
 * the two buttons take the pointer; every other pixel of the panel lets a
 * click through to the game beneath it.
 */
#input-trace {
  position: fixed;
  bottom: 12px;
  left: 12px;
  z-index: 5;
  width: 460px;
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid #4a4740;
  border-radius: 3px;
  /* Near-opaque on purpose. At 0.88 the game's own chat drew straight through
     the rows and the trace was unreadable in exactly the crowded district
     someone would be debugging in. */
  background: rgba(8, 8, 10, 0.97);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
  color: #e8e4d8;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
#input-trace[hidden] { display: none; }
#input-trace header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: #c8aa6e;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
#input-trace header span[data-role="count"] { color: #8d8a82; margin-left: auto; }
#input-trace button {
  pointer-events: auto;
  padding: 2px 8px;
  border: 1px solid #524e44;
  border-radius: 2px;
  background: #1d1c19;
  color: #e8e4d8;
  font: inherit;
  text-transform: none;
  letter-spacing: 0;
  cursor: default;
}
#input-trace button:hover { background: #2a2823; border-color: #6b6557; }
#input-trace button:focus-visible { outline: 1px solid #c8aa6e; outline-offset: 1px; }
#input-trace ol {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 1px;
}
#input-trace li { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
#input-trace li[data-tone="decision"] { color: #ffb488; }
#input-trace li[data-tone="refused"] { color: #8d8a82; }
#input-trace p {
  margin: 6px 0 0;
  color: #8d8a82;
  white-space: normal;
}
`;

const label = (record: InputTraceRecord): { text: string; tone: string } => {
  const at = String(Math.round(record.atMs)).padStart(6, ' ');
  const gap = record.sinceMs === null
    ? '     —'
    : `${String(Math.round(record.sinceMs)).padStart(5, ' ')}ms`;
  switch (record.kind) {
    case 'press':
      return {
        tone: 'event',
        text: `${at} ${gap}  press  ${BUTTON_NAMES[record.button] ?? record.button}`
          + `  run=${record.detail}${record.modifiers}`,
      };
    case 'release':
      return {
        tone: 'event',
        text: `${at} ${gap}  release ${BUTTON_NAMES[record.button] ?? record.button}`
          + `  moved=${record.travelPx}px`,
      };
    case 'modifier':
      // Its own row rather than a column on the press, because the client
      // builds the modifier state a click carries out of these events and not
      // out of the click. A missing row here is the whole bug for Ctrl+click.
      return {
        tone: 'event',
        text: `${at} ${gap}  ${record.key}${record.down ? ' down' : ' up'}`,
      };
    case 'double-click':
      // Recorded from the press that carried it, so it sits immediately under
      // its own `press … run=2` row rather than a quarter second later.
      return record.delivered
        ? { tone: 'decision', text: `${at} ${gap}  DOUBLE-CLICK flagged` }
        : {
            tone: 'refused',
            text: `${at} ${gap}  DOUBLE-CLICK unavailable (client not certified)`,
          };
    case 'pointer-lock':
      return {
        tone: 'decision',
        text: `${at} ${gap}  pointer lock ${record.locked ? 'engaged' : 'released'}`,
      };
    case 'release-all':
      return { tone: 'refused', text: `${at} ${gap}  input released (${record.cause})` };
  }
};

const BUTTON_NAMES: Readonly<Record<number, string>> = {
  0: 'left ',
  1: 'middle',
  2: 'right',
};

/**
 * `writeText` is the native clipboard bridge, not `navigator.clipboard`: the
 * renderer is a sandboxed custom-scheme document, so the Clipboard API rejects
 * the write and the button reported a failure it could do nothing about. The
 * same bridge already serves Cmd+C from the game's text proxy.
 */
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
      Input trace
      <button type="button" data-role="copy">Copy</button>
      <button type="button" data-role="clear">Clear</button>
      <span data-role="count"></span>
    </header>
    <ol data-role="rows"></ol>
    <p data-role="hint">Reproduce the problem, then Copy and paste it into the issue.</p>
  `;
  parent.append(style, root);

  const rows = root.querySelector<HTMLOListElement>('[data-role="rows"]')!;
  const count = root.querySelector<HTMLElement>('[data-role="count"]')!;
  const copyButton = root.querySelector<HTMLButtonElement>('[data-role="copy"]')!;
  const clearButton = root.querySelector<HTMLButtonElement>('[data-role="clear"]')!;

  const entries: InputTraceRecord[] = [];
  let enabled = false;
  let lastAt: number | null = null;
  // A frame's worth of records is one repaint, not one repaint each: a burst
  // that arrives inside a single task must not lay out the panel per entry.
  let painting = false;

  const paint = () => {
    painting = false;
    const shown = entries.slice(-VISIBLE_ROWS);
    rows.replaceChildren(...shown.map((record) => {
      const { text, tone } = label(record);
      const li = document.createElement('li');
      li.dataset.tone = tone;
      li.textContent = text;
      return li;
    }));
    count.textContent = `${entries.length}/${TRACE_CAPACITY}`;
  };

  const schedulePaint = () => {
    if (painting) return;
    painting = true;
    requestAnimationFrame(paint);
  };

  copyButton.addEventListener('click', () => {
    void writeText(transcript(entries)).then(
      () => { copyButton.textContent = 'Copied'; },
      () => { copyButton.textContent = 'Copy failed'; },
    ).then(() => {
      setTimeout(() => { copyButton.textContent = 'Copy'; }, 1_500);
    });
  });
  clearButton.addEventListener('click', () => {
    entries.length = 0;
    lastAt = null;
    schedulePaint();
  });

  return Object.freeze({
    enabled: () => enabled,
    toggle() {
      enabled = !enabled;
      root.hidden = !enabled;
      // A trace that keeps accumulating while hidden would hand back a
      // transcript of whatever the player did after they stopped looking.
      if (!enabled) {
        entries.length = 0;
        lastAt = null;
      }
      schedulePaint();
      return enabled;
    },
    record(entry: InputTraceEntry) {
      if (!enabled) return;
      const atMs = performance.now();
      const record = {
        ...entry,
        atMs,
        sinceMs: lastAt === null ? null : atMs - lastAt,
      } as InputTraceRecord;
      lastAt = atMs;
      entries.push(record);
      if (entries.length > TRACE_CAPACITY) entries.shift();
      schedulePaint();
    },
  });
}

/**
 * The text the Copy button produces: the same rows the panel draws, oldest
 * first, under a header naming what produced them. Nothing here is an
 * identifier — no coordinates, no window position, no account state — so a
 * player can paste it into a public issue without reading it first.
 */
function transcript(entries: readonly InputTraceRecord[]): string {
  const head = [
    `gwonmac input trace — ${entries.length} events`,
    'columns: elapsed  gap  event  detail',
    '',
  ];
  return [...head, ...entries.map((record) => label(record).text)].join('\n');
}
