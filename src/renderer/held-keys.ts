/**
 * The renderer keyboard ledger. It owns exact synthetic releases and the
 * privacy-safe evidence that a release found, or did not find, a held press.
 */
import type {
  InputTrace,
  InputTraceKeyKind,
  InputTraceOwner,
} from '../shared/input-trace.js';

/** A trusted press retained exactly for a synthetic release at its target. */
export type HeldKey = {
  target: EventTarget | null;
  key: string;
  code: string;
  location: number;
  charCode: number;
  keyCode: number;
  which: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

export const isMovementKey = (code: string): boolean =>
  /^Key[WASD]$/u.test(code);

const tracedKeyKind = (code: string): InputTraceKeyKind => {
  if (isMovementKey(code)) return 'movement';
  if (/^(?:Meta|Control|Shift|Alt)(?:Left|Right)$/u.test(code)) return 'modifier';
  if (/^(?:ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Tab)$/u.test(code)) {
    return 'navigation';
  }
  if (/^(?:Backspace|Delete|Enter|Escape)$/u.test(code)) return 'editing';
  if (/^(?:Key[A-Z]|Digit[0-9])$/u.test(code)) return 'printable';
  return 'other';
};

export const dispatchHeldKeyRelease = (input: HeldKey) => {
  const release = new globalThis.KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    key: input.key,
    code: input.code,
    location: input.location,
    ctrlKey: input.ctrlKey,
    shiftKey: input.shiftKey,
    altKey: input.altKey,
    metaKey: input.metaKey,
  });
  // ArenaNet's Emscripten bridge still marshals these read-only legacy fields.
  // Shadow their prototype getters with the exact values from the press.
  Object.defineProperties(release, {
    charCode: { value: input.charCode },
    keyCode: { value: input.keyCode },
    which: { value: input.which },
  });
  input.target?.dispatchEvent(release);
};

export class HeldKeys {
  readonly #inputs = new Map<string, HeldKey>();
  readonly #trace: InputTrace | undefined;
  readonly #owner: (target: EventTarget | null) => InputTraceOwner;

  constructor(
    trace: InputTrace | undefined,
    owner: (target: EventTarget | null) => InputTraceOwner,
  ) {
    this.#trace = trace;
    this.#owner = owner;
  }

  get hasInputs(): boolean {
    return this.#inputs.size > 0;
  }

  get(code: string): HeldKey | undefined {
    return this.#inputs.get(code);
  }

  hold(input: HeldKey): void {
    this.#inputs.set(input.code, input);
  }

  take(code: string): HeldKey | undefined {
    const input = this.#inputs.get(code);
    this.#inputs.delete(code);
    return input;
  }

  release(
    matches: (code: string, input: HeldKey) => boolean = () => true,
  ): void {
    const inputs = [...this.#inputs.entries()].filter(([code, input]) =>
      matches(code, input));
    for (const [code] of inputs) this.#inputs.delete(code);
    for (const [, input] of inputs) dispatchHeldKeyRelease(input);
  }

  releaseNormalized(code: string): void {
    const input = this.take(code);
    if (!input) {
      this.#trace?.record({
        source: 'renderer', kind: 'normalized-release',
        key: tracedKeyKind(code), released: false,
      });
      return;
    }
    const owner = this.#owner(input.target);
    this.#trace?.record(owner === 'canvas'
      ? {
          source: 'renderer', kind: 'normalized-release', owner,
          code, key: tracedKeyKind(code), released: true,
        }
      : {
          source: 'renderer', kind: 'normalized-release', owner,
          key: tracedKeyKind(code), released: true,
        });
    dispatchHeldKeyRelease(input);
  }

  traceState(): void {
    if (!this.hasInputs) {
      this.#trace?.record({ source: 'renderer', kind: 'held-state', owner: 'none' });
      return;
    }
    for (const [code, input] of this.#inputs) {
      const owner = this.#owner(input.target);
      this.#trace?.record(owner === 'canvas'
        ? { source: 'renderer', kind: 'held-state', owner, code }
        : { source: 'renderer', kind: 'held-state', owner });
    }
  }
}
