import type { AppSettings } from "../../src/shared/contracts.js";

export type InputClickProbeStats = Readonly<{
  trustedMouseDown: number;
  trustedMouseUp: number;
  trustedClick: number;
  trustedDownOnCanvas: number;
  trustedDownOverCanvas: number;
  canvasCaptureMouseDown: number;
  canvasBubbleMouseDown: number;
  syntheticTouchStart: number;
  syntheticTouchEnd: number;
  syntheticMouseMove: number;
  suppressedSyntheticMouseMove: number;
  focusLoss: number;
}>;

export type InputClickProbeSample = Readonly<{
  sequence: number;
  atMs: number;
  stage: string;
  type: string;
  trusted: boolean;
  target: "canvas" | "other";
  button: number;
  buttons: number;
  detail: number;
  clientX: number;
  clientY: number;
  touches: number;
  defaultPrevented: boolean;
  cancelBubble: boolean;
  focused: boolean;
  activeCanvas: boolean;
}>;

export type InputClickProbeEvents = Readonly<{
  label: string;
  mode: AppSettings["touchMode"];
  suppressCursorRefresh: boolean;
  stats: InputClickProbeStats;
  samples: readonly InputClickProbeSample[];
  overflow: number;
}>;

export type InputClickProbePhase = Readonly<{
  label: string;
  mode: AppSettings["touchMode"];
  suppressCursorRefresh: boolean;
  before: Readonly<{
    x: number;
    y: number;
    cursorEvents: number;
    cursorRefreshes: number;
  }>;
  after: Readonly<{
    x: number;
    y: number;
    cursorEvents: number;
    cursorRefreshes: number;
  }>;
  distance: number;
  events: InputClickProbeEvents;
}>;

type MutableStats = {
  -readonly [Key in keyof InputClickProbeStats]: number;
};

export type BrowserInputClickProbe = {
  begin(
    label: string,
    mode: AppSettings["touchMode"],
    suppressCursorRefresh: boolean,
  ): void;
  finish(): InputClickProbeEvents | null;
  dispose(): void;
};

type ProbeWindow = typeof globalThis & {
  __gwInputClickProbe?: BrowserInputClickProbe;
};

/**
 * Installs only event observers plus one explicitly selected suppression arm.
 * Playwright serializes this function into the renderer; keep its runtime body
 * self-contained and its global private to the live harness.
 */
export function installInputClickProbe(): boolean {
  const probeWindow = globalThis as ProbeWindow;
  if (probeWindow.__gwInputClickProbe) return true;
  const canvas = globalThis.document.getElementById("canvas");
  if (!(canvas instanceof globalThis.HTMLCanvasElement)) return false;

  const eventTypes = [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "mousemove",
    "touchstart",
    "touchend",
    "touchcancel",
    "blur",
  ] as const;
  const listeners: Array<{
    target: EventTarget;
    type: string;
    listener: EventListener;
    capture: boolean;
  }> = [];
  let active: {
    label: string;
    mode: AppSettings["touchMode"];
    suppressCursorRefresh: boolean;
    startedAt: number;
    sequence: number;
    stats: MutableStats;
    samples: InputClickProbeSample[];
    overflow: number;
  } | null = null;

  const listen = (
    target: EventTarget,
    stage: string,
    type: string,
    capture: boolean,
  ) => {
    const listener: EventListener = (event) => {
      const current = active;
      if (!current) return;
      const mouse = event instanceof globalThis.MouseEvent ? event : null;
      const touch = event instanceof globalThis.TouchEvent ? event : null;
      // Physical pointer movement would drown the click sequence. Synthetic
      // cursor-refresh moves and held drags remain evidence.
      if (event.type === "mousemove" && mouse?.isTrusted && mouse.buttons === 0) {
        return;
      }
      const changed = touch?.changedTouches.item(0) ?? null;
      const clientX = mouse?.clientX ?? changed?.clientX ?? -1;
      const clientY = mouse?.clientY ?? changed?.clientY ?? -1;
      const targetCanvas = event.target === canvas;
      if (stage === "window-capture") {
        if (event.type === "mousedown" && mouse?.isTrusted) {
          current.stats.trustedMouseDown += 1;
          if (targetCanvas) current.stats.trustedDownOnCanvas += 1;
          if (
            clientX >= 0
            && clientY >= 0
            && globalThis.document.elementFromPoint(clientX, clientY) === canvas
          ) {
            current.stats.trustedDownOverCanvas += 1;
          }
        } else if (event.type === "mouseup" && mouse?.isTrusted) {
          current.stats.trustedMouseUp += 1;
        } else if (event.type === "click" && mouse?.isTrusted) {
          current.stats.trustedClick += 1;
        } else if (event.type === "touchstart" && !event.isTrusted) {
          current.stats.syntheticTouchStart += 1;
        } else if (event.type === "touchend" && !event.isTrusted) {
          current.stats.syntheticTouchEnd += 1;
        } else if (event.type === "blur") {
          current.stats.focusLoss += 1;
        }
      }
      if (
        stage === "canvas-capture"
        && event.type === "mousedown"
        && mouse?.isTrusted
      ) {
        current.stats.canvasCaptureMouseDown += 1;
      }
      if (
        stage === "canvas-bubble"
        && event.type === "mousedown"
        && mouse?.isTrusted
      ) {
        current.stats.canvasBubbleMouseDown += 1;
      }
      if (
        stage === "document-capture"
        && event.type === "mousemove"
        && mouse
        && !mouse.isTrusted
        && mouse.buttons === 0
        && targetCanvas
      ) {
        current.stats.syntheticMouseMove += 1;
        if (current.suppressCursorRefresh) {
          current.stats.suppressedSyntheticMouseMove += 1;
          event.stopImmediatePropagation();
          event.preventDefault();
        }
      }
      const sample: InputClickProbeSample = {
        sequence: ++current.sequence,
        atMs: Math.round((performance.now() - current.startedAt) * 10) / 10,
        stage,
        type: event.type,
        trusted: event.isTrusted,
        target: targetCanvas ? "canvas" : "other",
        button: mouse?.button ?? -1,
        buttons: mouse?.buttons ?? 0,
        detail: mouse?.detail ?? 0,
        clientX,
        clientY,
        touches: touch?.touches.length ?? 0,
        defaultPrevented: event.defaultPrevented,
        cancelBubble: event.cancelBubble,
        focused: globalThis.document.hasFocus(),
        activeCanvas: globalThis.document.activeElement === canvas,
      };
      if (current.samples.length < 64) current.samples.push(sample);
      else current.overflow += 1;
    };
    target.addEventListener(type, listener, { capture });
    listeners.push({ target, type, listener, capture });
  };

  for (const type of eventTypes) {
    listen(globalThis.window, "window-capture", type, true);
    listen(globalThis.document, "document-capture", type, true);
    listen(canvas, "canvas-capture", type, true);
    listen(canvas, "canvas-bubble", type, false);
  }

  probeWindow.__gwInputClickProbe = {
    begin(label, mode, suppressCursorRefresh) {
      active = {
        label,
        mode,
        suppressCursorRefresh,
        startedAt: performance.now(),
        sequence: 0,
        stats: {
          trustedMouseDown: 0,
          trustedMouseUp: 0,
          trustedClick: 0,
          trustedDownOnCanvas: 0,
          trustedDownOverCanvas: 0,
          canvasCaptureMouseDown: 0,
          canvasBubbleMouseDown: 0,
          syntheticTouchStart: 0,
          syntheticTouchEnd: 0,
          syntheticMouseMove: 0,
          suppressedSyntheticMouseMove: 0,
          focusLoss: 0,
        },
        samples: [],
        overflow: 0,
      };
    },
    finish() {
      if (!active) return null;
      const result: InputClickProbeEvents = {
        label: active.label,
        mode: active.mode,
        suppressCursorRefresh: active.suppressCursorRefresh,
        stats: { ...active.stats },
        samples: [...active.samples],
        overflow: active.overflow,
      };
      active = null;
      return result;
    },
    dispose() {
      active = null;
      for (const { target, type, listener, capture } of listeners) {
        target.removeEventListener(type, listener, { capture });
      }
      delete probeWindow.__gwInputClickProbe;
    },
  };
  return true;
}

const moved = (phase: InputClickProbePhase | undefined) =>
  phase !== undefined && phase.distance > 5;

const onePhysicalClick = (phase: InputClickProbePhase | undefined) =>
  phase !== undefined
  && phase.events.stats.trustedMouseDown === 1
  && phase.events.stats.trustedMouseUp === 1;

/** Turn the bounded evidence into hypotheses, not a false single diagnosis. */
export function inputClickHypotheses(
  phases: readonly InputClickProbePhase[],
): readonly string[] {
  const findings: string[] = [];
  const current = phases.find((phase) => phase.label === "current");
  const mouseOnly = phases.find((phase) => phase.label === "mouse-only");
  const noRefresh = phases.find(
    (phase) => phase.label === "mouse-only-no-cursor-refresh",
  );
  const translate = phases.find((phase) => phase.mode === "translate");
  const defaultMode = phases.find(
    (phase) => phase.label === "default-double-tap",
  );
  const controlled = phases.filter(onePhysicalClick);

  if (phases.some((phase) => phase.events.stats.trustedMouseDown === 0)) {
    findings.push("physical-click-missing-or-window-not-active");
  }
  if (phases.some((phase) => phase.events.stats.trustedMouseDown > 1)) {
    findings.push("operator-click-count-mismatch");
  }
  if (
    phases.some((phase) =>
      phase.events.stats.trustedMouseDown > 0
      && (
        phase.events.stats.trustedDownOnCanvas === 0
        || phase.events.stats.trustedDownOverCanvas === 0
      ))
  ) {
    findings.push("click-target-covered-or-outside-canvas");
  }
  if (
    translate
    && translate.events.stats.syntheticTouchStart > 0
    && onePhysicalClick(translate)
    && !moved(translate)
    && (
      (onePhysicalClick(mouseOnly) && moved(mouseOnly))
      || (onePhysicalClick(defaultMode) && moved(defaultMode))
    )
  ) {
    findings.push("translate-mouse-to-touch-breaks-click-to-move");
  }
  if (
    mouseOnly
    && noRefresh
    && onePhysicalClick(mouseOnly)
    && onePhysicalClick(noRefresh)
    && !moved(mouseOnly)
    && moved(noRefresh)
    && mouseOnly.events.stats.syntheticMouseMove > 0
  ) {
    findings.push("cursor-refresh-interferes-with-click-to-move");
  }
  if (
    onePhysicalClick(current)
    && !moved(current)
    && controlled.some(moved)
  ) {
    findings.push("persisted-current-input-mode-is-the-regression");
  }
  if (
    controlled.length > 0
    && controlled.every((phase) => !moved(phase))
    && controlled.some(
      (phase) => phase.events.stats.trustedDownOnCanvas > 0,
    )
  ) {
    findings.push("game-state-or-click-location-needs-investigation");
  }
  if (findings.length === 0 && controlled.some(moved)) {
    findings.push("click-to-move-observed-working");
  }
  return findings;
}
