/**
 * The update control as a player meets it: what the button says, what pressing
 * it does, and the sentence underneath.
 *
 * Every update failure becomes prose here. The main process sends a code; the
 * words live beside the surface that shows them, where a test can execute them
 * and where free text cannot escape onto a channel and into a diagnostics
 * export.
 *
 * The action's state machine is pure and kept apart from the DOM binding, so
 * what the button does is testable without a window.
 */
import type {
  AppUpdateErrorCode,
  AppUpdateState,
} from '../shared/contracts.js';
import { parseReleaseVersion } from '../shared/release.js';

const FAILURE_MESSAGE: Record<AppUpdateErrorCode, string> = {
  'rate-limited': 'The update service is busy. Try again later.',
  offline: "Couldn't check for updates. Check your internet connection and try again.",
  timeout: "Couldn't check for updates. Try again.",
  server: "Couldn't check for updates. Try again.",
  unreadable: "Couldn't check for updates. Try again.",
  'unsupported-build': "Couldn't check for updates. Try again.",
  // Plain words for a non-technical player: this copy (a development or
  // tester build) has no self-updater, and the fix is a download, not a fault.
  // The Releases link is shown beside this sentence — see `showReleaseNotes`.
  'updater-unavailable':
    'This version must be updated manually.',
  'feed-invalid':
    'The update could not be verified. Try again later.',
  'download-failed':
    "Couldn't download the update. Try again.",
};

const plural = (value: number, unit: string) =>
  `${value} ${unit}${value === 1 ? '' : 's'}`;

export function formatLastChecked(
  checkedAt: string | null | undefined,
  now: number,
): string {
  // "Never" is said out loud rather than hidden: it is the one network-free
  // nudge an opted-out player gets that updates exist to be checked for. An
  // unparseable timestamp is also "never" from the player's point of view.
  const value = Date.parse(checkedAt ?? '');
  if (Number.isNaN(value)) return 'Never checked for updates';
  const minutes = Math.floor(Math.max(0, now - value) / 60_000);
  if (minutes < 1) return 'Last checked just now';
  if (minutes < 60) return `Last checked ${plural(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last checked ${plural(hours, 'hour')} ago`;
  return `Last checked ${plural(Math.floor(hours / 24), 'day')} ago`;
}

export type LaunchGateDecision = 'hold' | 'install' | 'proceed';

/**
 * What the loading screen does with the updater's state before it starts the
 * game client: hold while the launch check or its download is in flight,
 * install a ready update before the outdated version gets a whole session,
 * and otherwise start the game. The off-path states never delay a launch —
 * idle is what checks-turned-off looks like, and a failed check has already
 * said everything it can.
 */
export function launchGateDecision(state: AppUpdateState): LaunchGateDecision {
  switch (state.phase) {
    case 'checking':
    case 'downloading':
      return 'hold';
    case 'ready':
      return 'install';
    case 'manual-stable-return':
    case 'idle':
    case 'up-to-date':
    case 'failed':
      return 'proceed';
  }
}

export type UpdateActionView = {
  actionLabel: string;
  busy: boolean;
  message: string;
  compatibilityMessage: string;
  lastChecked: string;
  currentVersion: string;
  installedStage: 'Stable' | 'Beta' | 'Release Candidate' | 'Alpha' | 'Unversioned';
  releasesLabel: string;
  showReleaseNotes: boolean;
  ready: boolean;
};

export type UpdateAction = {
  subscribe(listener: (view: UpdateActionView) => void): void;
  initialize(): Promise<void>;
  check(): Promise<void>;
  restartAndInstall(): Promise<void>;
};

type UpdateActionOptions = {
  getState(): Promise<AppUpdateState>;
  check(): Promise<void>;
  restartAndInstall(): Promise<void>;
  onState(listener: (state: AppUpdateState) => void): () => void;
  now?(): number;
};

function checkedAt(state: AppUpdateState): string | undefined {
  return 'checkedAt' in state ? state.checkedAt : state.lastCheckedAt;
}

function messageFor(state: AppUpdateState): string {
  switch (state.phase) {
    case 'idle':
      return '';
    case 'checking':
      return 'Checking for a GWonMac update…';
    case 'up-to-date':
      return 'GWonMac is up to date.';
    case 'downloading':
      return `Downloading GWonMac ${state.latestVersion}…`;
    case 'ready':
      return `GWonMac ${state.latestVersion} is ready. Restart to update.`;
    case 'manual-stable-return':
      return `Stable version ${state.stableVersion} is available. Returning to Stable requires a manual install.`;
    case 'failed':
      return FAILURE_MESSAGE[state.reason];
  }
}

function compatibilityMessageFor(state: AppUpdateState): string {
  if (state.phase === 'up-to-date') {
    return 'No GWonMac update is available yet.';
  }
  return messageFor(state);
}

function installedStage(version: string): UpdateActionView['installedStage'] {
  switch (parseReleaseVersion(version)?.channel) {
    case 'stable':
      return 'Stable';
    case 'beta':
      return 'Beta';
    case 'rc':
      return 'Release Candidate';
    case 'alpha':
      return 'Alpha';
    default:
      return 'Unversioned';
  }
}

export function createUpdateAction({
  getState,
  check,
  restartAndInstall,
  onState,
  now = () => Date.now(),
}: UpdateActionOptions): UpdateAction {
  let state: AppUpdateState = {
    phase: 'idle',
    currentVersion: '—',
  };
  let running: Promise<void> | null = null;
  let initialized = false;
  const listeners: Array<(view: UpdateActionView) => void> = [];

  const view = (): UpdateActionView => ({
    actionLabel: state.phase === 'checking' ? 'Checking…' : 'Check for updates',
    busy: state.phase === 'checking' || running !== null,
    message: messageFor(state),
    compatibilityMessage: compatibilityMessageFor(state),
    lastChecked: formatLastChecked(checkedAt(state), now()),
    currentVersion: state.currentVersion,
    installedStage: installedStage(state.currentVersion),
    releasesLabel: state.phase === 'manual-stable-return'
      ? 'Open Releases to Return to Stable…'
      : 'View Release Notes…',
    // Also shown when this build cannot update itself: the message points at
    // the Releases page, so the link to it must be on the same surface.
    showReleaseNotes:
      state.phase === 'downloading' ||
      state.phase === 'ready' ||
      state.phase === 'manual-stable-return' ||
      (state.phase === 'failed' && state.reason === 'updater-unavailable'),
    ready: state.phase === 'ready',
  });
  const publish = () => {
    const current = view();
    for (const listener of listeners) listener(current);
  };
  const setState = (next: AppUpdateState) => {
    state = next;
    publish();
  };

  return {
    subscribe(listener) {
      listeners.push(listener);
      listener(view());
    },
    async initialize() {
      if (initialized) return;
      initialized = true;
      let eventSeen = false;
      onState((next) => {
        eventSeen = true;
        setState(next);
      });
      const snapshot = await getState();
      if (!eventSeen) setState(snapshot);
    },
    check() {
      if (running) return running;
      const operation = check()
        .catch(() => {
          const lastCheckedAt = checkedAt(state);
          state = {
            phase: 'failed',
            currentVersion: state.currentVersion,
            ...(lastCheckedAt === undefined ? {} : { lastCheckedAt }),
            reason: 'updater-unavailable',
          };
        })
        .finally(() => {
          running = null;
          publish();
        });
      running = operation;
      publish();
      return operation;
    },
    restartAndInstall,
  };
}

function requiredElement(root: Document, id: string): HTMLElement {
  const node = root.getElementById(id);
  if (!node) throw new Error(`missing update element: ${id}`);
  return node;
}

function requiredButton(root: Document, id: string): HTMLButtonElement {
  return requiredElement(root, id) as HTMLButtonElement;
}

export function bindUpdateActionDom(
  root: Document,
  action: UpdateAction,
  openReleases: () => Promise<unknown>,
  restartApp: () => Promise<unknown> = () => Promise.resolve(),
) {
  const launcherCheck = requiredElement(root, 'loading-update-check');
  const launcherStatus = requiredElement(root, 'loading-update-status');
  const launcherWhen = requiredElement(root, 'loading-update-when');
  const launcherGet = requiredElement(root, 'loading-update-get');
  const settingsCheck = requiredButton(root, 'settings-check-updates');
  const settingsReleases = requiredElement(root, 'settings-open-releases');
  const settingsRestart = requiredButton(root, 'settings-restart-update');
  const settingsStatus = requiredElement(root, 'settings-update-status');
  const settingsWhen = requiredElement(root, 'settings-update-when');
  const settingsVersion = requiredElement(root, 'settings-update-version');
  const settingsStage = requiredElement(root, 'settings-update-stage');
  const compatibilityCheck = requiredButton(root, 'client-compat-check');
  const compatibilityRestart = requiredButton(root, 'client-compat-restart');
  const compatibilityReleases = requiredElement(root, 'client-compat-releases');
  const compatibilityStatus = requiredElement(root, 'client-compat-update');

  action.subscribe((view) => {
    launcherCheck.textContent = view.actionLabel;
    launcherStatus.textContent = view.message;
    launcherStatus.hidden = view.message === '';
    launcherWhen.textContent = view.lastChecked;
    // One line on the launcher: when there is a sentence, the sentence is the
    // news and the timestamp yields to it. Settings always shows both.
    launcherWhen.hidden = view.lastChecked === '' || view.message !== '';
    launcherGet.textContent = view.ready
      ? 'Restart to Update'
      : view.releasesLabel;
    launcherGet.hidden = !view.showReleaseNotes;

    settingsCheck.textContent = view.actionLabel;
    settingsCheck.disabled = view.busy;
    settingsStatus.textContent = view.message;
    settingsStatus.hidden = view.message === '';
    settingsWhen.textContent = view.lastChecked;
    settingsWhen.hidden = view.lastChecked === '';
    settingsVersion.textContent = view.currentVersion;
    settingsStage.textContent = view.installedStage;
    settingsReleases.textContent = view.releasesLabel;
    settingsReleases.hidden = !view.showReleaseNotes;
    settingsRestart.hidden = !view.ready;

    const retryPreparation = compatibilityCheck.dataset.recovery === 'restart';
    compatibilityCheck.textContent = retryPreparation
      ? 'Restart GWonMac'
      : view.actionLabel;
    compatibilityCheck.disabled = retryPreparation ? false : view.busy;
    compatibilityStatus.textContent = retryPreparation
      ? ''
      : view.compatibilityMessage;
    compatibilityStatus.hidden = retryPreparation || view.compatibilityMessage === '';
  });

  const requestCheck = () => void action.check();
  launcherCheck.addEventListener('click', (event) => {
    event.preventDefault();
    requestCheck();
  });
  settingsCheck.addEventListener('click', requestCheck);
  compatibilityCheck.addEventListener('click', () => {
    if (compatibilityCheck.dataset.recovery === 'restart') {
      compatibilityCheck.disabled = true;
      void restartApp();
      return;
    }
    requestCheck();
  });
  compatibilityRestart.addEventListener('click', () => {
    compatibilityRestart.disabled = true;
    void restartApp();
  });
  settingsRestart.addEventListener('click', () => {
    void action.restartAndInstall();
  });
  launcherGet.addEventListener('click', (event) => {
    if (!settingsRestart.hidden) {
      event.preventDefault();
      void action.restartAndInstall();
    }
  });
  settingsReleases.addEventListener('click', () => void openReleases());
  compatibilityReleases.addEventListener('click', () => void openReleases());
}
