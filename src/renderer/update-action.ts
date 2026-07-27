// The renderer half of "is there a newer release of this app?".
//
// The state and the concrete DOM binding live together here. The three answers
// must never collapse into two, and every launcher/settings/compatibility
// surface must show the same request and result. `settings.ts` supplies the
// native actions and persistence; this module owns how that one action appears.

import type {
  ReleaseCheckFailure,
  ReleaseNotice,
} from '../shared/contracts.js';

/**
 * One sentence per failure reason, keyed by the closed vocabulary so that a
 * reason added to the contract fails `tsc` here instead of rendering as a
 * blank line. "Couldn't check" never says "up to date": that conflation is the
 * quiet lie this whole path exists to remove.
 */
const FAILURE_MESSAGE: Record<ReleaseCheckFailure, string> = {
  'rate-limited':
    "Couldn't check — GitHub is refusing further requests from this network. Try again in an hour.",
  offline: "Couldn't check — GitHub could not be reached.",
  timeout: "Couldn't check — GitHub did not answer within five seconds.",
  server: "Couldn't check — GitHub reported an error.",
  unreadable: "Couldn't check — GitHub's answer could not be read.",
  'unsupported-build':
    "Couldn't check — this build's version is not on the release line.",
};

// The bridge resolves for every network outcome, so a rejection means the
// check could not be run at all. That is still not "up to date".
const UNAVAILABLE_MESSAGE = "Couldn't check — the update check could not run.";

export function describeReleaseNotice(notice: ReleaseNotice): string {
  if (notice.state === 'update-available') {
    return `Version ${notice.latestVersion} is available.`;
  }
  if (notice.state === 'up-to-date') return "You're on the latest version.";
  return FAILURE_MESSAGE[notice.reason];
}

const plural = (value: number, unit: string) =>
  `${value} ${unit}${value === 1 ? '' : 's'}`;

/**
 * When a release check was last attempted. Empty string means never, which is
 * the state that `unknown` would otherwise be indistinguishable from.
 *
 * `checkedAt` and `now` are both epoch milliseconds; a null `checkedAt` means
 * no check has ever completed.
 */
export function formatLastChecked(
  checkedAt: number | null,
  now: number,
): string {
  if (checkedAt === null) return '';
  // A profile can travel between machines whose clocks disagree; a negative
  // age is reported as "just now" rather than as a time in the future.
  const minutes = Math.floor(Math.max(0, now - checkedAt) / 60_000);
  if (minutes < 1) return 'Last checked just now';
  if (minutes < 60) return `Last checked ${plural(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last checked ${plural(hours, 'hour')} ago`;
  return `Last checked ${plural(Math.floor(hours / 24), 'day')} ago`;
}

export type UpdateActionView = {
  /** Label for the control that starts a check. */
  actionLabel: string;
  /** A check is in flight; starting another does nothing. */
  busy: boolean;
  /** The answer, or '' before the first one arrives. */
  message: string;
  /** '' until a release check has completed once. */
  lastChecked: string;
  /** Whether to offer the releases page. */
  updateAvailable: boolean;
};

export type UpdateAction = {
  subscribe(listener: (view: UpdateActionView) => void): void;
  restore(checkedAt: number | null): void;
  check(): Promise<void>;
};

type UpdateActionOptions = {
  /** Asks the main process. */
  check(): Promise<ReleaseNotice>;
  /** Persists the timestamp, so "never checked" survives a relaunch. */
  remember(checkedAt: number): Promise<unknown>;
  now?(): number;
};

export function createUpdateAction({
  check,
  remember,
  now = () => Date.now(),
}: UpdateActionOptions): UpdateAction {
  let result: ReleaseNotice | 'unavailable' | null = null;
  let lastCheckedAt: number | null = null;
  let running: Promise<void> | null = null;
  const listeners: ((view: UpdateActionView) => void)[] = [];

  function view(): UpdateActionView {
    const notice = result === null || result === 'unavailable' ? null : result;
    return {
      actionLabel: running ? 'Checking…' : 'Check for Updates',
      busy: running !== null,
      message:
        result === null
          ? ''
          : notice === null
            ? UNAVAILABLE_MESSAGE
            : describeReleaseNotice(notice),
      lastChecked: formatLastChecked(lastCheckedAt, now()),
      updateAvailable: notice?.state === 'update-available',
    };
  }

  function publish() {
    const current = view();
    for (const listener of listeners) listener(current);
  }

  return {
    subscribe(listener) {
      listeners.push(listener);
      listener(view());
    },

    /**
     * The settings file owns this value; this is where it is read back in.
     * Re-publishing also re-renders a relative time that went stale while a
     * surface sat open.
     */
    restore(checkedAt) {
      lastCheckedAt = checkedAt;
      publish();
    },

    check() {
      if (running) return running;
      // `check()` is invoked synchronously — a second ask must not become a
      // second request — but its outcome is normalised to a promise before
      // anything awaits it. A synchronous throw (a missing bridge property,
      // an `invoke` that raises before returning) would otherwise run the
      // `finally` below *before* `running = operation` on the way out, and
      // the action would stay "Checking…" and busy for the whole session.
      const request = (async () => check())();
      const operation = (async () => {
        try {
          const notice = await request;
          result = notice;
          // Every result carries `checkedAt`, including the failures: the
          // timestamp records the check attempt, not a successful request.
          // A cached answer keeps its original time, so repeated clicks do not
          // claim that another check ran.
          lastCheckedAt = notice.checkedAt;
          try {
            await remember(notice.checkedAt);
          } catch {
            // A settings write that fails must not discard the answer.
          }
        } catch {
          result = 'unavailable';
        } finally {
          running = null;
          publish();
        }
      })();
      running = operation;
      publish();
      return operation;
    },
  };
}

function requiredElement(root: Document, id: string): HTMLElement {
  const node = root.getElementById(id);
  if (!node) throw new Error(`missing update element: ${id}`);
  return node;
}

/**
 * The two controls whose `disabled` this module writes. index.html declares
 * both as `<button>`; the assertion narrows to the property that needs it and
 * nothing else, so the other nine ids stay plain elements.
 */
function requiredButton(root: Document, id: string): HTMLButtonElement {
  return requiredElement(root, id) as HTMLButtonElement;
}

/**
 * Bind the one update action to its three fixed surfaces. Static structure
 * belongs in index.html; the synchronized state and clicks belong here.
 */
export function bindUpdateActionDom(
  root: Document,
  action: UpdateAction,
  openReleases: () => Promise<unknown>,
) {
  const launcherCheck = requiredElement(root, 'loading-update-check');
  const launcherStatus = requiredElement(root, 'loading-update-status');
  const launcherWhen = requiredElement(root, 'loading-update-when');
  const launcherGet = requiredElement(root, 'loading-update-get');
  const settingsCheck = requiredButton(root, 'settings-check-updates');
  const settingsReleases = requiredElement(root, 'settings-open-releases');
  const settingsStatus = requiredElement(root, 'settings-update-status');
  const settingsWhen = requiredElement(root, 'settings-update-when');
  const compatibilityCheck = requiredButton(root, 'client-compat-check');
  const compatibilityReleases = requiredElement(root, 'client-compat-releases');
  const compatibilityStatus = requiredElement(root, 'client-compat-update');

  action.subscribe((view) => {
    launcherCheck.textContent = view.actionLabel;
    launcherStatus.textContent = view.message;
    launcherStatus.hidden = view.message === '';
    launcherWhen.textContent = view.lastChecked;
    launcherWhen.hidden = view.lastChecked === '';
    launcherGet.hidden = !view.updateAvailable;

    settingsCheck.textContent = view.actionLabel;
    settingsCheck.disabled = view.busy;
    settingsStatus.textContent = view.message;
    settingsStatus.hidden = view.message === '';
    settingsWhen.textContent = view.lastChecked;
    settingsWhen.hidden = view.lastChecked === '';
    settingsReleases.hidden = !view.updateAvailable;

    compatibilityCheck.textContent = view.actionLabel;
    compatibilityCheck.disabled = view.busy;
    compatibilityStatus.textContent = view.message;
    compatibilityStatus.hidden = view.message === '';
  });

  const check = () => {
    void action.check();
  };
  launcherCheck.addEventListener('click', (event) => {
    event.preventDefault();
    check();
  });
  settingsCheck.addEventListener('click', check);
  compatibilityCheck.addEventListener('click', check);
  settingsReleases.addEventListener('click', () => {
    void openReleases();
  });
  compatibilityReleases.addEventListener('click', () => {
    void openReleases();
  });
}
