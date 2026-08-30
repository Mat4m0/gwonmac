/**
 * Owns one reload's automatic return from saved login to a playable character.
 * The classic host reports only the credential and account-token boundaries;
 * this controller owns input authority, certified-state progression, feedback,
 * expiry, and the single terminal diagnostic.
 */
import type {
  RendererMilestone,
  RendererMilestoneFieldsByName,
  RelogInputStage,
  RelogTerminalOutcome,
} from "../shared/diagnostics.js";
import {
  isRelogCharacterEntryState,
  isRelogPostCharacterState,
  relogOutcomeForPlayable,
} from "./relog-progression.js";

const AUTHORITY_BUDGET_MS = 30_000;
const STATUS_REVEAL_DELAY_MS = 350;

type RecordMilestone = <Name extends RendererMilestone>(
  name: Name,
  ...fields: Name extends keyof RendererMilestoneFieldsByName
    ? [RendererMilestoneFieldsByName[Name]]
    : []
) => void;

export type AutomaticCharacterReturn = Readonly<{
  savedCredentialsLoaded(): void;
  savedCredentialsUnavailable(): void;
  tokenRequested(request: XMLHttpRequest): void;
  clearStatus(): void;
  cancelForCharacterSwitch(): void;
  dispose(): void;
}>;

type ActiveRun = {
  ended: boolean;
  expiresAt: number;
  loginStarted: boolean;
  tokenAccepted: boolean;
  observedNonPlayable: boolean;
  lastStep: string;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
};

type Dependencies = Readonly<{
  claimIntent(): Promise<boolean>;
  input(): GameInputController | null;
  record: RecordMilestone;
}>;

const didAdvance = (outcome: AutomaticEnterOutcome): boolean =>
  outcome === "sent" || outcome === "physical" || outcome === "progressed";

const afterClientPaint = (): Promise<void> => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

const nextObservation = (): Promise<void> => new Promise((resolve) => {
  if (document.visibilityState === "visible") {
    requestAnimationFrame(() => resolve());
  } else {
    setTimeout(resolve, 25);
  }
});

export function installAutomaticCharacterReturn(
  dependencies: Dependencies,
): AutomaticCharacterReturn {
  let disposed = false;
  let run: ActiveRun | null = null;
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  let statusVisible = false;

  const cancelReveal = () => {
    if (revealTimer === null) return;
    clearTimeout(revealTimer);
    revealTimer = null;
  };

  const clearStatus = () => {
    cancelReveal();
    if (!statusVisible) return;
    statusVisible = false;
    const status = document.getElementById("login-status");
    if (status) status.hidden = true;
  };

  const showStatus = (text: string) => {
    cancelReveal();
    const status = document.getElementById("login-status");
    if (!status) return;
    statusVisible = true;
    status.textContent = text;
    status.hidden = false;
  };

  const deferStatus = (text: string) => {
    clearStatus();
    revealTimer = setTimeout(() => {
      revealTimer = null;
      showStatus(text);
    }, STATUS_REVEAL_DELAY_MS);
  };

  const isActive = (candidate: ActiveRun): boolean =>
    !disposed
    && run === candidate
    && !candidate.ended
    && performance.now() <= candidate.expiresAt;

  const finish = (
    candidate: ActiveRun,
    outcome: RelogTerminalOutcome,
  ): boolean => {
    if (candidate.ended || run !== candidate) return false;
    candidate.ended = true;
    if (candidate.deadlineTimer !== null) {
      clearTimeout(candidate.deadlineTimer);
      candidate.deadlineTimer = null;
    }
    dependencies.input()?.cancelAutomaticEnter();
    dependencies.record("relog.finished", { outcome });
    if (outcome === "timed-out") {
      showStatus(
        `Automatic return stopped while ${candidate.lastStep}. Press Return to continue.`,
      );
    } else {
      clearStatus();
    }
    return true;
  };

  const step = (
    candidate: ActiveRun,
    name:
      | "relog.intentClaimed"
      | "relog.savedCredentialsLoaded"
      | "relog.loginSubmitted"
      | "relog.tokenRequested"
      | "relog.tokenAccepted"
      | "relog.characterSubmitted",
    description: string,
    status: string,
  ) => {
    if (!isActive(candidate)) return;
    candidate.lastStep = description;
    dependencies.record(name);
    deferStatus(status);
  };

  const recordInput = (
    stage: RelogInputStage,
    outcome: AutomaticEnterOutcome,
  ) => dependencies.record("relog.inputSettled", { stage, outcome });

  const waitForFocus = async (candidate: ActiveRun): Promise<boolean> => {
    if (!isActive(candidate)) return false;
    if (document.hasFocus()) return true;
    return new Promise((resolve) => {
      const remaining = candidate.expiresAt - performance.now();
      if (remaining <= 0) {
        resolve(false);
        return;
      }
      const focused = () => settle(isActive(candidate));
      const timer = setTimeout(() => settle(false), remaining);
      const settle = (value: boolean) => {
        clearTimeout(timer);
        window.removeEventListener("focus", focused);
        resolve(value);
      };
      window.addEventListener("focus", focused, { once: true });
    });
  };

  const sendWhenFocused = async (
    candidate: ActiveRun,
    send: () => Promise<AutomaticEnterOutcome>,
  ): Promise<AutomaticEnterOutcome> => {
    while (isActive(candidate)) {
      if (!await waitForFocus(candidate) || !isActive(candidate)) {
        return "unfocused";
      }
      const outcome = await send();
      if (!isActive(candidate)) return "cancelled";
      if (outcome !== "unfocused" && (
        outcome !== "cancelled" || document.hasFocus()
      )) return outcome;
    }
    return "unfocused";
  };

  const observe = (candidate: ActiveRun) => {
    const controls = window.gwPreGameControls;
    const state = controls?.state() ?? "unknown";
    const playable = controls?.playable() ?? null;
    if (state !== "unknown" || playable === null) {
      candidate.observedNonPlayable = true;
    }
    return {
      state,
      playable,
      mask: controls?.diagnosticMask() ?? 0,
    };
  };

  const waitForProgress = async (
    candidate: ActiveRun,
    acceptsState: (state: PreGameState) => boolean,
    acceptsPlayable: boolean,
  ): Promise<Readonly<{
    state: PreGameState;
    playable: "outpost" | "explorable" | null;
  }> | null> => {
    let previousProbe = "";
    while (isActive(candidate)) {
      const observation = observe(candidate);
      const probe = `${observation.state}:${observation.mask}`;
      if (probe !== previousProbe) {
        previousProbe = probe;
        dependencies.record("relog.preGameProbe", {
          state: observation.state,
          mask: observation.mask,
        });
      }
      if (acceptsState(observation.state)) return observation;
      if (
        acceptsPlayable
        && candidate.observedNonPlayable
        && observation.state === "unknown"
        && observation.playable !== null
      ) return observation;
      await nextObservation();
    }
    return null;
  };

  const completeWhenPlayable = (
    candidate: ActiveRun,
    playable: "outpost" | "explorable" | null,
  ): boolean => {
    const outcome = relogOutcomeForPlayable(playable);
    return outcome !== null && finish(candidate, outcome);
  };

  const continueAfterToken = async (candidate: ActiveRun): Promise<void> => {
    const entry = await waitForProgress(
      candidate,
      isRelogCharacterEntryState,
      false,
    );
    if (!entry || !isActive(candidate)) return;

    const input = dependencies.input();
    const characterOutcome: AutomaticEnterOutcome = entry.state === "character-select"
      ? input
        ? await sendWhenFocused(candidate, () => input.playSelectedCharacter())
        : "cancelled"
      : "progressed";
    recordInput("character", characterOutcome);
    if (!didAdvance(characterOutcome) || !isActive(candidate)) {
      candidate.lastStep = characterOutcome === "unfocused"
        ? "waiting for the game window to regain focus"
        : "waiting at character selection";
      return;
    }

    step(
      candidate,
      "relog.characterSubmitted",
      "checking for a previous session",
      "Character selected. Restoring your session…",
    );
    const branch = entry.state === "reconnect"
      ? entry
      : await waitForProgress(candidate, isRelogPostCharacterState, true);
    if (!branch || !isActive(candidate)) return;
    if (completeWhenPlayable(candidate, branch.playable)) return;

    const restoreOutcome: AutomaticEnterOutcome = branch.state === "reconnect"
      ? input
        ? await sendWhenFocused(candidate, () => input.acceptReconnect())
        : "cancelled"
      : "progressed";
    recordInput("reconnect", restoreOutcome);
    if (!didAdvance(restoreOutcome) || !isActive(candidate)) {
      candidate.lastStep = restoreOutcome === "unfocused"
        ? "the reconnect window lost focus"
        : "waiting for session restoration";
      return;
    }

    candidate.lastStep = "waiting for the character to become playable";
    deferStatus("Guild Wars is loading your character…");
    const terminal = await waitForProgress(candidate, () => false, true);
    if (terminal) completeWhenPlayable(candidate, terminal.playable);
  };

  const intent = dependencies.claimIntent().then((armed) => {
    if (!armed || disposed) return null;
    const candidate: ActiveRun = {
      ended: false,
      expiresAt: performance.now() + AUTHORITY_BUDGET_MS,
      loginStarted: false,
      tokenAccepted: false,
      observedNonPlayable: false,
      lastStep: "waiting for saved login",
      deadlineTimer: null,
    };
    candidate.deadlineTimer = setTimeout(() => {
      finish(candidate, "timed-out");
    }, AUTHORITY_BUDGET_MS);
    run = candidate;
    step(
      candidate,
      "relog.intentClaimed",
      "waiting for saved login",
      "Reloaded. Waiting for saved login…",
    );
    return candidate;
  }).catch(() => null);

  const skip = (
    candidate: ActiveRun,
    reason: "saved-login-unavailable" | "pre-game-controls-unavailable",
  ) => {
    if (!isActive(candidate)) return;
    candidate.ended = true;
    if (candidate.deadlineTimer !== null) clearTimeout(candidate.deadlineTimer);
    candidate.deadlineTimer = null;
    dependencies.record("relog.skipped", { reason });
    clearStatus();
  };

  const savedCredentialsUnavailable = () => {
    void intent.then((candidate) => {
      if (candidate) skip(candidate, "saved-login-unavailable");
    });
  };

  const savedCredentialsLoaded = () => {
    void intent.then(async (candidate) => {
      if (!candidate || !isActive(candidate) || candidate.loginStarted) return;
      candidate.loginStarted = true;
      step(
        candidate,
        "relog.savedCredentialsLoaded",
        "preparing the login screen",
        "Saved login loaded. Signing in…",
      );
      await afterClientPaint();
      if (!isActive(candidate)) return;
      const input = dependencies.input();
      if (!input || !window.gwPreGameControls) {
        skip(candidate, "pre-game-controls-unavailable");
        return;
      }
      const outcome = await sendWhenFocused(
        candidate,
        () => input.submitSavedLogin(candidate.expiresAt),
      );
      recordInput("login", outcome);
      if (didAdvance(outcome) && isActive(candidate)) {
        step(
          candidate,
          "relog.loginSubmitted",
          "waiting for sign-in",
          "Sign-in submitted. Waiting for Guild Wars…",
        );
      } else if (isActive(candidate)) {
        candidate.lastStep = outcome === "unfocused"
          ? "waiting for the game window to regain focus"
          : "waiting at the login screen";
      }
    });
  };

  const tokenRequested = (request: XMLHttpRequest) => {
    void intent.then((candidate) => {
      if (!candidate || !isActive(candidate) || candidate.tokenAccepted) return;
      step(
        candidate,
        "relog.tokenRequested",
        "waiting for sign-in to finish",
        "Guild Wars is signing in…",
      );
      request.addEventListener("loadend", () => {
        if (
          !isActive(candidate)
          || candidate.tokenAccepted
          || request.status < 200
          || request.status >= 300
        ) return;
        candidate.tokenAccepted = true;
        step(
          candidate,
          "relog.tokenAccepted",
          "preparing character selection",
          "Signed in. Returning to your character…",
        );
        void continueAfterToken(candidate);
      }, { once: true });
    });
  };

  return Object.freeze({
    savedCredentialsLoaded,
    savedCredentialsUnavailable,
    tokenRequested,
    clearStatus,
    cancelForCharacterSwitch() {
      if (run && !run.ended) {
        run.ended = true;
        if (run.deadlineTimer !== null) clearTimeout(run.deadlineTimer);
        run.deadlineTimer = null;
        clearStatus();
      }
      dependencies.input()?.cancelAutomaticEnter();
    },
    dispose() {
      disposed = true;
      cancelReveal();
      if (run && !run.ended) {
        run.ended = true;
        if (run.deadlineTimer !== null) clearTimeout(run.deadlineTimer);
      }
      dependencies.input()?.cancelAutomaticEnter();
    },
  });
}
