import type {
  AppUpdateErrorCode,
  AppUpdateState,
} from '../shared/contracts.js';

const FAILURE_MESSAGE: Record<AppUpdateErrorCode, string> = {
  'rate-limited':
    "Couldn't check — GitHub is refusing further requests from this network. Try again in an hour.",
  offline: "Couldn't check — GitHub could not be reached.",
  timeout: "Couldn't check — GitHub did not answer within five seconds.",
  server: "Couldn't check — GitHub reported an error.",
  unreadable: "Couldn't check — GitHub's answer could not be read.",
  'unsupported-build':
    "Couldn't check — this build's version is not on the release line.",
  // Plain words for a non-technical player: this copy (a development or
  // tester build) has no self-updater, and the fix is a download, not a fault.
  // The Releases link is shown beside this sentence — see `showReleaseNotes`.
  'updater-unavailable':
    "This version can't update itself — new versions are on the Releases page.",
  'feed-invalid':
    "Couldn't update — the release files did not pass validation.",
  'download-failed':
    "Couldn't download the update. Try checking again.",
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

export type UpdateActionView = {
  actionLabel: string;
  busy: boolean;
  message: string;
  lastChecked: string;
  currentVersion: string;
  channel: 'Stable' | 'Preview';
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
      return 'Checking for updates…';
    case 'up-to-date':
      return "You're on the latest version.";
    case 'downloading':
      return `Downloading version ${state.latestVersion}…`;
    case 'ready':
      return `Version ${state.latestVersion} is ready to install.`;
    case 'failed':
      return FAILURE_MESSAGE[state.reason];
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
    actionLabel: state.phase === 'checking' ? 'Checking…' : 'Check for Updates',
    busy: state.phase === 'checking' || running !== null,
    message: messageFor(state),
    lastChecked: formatLastChecked(checkedAt(state), now()),
    currentVersion: state.currentVersion,
    channel: /^\d+\.\d+\.\d+$/u.test(state.currentVersion)
      ? 'Stable'
      : 'Preview',
    // Also shown when this build cannot update itself: the message points at
    // the Releases page, so the link to it must be on the same surface.
    showReleaseNotes:
      state.phase === 'downloading' ||
      state.phase === 'ready' ||
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
  const settingsChannel = requiredElement(root, 'settings-update-channel');
  const compatibilityCheck = requiredButton(root, 'client-compat-check');
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
    launcherGet.textContent = view.ready ? 'Restart to Update' : 'Release Notes';
    launcherGet.hidden = !view.showReleaseNotes;

    settingsCheck.textContent = view.actionLabel;
    settingsCheck.disabled = view.busy;
    settingsStatus.textContent = view.message;
    settingsStatus.hidden = view.message === '';
    settingsWhen.textContent = view.lastChecked;
    settingsWhen.hidden = view.lastChecked === '';
    settingsVersion.textContent = view.currentVersion;
    settingsChannel.textContent = view.channel;
    settingsReleases.hidden = !view.showReleaseNotes;
    settingsRestart.hidden = !view.ready;

    compatibilityCheck.textContent = view.actionLabel;
    compatibilityCheck.disabled = view.busy;
    compatibilityStatus.textContent = view.message;
    compatibilityStatus.hidden = view.message === '';
  });

  const requestCheck = () => void action.check();
  launcherCheck.addEventListener('click', (event) => {
    event.preventDefault();
    requestCheck();
  });
  settingsCheck.addEventListener('click', requestCheck);
  compatibilityCheck.addEventListener('click', requestCheck);
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
