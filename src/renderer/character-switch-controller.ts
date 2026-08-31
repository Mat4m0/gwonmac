/**
 * Owns the one fixed character-switch transaction. Native invariants stay in
 * the certified game-thread actions; this controller owns only observed stage
 * progression, deadlines, and the private target-name lifetime.
 */
import type { CompanionCharacterListState } from "./companion-character-list-snapshot.js";
import type {
  CharacterSwitchActionState,
  CharacterSwitchDiagnosticTransition,
  CharacterSwitchFailureCode,
  CharacterSwitchSource,
  CharacterSwitchTransitionStage,
} from "./character-switch-model.js";
import {
  CHARACTER_SWITCH_ACTION_ABI,
  type CharacterSwitchActionKind,
} from "../shared/character-switch-action-abi.js";
import {
  EMPTY_CHARACTER_SWITCH_USAGE,
  parseCharacterSwitchUsageDocument,
  type CharacterSwitchUsageDocument,
} from "../shared/character-switch-usage.js";

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
type NativeEnqueue = NativeSend | "queued";

type SelectorReadiness = "frame" | "child" | "index" | "context" | "array" | "target";
type SelectorOutcome =
  | Readonly<{ kind: "sent" }>
  | Readonly<{
      kind: "retryable";
      readiness: SelectorReadiness;
      terminalCode: CharacterSwitchFailureCode;
    }>
  | Readonly<{ kind: "terminal"; code: CharacterSwitchFailureCode }>;

function classifySelectorResult(result: NativeSend): SelectorOutcome {
  switch (result) {
    case "sent": return { kind: "sent" };
    case "selector-frame": return {
      kind: "retryable", readiness: "frame", terminalCode: "selector-timeout",
    };
    case "selector-child": return {
      kind: "retryable", readiness: "child", terminalCode: "selector-timeout",
    };
    case "selector-index": return {
      kind: "retryable", readiness: "index", terminalCode: "selector-timeout",
    };
    case "selector-context": return {
      kind: "retryable", readiness: "context", terminalCode: "selector-context-invalid",
    };
    case "selector-array": return {
      kind: "retryable", readiness: "array", terminalCode: "selector-array-invalid",
    };
    case "selector-target": return {
      kind: "retryable", readiness: "target", terminalCode: "selector-target-missing",
    };
    case "focus": return { kind: "terminal", code: "focus-lost" };
    case "refused": return { kind: "terminal", code: "selector-refused" };
    case "invalid": return { kind: "terminal", code: "selector-invalid" };
    case "selector-parent": return { kind: "terminal", code: "selector-parent-invalid" };
    case "selection-unconfirmed": return {
      kind: "terminal", code: "selection-not-confirmed",
    };
    case "timeout":
    case "play-frame":
    case "play-parent": return { kind: "terminal", code: "selection-not-confirmed" };
  }
}

const delay = (milliseconds = 25) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

const elapsedBucket = (started: number): number =>
  Math.min(60_000, Math.floor((performance.now() - started) / 250) * 250);

function accountSignature(state: Extract<CompanionCharacterListState, { status: "ready" }>): string {
  return state.characters.map(({ characterKey }) => characterKey).sort().join("");
}

export interface CharacterSwitchController extends CharacterSwitchSource {
  readonly payloadBytes: typeof CHARACTER_SWITCH_ACTION_ABI.bytes;
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
  let lastSelectorReadiness: SelectorReadiness | null = null;
  let selectorReadinessRetries = 0;
  let lastSelectorProofMask = 0;
  let requestedListIndex: number | null = null;
  let started = 0;
  const counters = { logout: 0, select: 0, play: 0 };
  const transitions: CharacterSwitchDiagnosticTransition[] = [];
  let pendingCharacterKey: string | null = null;
  const listeners = new Set<() => void>();

  void window.gwNative.characterSwitchUsage.get().then((value) => {
    if (disposed) return;
    usage = parseCharacterSwitchUsageDocument(value);
    emit();
  }).catch(() => { /* Ranking remains usable with an empty convenience store. */ });

  const emit = () => { for (const listener of listeners) listener(); };
  const transition = (stage: CharacterSwitchTransitionStage) => {
    transitions.push(Object.freeze({
      sequence: actionSequence,
      stage,
      elapsedBucketMs: elapsedBucket(started),
    }));
    if (transitions.length > TRANSITION_LIMIT) transitions.shift();
  };
  const publish = (next: CharacterSwitchActionState, stage: CharacterSwitchTransitionStage) => {
    action = Object.freeze(next);
    transition(stage);
    emit();
  };
  const fail = (code: CharacterSwitchFailureCode, retryable = false) => {
    pendingCharacterKey = null;
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
    && options.payloadPointer + CHARACTER_SWITCH_ACTION_ABI.bytes
      <= options.memory.buffer.byteLength;

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

  const queue = (
    kind: CharacterSwitchActionKind,
    argument: number,
  ): NativeEnqueue => {
    if (!validPayload() || !focused()) return "focus";
    configure();
    view().setUint32(
      options.payloadPointer + CHARACTER_SWITCH_ACTION_ABI.fields.result,
      0,
      true,
    );
    if (options.enqueue(CHARACTER_SWITCH_ACTION_ABI.action[kind], argument) !== 1) {
      return "refused";
    }
    counters[kind] += 1;
    return "queued";
  };

  const settle = async (
    kind: CharacterSwitchActionKind,
    timeoutMs: number,
  ): Promise<NativeSend> => {
    const settled = await waitFor(
      () => view().getUint32(
        options.payloadPointer + CHARACTER_SWITCH_ACTION_ABI.fields.result,
        true,
      ) !== 0,
      timeoutMs,
    );
    if (!settled) {
      options.configure(0, 0);
      return focused() ? "timeout" : "focus";
    }
    const result = view().getUint32(
      options.payloadPointer + CHARACTER_SWITCH_ACTION_ABI.fields.result,
      true,
    );
    if (kind === "select") {
      lastSelectorProofMask = view().getUint32(
        options.payloadPointer + CHARACTER_SWITCH_ACTION_ABI.fields.proofMask,
        true,
      ) & 0x7fffff;
    }
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.sent) return "sent";
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.refused) return "refused";
    const clickAlreadySent = kind === "select"
      && (lastSelectorProofMask
        & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.clickSent)) !== 0;
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.selectorFrame) {
      return clickAlreadySent ? "selection-unconfirmed" : "selector-frame";
    }
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.selectorChild) {
      return clickAlreadySent ? "selection-unconfirmed" : "selector-child";
    }
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.selectorIndex) {
      return clickAlreadySent ? "selection-unconfirmed" : "selector-index";
    }
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.selectionUnconfirmed) {
      return "selection-unconfirmed";
    }
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.playFrame) return "play-frame";
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.selectorParent) return "selector-parent";
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.playParent) return "play-parent";
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.selectorContext) return "selector-context";
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.selectorTarget) return "selector-target";
    if (result === CHARACTER_SWITCH_ACTION_ABI.result.selectorArray) return "selector-array";
    return "invalid";
  };

  const send = async (
    kind: CharacterSwitchActionKind,
    argument: number,
    timeoutMs: number,
  ): Promise<NativeSend> => {
    const queued = queue(kind, argument);
    return queued === "queued" ? settle(kind, timeoutMs) : queued;
  };

  const run = async (
    snapshotSequence: number,
    targetName: string,
    targetKey: string,
    initialSignature: string,
  ) => {
    window.dispatchEvent(new Event("gw:character-switch-claim"));
    publish({ status: "switching", stage: "logout" }, "logout:queued");
    const logout = await settle("logout", 2_000);
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
    if (matches.length !== 1) {
      fail("target-missing");
      return;
    }
    // The character array is published before Selector and its carousel child
    // finish construction. Results 4-6 are certified pre-click readiness
    // failures, so only those may be retried. A timeout or result 7 can follow
    // an ambiguous click and must stop without another native action.
    publish({ status: "switching", stage: "selector" }, "selector:list-ready");
    const selectorDeadline = performance.now() + SELECTOR_READY_BUDGET_MS;
    let selection: SelectorOutcome = classifySelectorResult("selector-frame");
    while (performance.now() < selectorDeadline) {
      const settledList = options.characters.state;
      if (!focused()) { fail("focus-lost"); return; }
      if (settledList.status !== "ready" || accountSignature(settledList) !== initialSignature) {
        fail("target-missing");
        return;
      }
      selection = classifySelectorResult(await send("select", matches[0]!, 4_000));
      if (selection.kind !== "retryable") {
        lastSelectorReadiness = null;
        break;
      }
      lastSelectorReadiness = selection.readiness;
      selectorReadinessRetries += 1;
      transition(`selector:waiting-${lastSelectorReadiness}`);
      emit();
      await delay(SELECTOR_READY_POLL_MS);
    }
    if (selection.kind !== "sent") {
      fail(selection.kind === "retryable" ? selection.terminalCode : selection.code);
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
      return options.controls.switchContext() === "outpost"
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

  const start = (characterKey: string, confirmedExplorable: boolean) => {
    if (action.status === "switching" || (action.status === "confirming" && !confirmedExplorable)) {
      return;
    }
    const state = options.characters.state;
    if (state.status !== "ready") { fail("list-unavailable", true); return; }
    const matches = state.characters
      .map((character, index) => character.characterKey === characterKey ? index : -1)
      .filter((index) => index >= 0);
    if (matches.length !== 1) { fail("target-missing", true); return; }
    const targetIndex = matches[0]!;
    if (state.selectedIndex === targetIndex) { fail("current-target"); return; }
    const context = options.controls.switchContext();
    if (context === "pvp-explorable") { fail("active-pvp"); return; }
    if (context === "loading") { fail("game-loading", true); return; }
    if (context === "character-select") { fail("character-select"); return; }
    if (context === "unavailable") { fail("state-unavailable", true); return; }
    if (context === "pve-explorable" && !confirmedExplorable) {
      pendingCharacterKey = characterKey;
      publish({ status: "confirming" }, "confirmation:required");
      return;
    }
    if (!focused()) { fail("focus-lost", true); return; }
    const targetName = state.characters[targetIndex]!.name;
    started = performance.now();
    requestSequence = state.sequence;
    actionSequence += 1;
    lastCode = null;
    lastSelectorReadiness = null;
    selectorReadinessRetries = 0;
    lastSelectorProofMask = 0;
    requestedListIndex = targetIndex;
    pendingCharacterKey = null;
    const drainContext = options.controls.switchContext();
    if (drainContext !== "outpost"
      && !(confirmedExplorable && drainContext === "pve-explorable")) {
      fail(drainContext === "pvp-explorable" ? "active-pvp"
        : drainContext === "loading" ? "game-loading" : "logout-refused");
      return;
    }
    const logout = queue("logout", 0);
    if (logout !== "queued") {
      fail(logout === "focus" ? "focus-lost" : "logout-refused");
      return;
    }
    void run(
      state.sequence,
      targetName,
      characterKey,
      accountSignature(state),
    );
  };

  const onFocusPolicyChanged = () => { configure(); };
  window.addEventListener("focus", onFocusPolicyChanged);
  window.addEventListener("blur", onFocusPolicyChanged);
  document.addEventListener("visibilitychange", onFocusPolicyChanged);
  configure();

  return Object.freeze({
    payloadBytes: CHARACTER_SWITCH_ACTION_ABI.bytes,
    get characters() { return options.characters.state; },
    get action() { return action; },
    get usage() { return usage; },
    get context() { return options.controls.switchContext(); },
    request(characterKey: string) { start(characterKey, false); },
    confirm() {
      if (action.status !== "confirming" || pendingCharacterKey === null) return;
      const characterKey = pendingCharacterKey;
      pendingCharacterKey = null;
      start(characterKey, true);
    },
    cancelConfirmation() {
      if (action.status !== "confirming") return;
      pendingCharacterKey = null;
      action = Object.freeze({ status: "idle" });
      transition("confirmation:cancelled");
      emit();
    },
    reset() {
      if (action.status === "switching") return;
      pendingCharacterKey = null;
      action = Object.freeze({ status: "idle" });
      transition("idle:reset");
      emit();
    },
    diagnostics() {
      const state = options.characters.state;
      const characterCount = state.status === "ready" ? state.characters.length : 0;
      const observedIndex = validPayload()
        && (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.selectedIndexRead)) !== 0
        ? view().getUint32(
            options.payloadPointer + CHARACTER_SWITCH_ACTION_ABI.fields.selectedIndex,
            true,
          )
        : null;
      return Object.freeze({
        version: 7,
        buildId: options.buildId >>> 0,
        programId: options.programId >>> 0,
        readerState: state.status,
        characterCount,
        preGameState: "not-read",
        preGameReadCount: 0,
        preGameReadBucketMs: 0,
        playability: options.controls.switchContext(),
        requestSequence: requestSequence >>> 0,
        actionSequence: actionSequence >>> 0,
        focused: focused(),
        policyEnabled: focused() && validPayload(),
        stage: "stage" in action ? action.stage : action.status,
        lastCode,
        elapsedBucketMs: started === 0 ? 0 : elapsedBucket(started),
        lastSelectorReadiness,
        selectorReadinessRetries: Math.min(selectorReadinessRetries, 100),
        lastSelectorProofMask,
        selectorClickProved: (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.clickSent)) !== 0,
        selectorConfirmationProved: (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.selectionConfirmed)) !== 0,
        selectorParentResolverProved: (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.parentPointer)) !== 0,
        selectorParentIdentityProved: (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.parentIdentity)) !== 0,
        selectorParentProved: (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.parentValidated)) !== 0,
        selectorContextRowsProved: (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.contextRows)) !== 0,
        selectorContextProved: (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.contextFound)) !== 0,
        selectorContextIdentityProved: (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.contextIdentity)) !== 0,
        selectorCharacterArrayProved: (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.characterArray)) !== 0,
        selectorTargetProved: (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.targetResolved)) !== 0,
        selectorTargetPointerProved: (lastSelectorProofMask
          & (1 << CHARACTER_SWITCH_ACTION_ABI.proof.targetPointer)) !== 0,
        requestedListIndex,
        selectorObservedIndex: observedIndex !== null && observedIndex < characterCount
          ? observedIndex
          : null,
        lastFrameProofMask: validPayload()
          ? view().getUint32(
              options.payloadPointer + CHARACTER_SWITCH_ACTION_ABI.fields.proofMask,
              true,
            ) & 0x7fffff
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
