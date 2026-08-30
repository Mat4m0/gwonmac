/**
 * Owns the one fixed character-switch transaction. Native invariants stay in
 * the certified game-thread actions; this controller owns only observed stage
 * progression, deadlines, and the private target-name lifetime.
 */
import type { CompanionCharacterListState } from "./companion-character-list-snapshot.js";
import type {
  CharacterSwitchActionState,
  CharacterSwitchFailureCode,
  CharacterSwitchSource,
} from "./character-switch-palette.js";
import {
  EMPTY_CHARACTER_SWITCH_USAGE,
  parseCharacterSwitchUsageDocument,
  type CharacterSwitchUsageDocument,
} from "../shared/character-switch-usage.js";

const ACTION = Object.freeze({ logout: 1, select: 2, play: 3 });
const PAYLOAD_BYTES = 40;
const RESULT_OFFSET = 20;
const TRANSITION_LIMIT = 32;
const SELECTOR_READY_BUDGET_MS = 8_000;
const SELECTOR_READY_POLL_MS = 100;

type Enqueue = (action: number, argument: number) => number;
type Configure = (payload: number, enabled: number) => number;
type NativeSend = "sent" | "refused" | "invalid" | "timeout" | "focus"
  | "selector-frame" | "selector-child" | "selector-index"
  | "selector-context" | "selector-target"
  | "selector-array"
  | "selection-unconfirmed" | "play-frame"
  | "selector-parent" | "play-parent";

type Transition = Readonly<{ sequence: number; stage: string; elapsedBucketMs: number }>;

const delay = (milliseconds = 25) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

const elapsedBucket = (started: number): number =>
  Math.min(60_000, Math.floor((performance.now() - started) / 250) * 250);

function accountSignature(state: Extract<CompanionCharacterListState, { status: "ready" }>): string {
  return state.characters.map(({ characterKey }) => characterKey).sort().join("");
}

export interface CharacterSwitchController extends CharacterSwitchSource {
  readonly payloadBytes: typeof PAYLOAD_BYTES;
  dispose(): void;
}

export function createCharacterSwitchController(options: Readonly<{
  memory: WebAssembly.Memory;
  payloadPointer: number;
  enqueue: Enqueue;
  configure: Configure;
  characters: CharacterListSource;
  controls: PreGameControls;
  buildId: number;
  programId: number;
}>): CharacterSwitchController {
  let action: CharacterSwitchActionState = Object.freeze({ status: "idle" });
  let usage: CharacterSwitchUsageDocument = EMPTY_CHARACTER_SWITCH_USAGE;
  let disposed = false;
  let requestSequence = 0;
  let actionSequence = 0;
  let lastCode: CharacterSwitchFailureCode | null = null;
  let lastSelectorReadiness: "frame" | "child" | "index" | "context" | "array" | "target" | null = null;
  let selectorReadinessRetries = 0;
  let lastSelectorProofMask = 0;
  let requestedListIndex: number | null = null;
  let started = 0;
  const counters = { logout: 0, select: 0, play: 0 };
  const transitions: Transition[] = [];
  const listeners = new Set<() => void>();

  void window.gwNative.characterSwitchUsage.get().then((value) => {
    if (disposed) return;
    usage = parseCharacterSwitchUsageDocument(value);
    emit();
  }).catch(() => { /* Ranking remains usable with an empty convenience store. */ });

  const emit = () => { for (const listener of listeners) listener(); };
  const transition = (stage: string) => {
    transitions.push(Object.freeze({
      sequence: actionSequence,
      stage,
      elapsedBucketMs: elapsedBucket(started),
    }));
    if (transitions.length > TRANSITION_LIMIT) transitions.shift();
  };
  const publish = (next: CharacterSwitchActionState, stage: string) => {
    action = Object.freeze(next);
    transition(stage);
    emit();
  };
  const fail = (code: CharacterSwitchFailureCode, retryable = false) => {
    lastCode = code;
    publish({ status: "failed", code, retryable }, `failed:${code}`);
  };
  const focused = () => !disposed && document.visibilityState === "visible"
    && document.hasFocus();
  const configure = () => options.configure(
    focused() ? options.payloadPointer : 0,
    focused() ? 1 : 0,
  );
  const view = () => new DataView(options.memory.buffer);
  const validPayload = () => options.payloadPointer > 0
    && options.payloadPointer + PAYLOAD_BYTES <= options.memory.buffer.byteLength;

  const waitFor = async (
    accept: () => boolean,
    timeoutMs: number,
    pollMilliseconds = 25,
  ): Promise<boolean> => {
    const deadline = performance.now() + timeoutMs;
    while (!disposed && performance.now() < deadline) {
      if (!focused()) return false;
      if (accept()) return true;
      await delay(pollMilliseconds);
    }
    return false;
  };

  const send = async (
    kind: keyof typeof counters,
    argument: number,
    timeoutMs: number,
  ): Promise<NativeSend> => {
    if (!validPayload() || !focused()) return "focus";
    configure();
    view().setUint32(options.payloadPointer + RESULT_OFFSET, 0, true);
    if (options.enqueue(ACTION[kind], argument) !== 1) return "refused";
    counters[kind] += 1;
    const settled = await waitFor(
      () => view().getUint32(options.payloadPointer + RESULT_OFFSET, true) !== 0,
      timeoutMs,
    );
    if (!settled) {
      options.configure(0, 0);
      return focused() ? "timeout" : "focus";
    }
    const result = view().getUint32(options.payloadPointer + RESULT_OFFSET, true);
    if (kind === "select") {
      lastSelectorProofMask = view().getUint32(options.payloadPointer + 36, true) & 0x7fffff;
    }
    if (result === 1) return "sent";
    if (result === 2) return "refused";
    const clickAlreadySent = kind === "select"
      && (lastSelectorProofMask & (1 << 10)) !== 0;
    if (result === 4) return clickAlreadySent ? "selection-unconfirmed" : "selector-frame";
    if (result === 5) return clickAlreadySent ? "selection-unconfirmed" : "selector-child";
    if (result === 6) return clickAlreadySent ? "selection-unconfirmed" : "selector-index";
    if (result === 7) return "selection-unconfirmed";
    if (result === 8) return "play-frame";
    if (result === 9) return "selector-parent";
    if (result === 10) return "play-parent";
    if (result === 11) return "selector-context";
    if (result === 12) return "selector-target";
    if (result === 13) return "selector-array";
    return "invalid";
  };

  const run = async (
    snapshotSequence: number,
    targetIndex: number,
    targetName: string,
    targetKey: string,
    initialSignature: string,
  ) => {
    window.dispatchEvent(new Event("gw:character-switch-claim"));
    publish({ status: "switching", stage: "logout" }, "logout:queued");
    const logout = await send("logout", 0, 2_000);
    if (logout !== "sent") {
      fail(logout === "focus" ? "focus-lost"
        : logout === "refused" ? "logout-refused"
          : logout === "invalid" ? "logout-invalid" : "logout-timeout");
      return;
    }
    publish({ status: "switching", stage: "selector" }, "logout:sent");
    const selectorSettled = await waitFor(() => {
      const state = options.characters.state;
      return state.status === "ready" && state.sequence !== snapshotSequence;
    }, 3_000, 50);
    if (!selectorSettled) {
      fail(focused() ? "selector-timeout" : "focus-lost");
      return;
    }
    const fresh = options.characters.state;
    if (fresh.status !== "ready" || accountSignature(fresh) !== initialSignature) {
      fail("target-missing");
      return;
    }
    const matches = fresh.characters
      .map(({ name }, index) => name === targetName ? index : -1)
      .filter((index) => index >= 0);
    if (matches.length !== 1 || fresh.sequence === snapshotSequence && matches[0] !== targetIndex) {
      fail("target-missing");
      return;
    }
    // The character array is published before Selector and its carousel child
    // finish construction. Results 4-6 are certified pre-click readiness
    // failures, so only those may be retried. A timeout or result 7 can follow
    // an ambiguous click and must stop without another native action.
    publish({ status: "switching", stage: "selector" }, "selector:list-ready");
    const selectorDeadline = performance.now() + SELECTOR_READY_BUDGET_MS;
    let selection: NativeSend = "selector-frame";
    while (performance.now() < selectorDeadline) {
      const settledList = options.characters.state;
      if (!focused()) { fail("focus-lost"); return; }
      if (settledList.status !== "ready" || accountSignature(settledList) !== initialSignature) {
        fail("target-missing");
        return;
      }
      selection = await send("select", matches[0]!, 4_000);
      if (selection !== "selector-frame"
        && selection !== "selector-child"
        && selection !== "selector-index"
        && selection !== "selector-context"
        && selection !== "selector-array"
        && selection !== "selector-target") {
        lastSelectorReadiness = null;
        break;
      }
      lastSelectorReadiness = selection === "selector-frame" ? "frame"
        : selection === "selector-child" ? "child"
          : selection === "selector-index" ? "index"
            : selection === "selector-context" ? "context"
              : selection === "selector-array" ? "array" : "target";
      selectorReadinessRetries += 1;
      transition(`selector:waiting-${lastSelectorReadiness}`);
      emit();
      await delay(SELECTOR_READY_POLL_MS);
    }
    if (selection !== "sent") {
      const readinessTimedOut = selection === "selector-frame"
        || selection === "selector-child"
        || selection === "selector-index"
        || selection === "selector-context"
        || selection === "selector-array"
        || selection === "selector-target";
      fail(selection === "selector-context" ? "selector-context-invalid"
        : selection === "selector-array" ? "selector-array-invalid"
          : selection === "selector-target" ? "selector-target-missing"
          : readinessTimedOut ? "selector-timeout"
        : selection === "focus" ? "focus-lost"
        : selection === "refused" ? "selector-refused"
          : selection === "selector-frame" ? "selector-frame-missing"
            : selection === "selector-child" ? "selector-child-missing"
              : selection === "selector-index" ? "selector-index-invalid"
                : selection === "selector-parent" ? "selector-parent-invalid"
                : selection === "selection-unconfirmed" ? "selection-not-confirmed"
          : selection === "invalid" ? "selector-invalid" : "selection-not-confirmed");
      return;
    }
    publish({ status: "switching", stage: "selection" }, "selection:confirmed");
    // Native reports success only after querying the Selector pane and proving
    // its selected index. The list's selected name describes the entered
    // character, so it must not be misused as carousel confirmation here.
    await delay(300);
    if (!focused()) { fail("focus-lost"); return; }
    publish({ status: "switching", stage: "play" }, "selection:sent");
    const play = await send("play", 0, 2_000);
    if (play !== "sent") {
      fail(play === "focus" ? "focus-lost"
        : play === "refused" ? "play-refused"
          : play === "play-frame" ? "play-frame-missing"
            : play === "play-parent" ? "play-parent-invalid"
          : play === "invalid" ? "play-invalid" : "play-timeout");
      return;
    }
    publish({ status: "switching", stage: "confirmation" }, "play:sent");
    const confirmed = await waitFor(() => {
      const state = options.characters.state;
      return options.controls.playable() === "outpost"
        && state.status === "ready"
        && state.selectedIndex !== null
        && state.characters[state.selectedIndex]?.name === targetName
        && state.characters[state.selectedIndex]?.characterKey === targetKey;
    }, 30_000);
    if (!confirmed) {
      fail(focused() ? "confirmation-timeout" : "focus-lost");
      return;
    }
    publish({ status: "complete" }, "confirmation:complete");
    void window.gwNative.characterSwitchUsage.record({ characterKey: targetKey }).then((value) => {
      if (disposed) return;
      usage = parseCharacterSwitchUsageDocument(value);
      emit();
    }).catch(() => { /* Switching succeeded; usage persistence is non-critical. */ });
  };

  const onFocusPolicyChanged = () => { configure(); };
  window.addEventListener("focus", onFocusPolicyChanged);
  window.addEventListener("blur", onFocusPolicyChanged);
  document.addEventListener("visibilitychange", onFocusPolicyChanged);
  configure();

  return Object.freeze({
    payloadBytes: PAYLOAD_BYTES,
    get characters() { return options.characters.state; },
    get action() { return action; },
    get usage() { return usage; },
    request(snapshotSequence: number, targetIndex: number) {
      if (action.status === "switching") return;
      const state = options.characters.state;
      if (state.status !== "ready") { fail("list-unavailable", true); return; }
      if (state.sequence !== snapshotSequence) { fail("stale-snapshot", true); return; }
      if (!Number.isInteger(targetIndex) || targetIndex < 0
        || targetIndex >= state.characters.length) { fail("target-missing", true); return; }
      if (state.selectedIndex === targetIndex) { fail("current-target"); return; }
      if (options.controls.playable() !== "outpost") { fail("not-outpost", true); return; }
      if (!focused()) { fail("focus-lost", true); return; }
      const targetName = state.characters[targetIndex]!.name;
      const targetKey = state.characters[targetIndex]!.characterKey;
      started = performance.now();
      requestSequence = snapshotSequence;
      actionSequence += 1;
      lastCode = null;
      lastSelectorReadiness = null;
      selectorReadinessRetries = 0;
      lastSelectorProofMask = 0;
      requestedListIndex = targetIndex;
      void run(snapshotSequence, targetIndex, targetName, targetKey, accountSignature(state));
    },
    reset() {
      if (action.status === "switching") return;
      action = Object.freeze({ status: "idle" });
      transition("idle:reset");
      emit();
    },
    diagnostics() {
      const state = options.characters.state;
      const characterCount = state.status === "ready" ? state.characters.length : 0;
      const observedIndex = validPayload()
        && (lastSelectorProofMask & (1 << 8)) !== 0
        ? view().getUint32(options.payloadPointer + 32, true)
        : null;
      return Object.freeze({
        version: 6,
        buildId: options.buildId >>> 0,
        programId: options.programId >>> 0,
        readerState: state.status,
        characterCount,
        preGameState: "not-read",
        preGameReadCount: 0,
        preGameReadBucketMs: 0,
        playability: options.controls.playable(),
        requestSequence: requestSequence >>> 0,
        actionSequence: actionSequence >>> 0,
        focused: focused(),
        policyEnabled: focused() && validPayload(),
        stage: action.stage ?? action.status,
        lastCode,
        elapsedBucketMs: started === 0 ? 0 : elapsedBucket(started),
        lastSelectorReadiness,
        selectorReadinessRetries: Math.min(selectorReadinessRetries, 100),
        lastSelectorProofMask,
        selectorClickProved: (lastSelectorProofMask & (1 << 10)) !== 0,
        selectorConfirmationProved: (lastSelectorProofMask & (1 << 11)) !== 0,
        selectorParentResolverProved: (lastSelectorProofMask & (1 << 13)) !== 0,
        selectorParentIdentityProved: (lastSelectorProofMask & (1 << 14)) !== 0,
        selectorParentProved: (lastSelectorProofMask & (1 << 16)) !== 0,
        selectorContextRowsProved: (lastSelectorProofMask & (1 << 17)) !== 0,
        selectorContextProved: (lastSelectorProofMask & (1 << 18)) !== 0,
        selectorContextIdentityProved: (lastSelectorProofMask & (1 << 19)) !== 0,
        selectorCharacterArrayProved: (lastSelectorProofMask & (1 << 20)) !== 0,
        selectorTargetProved: (lastSelectorProofMask & (1 << 21)) !== 0,
        selectorTargetPointerProved: (lastSelectorProofMask & (1 << 22)) !== 0,
        requestedListIndex,
        selectorObservedIndex: observedIndex !== null && observedIndex < characterCount
          ? observedIndex
          : null,
        lastFrameProofMask: validPayload()
          ? view().getUint32(options.payloadPointer + 36, true) & 0x7fffff
          : 0,
        counters: Object.freeze({ ...counters }),
        transitions: Object.freeze([...transitions]),
      });
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      listener();
      return () => { listeners.delete(listener); };
    },
    dispose() {
      disposed = true;
      options.configure(0, 0);
      window.removeEventListener("focus", onFocusPolicyChanged);
      window.removeEventListener("blur", onFocusPolicyChanged);
      document.removeEventListener("visibilitychange", onFocusPolicyChanged);
      listeners.clear();
    },
  });
}
