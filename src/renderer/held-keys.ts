/**
 * The renderer keyboard ledger. It owns exact synthetic releases, the
 * privacy-safe evidence that a release found, or did not find, a held press,
 * and the test for a held modifier that a trusted event's flags prove is up.
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

/** The three modifiers Guild Wars tracks. Command is not one of them. */
export type HeldModifier = 'ctrl' | 'shift' | 'alt';

const MODIFIER_OF_CODE: Readonly<Record<string, HeldModifier>> = {
  ControlLeft: 'ctrl', ControlRight: 'ctrl',
  ShiftLeft: 'shift', ShiftRight: 'shift',
  AltLeft: 'alt', AltRight: 'alt',
};

/** The modifier a physical key code is, or undefined for any other key. */
export const modifierOfCode = (code: string): HeldModifier | undefined =>
  MODIFIER_OF_CODE[code];

/** The modifier flags a trusted keyboard or mouse event carries. */
export type ModifierFlags = Readonly<{
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}>;

const FLAG_OF_MODIFIER: Readonly<Record<HeldModifier, keyof ModifierFlags>> = {
  ctrl: 'ctrlKey', shift: 'shiftKey', alt: 'altKey',
};

/**
 * Held modifier presses the event proves are no longer down: the ledger holds
 * the key, but the trusted event's own flag for that modifier is false. A key-up
 * the game never received leaves exactly this state, and the game then reads
 * Control+A as Select All or a drag as Shift-split until a new press and
 * release clears it.
 */
export function staleModifiers(
  heldCodes: Iterable<string>,
  flags: ModifierFlags,
): { code: string; modifier: HeldModifier }[] {
  const stale: { code: string; modifier: HeldModifier }[] = [];
  for (const code of heldCodes) {
    const modifier = modifierOfCode(code);
    if (modifier !== undefined && !flags[FLAG_OF_MODIFIER[modifier]]) {
      stale.push({ code, modifier });
    }
  }
  return stale;
}

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

  /** Held modifiers that the event's own flags say are already up. */
  staleModifiers(flags: ModifierFlags): { code: string; modifier: HeldModifier }[] {
    return staleModifiers(this.#inputs.keys(), flags);
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
