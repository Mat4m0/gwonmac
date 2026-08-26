/**
 * Privacy-safe vocabulary for the player-visible input harness.
 *
 * This is deliberately a closed union. Main and renderer may both produce
 * entries, but neither may attach arbitrary text, coordinates, identifiers,
 * clipboard data, or field lengths to a report a player can copy publicly.
 */

export type InputTraceSource = 'appkit' | 'main' | 'renderer';
export type InputTraceOwner = 'canvas' | 'text' | 'secret' | 'surface' | 'other';
export type InputTraceTextPhase =
  | 'focus'
  | 'blur'
  | 'beforeinput'
  | 'input'
  | 'compositionstart'
  | 'compositionupdate'
  | 'compositionend'
  | 'selectionchange';
export type InputTraceInputType =
  | 'insert-text'
  | 'insert-paste'
  | 'insert-composition'
  | 'delete-backward'
  | 'delete-forward'
  | 'delete-cut'
  | 'history'
  | 'other'
  | 'none';
export type InputTraceModifier = 'ctrl' | 'shift' | 'alt' | 'cmd';
export type InputTraceKeyKind =
  | 'movement'
  | 'modifier'
  | 'navigation'
  | 'editing'
  | 'printable'
  | 'other';
export type InputTraceEntry =
  | {
      source: 'appkit' | 'main';
      kind: 'native-key';
      phase: 'down' | 'up';
      key: 'printable' | 'modifier' | 'navigation' | 'editing' | 'other';
      repeat: boolean;
      decision: 'forwarded' | 'shortcut' | 'capture' | 'normalized-release';
    }
  | {
      source: 'renderer';
      kind: 'key';
      phase: 'down' | 'up';
      owner: 'canvas';
      code: string;
      repeat: boolean;
      trusted: boolean;
      decision: 'observed' | 'held' | 'released' | 'suppressed' | 'command';
    }
  | {
      source: 'renderer';
      kind: 'normalized-release';
      owner: 'canvas';
      code: string;
      key: InputTraceKeyKind;
      released: true;
    }
  | {
      source: 'renderer';
      kind: 'normalized-release';
      owner: Exclude<InputTraceOwner, 'canvas'>;
      code?: never;
      key: InputTraceKeyKind;
      released: true;
    }
  | {
      source: 'renderer';
      kind: 'normalized-release';
      owner?: never;
      code?: never;
      key: InputTraceKeyKind;
      released: false;
    }
  | {
      source: 'renderer';
      kind: 'held-state';
      owner: 'canvas';
      code: string;
    }
  | {
      source: 'renderer';
      kind: 'held-state';
      owner: Exclude<InputTraceOwner, 'canvas'> | 'none';
      code?: never;
    }
  | {
      source: 'renderer';
      kind: 'key';
      phase: 'down' | 'up';
      owner: Exclude<InputTraceOwner, 'canvas'>;
      code?: never;
      repeat: boolean;
      trusted: boolean;
      decision: 'observed' | 'held' | 'released' | 'suppressed' | 'command';
    }
  | {
      source: 'renderer';
      kind: 'text';
      owner: 'text' | 'secret';
      phase: InputTraceTextPhase;
      trusted: boolean;
      inputType: InputTraceInputType;
    }
  | {
      source: 'renderer';
      kind: 'press';
      owner: InputTraceOwner;
      button: number;
      detail: number;
      modifiers: readonly InputTraceModifier[];
    }
  | {
      source: 'renderer';
      kind: 'release';
      owner: InputTraceOwner;
      button: number;
      travel: 'still' | 'short' | 'far';
      buttonsRemaining: number;
    }
  | {
      source: 'renderer';
      kind: 'modifier';
      key: 'ctrl' | 'shift' | 'alt';
      down: boolean;
    }
  | { source: 'renderer'; kind: 'double-click'; delivered: boolean }
  | { source: 'renderer'; kind: 'pointer-lock'; locked: boolean }
  | {
      source: 'renderer';
      kind: 'wheel';
      direction: 'up' | 'down' | 'left' | 'right';
      mode: 'pixel' | 'line' | 'page';
    }
  | {
      source: 'renderer';
      kind: 'release-all';
      cause: 'blur' | 'hidden' | 'command' | 'pagehide';
    }
  | {
      source: 'renderer';
      kind: 'gamepad';
      phase: 'connected' | 'disconnected' | 'button-down' | 'button-up' | 'axis';
      control?: number;
      direction?: -1 | 0 | 1;
    };

export type MainInputTraceEntry = Extract<
  InputTraceEntry,
  { source: 'appkit' | 'main' }
>;

export type InputTraceRecord = InputTraceEntry & {
  sequence: number;
  atMs: number;
  sinceMs: number | null;
};

export interface InputTrace {
  enabled(): boolean;
  paused(): boolean;
  /** Sets visibility explicitly so main and renderer cannot toggle out of sync. */
  setEnabled(enabled: boolean): void;
  record(entry: InputTraceEntry): void;
}
