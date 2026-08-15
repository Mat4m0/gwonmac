/**
 * What the player is told about the client build this session is running.
 *
 * The pure report below owns every compatibility sentence. The concrete DOM
 * binding at the end renders that same report in the launcher and Settings and
 * owns the notice acknowledgement. Certification gaps require a new release;
 * a runtime preparation failure is retryable and says so.
 */

import type {
  ClientCompatibility,
  ClientSession,
} from '../shared/contracts.js';

export type CompatibilityReport = {
  degraded: boolean;
  /** Game-update notices may be acknowledged per build; failures retry. */
  acknowledgePerBuild: boolean;
  recovery: 'update' | 'restart' | 'both' | null;
  summary: string;
  details: string[];
};

type Feature = keyof ClientCompatibility['features'];

const FEATURE_NAMES: Readonly<Record<Feature, string>> = Object.freeze({
  gameFileSaving: 'Guild Wars file saving',
  nativeCursor: 'Guild Wars cursor',
  targetObservation: 'target distance',
  partyObservation: 'live party details',
  teamApply: 'Apply team',
  xunlaiStorage: 'Xunlai / Travel integration',
});

function unavailableFeatures(compatibility: ClientCompatibility): Feature[] {
  return (Object.keys(compatibility.features) as Feature[]).filter(
    (feature) => compatibility.features[feature].status === 'unavailable',
  );
}

function unavailableNames(features: readonly Feature[]): string {
  return features.map((feature) => FEATURE_NAMES[feature]).join(', ');
}

export function compatibilityReport(
  compatibility: ClientCompatibility,
): CompatibilityReport {
  const unavailable = unavailableFeatures(compatibility);
  if (unavailable.length === 0) {
    return {
      degraded: false,
      acknowledgePerBuild: false,
      recovery: null,
      summary: 'This Guild Wars version is supported.',
      details: ['Everything you turned on is available.'],
    };
  }

  const preparationFailed = unavailable.some((feature) =>
    compatibility.features[feature].status === 'unavailable'
    && compatibility.features[feature].reason === 'preparation-failed');
  const gameUpdate = unavailable.some((feature) =>
    compatibility.features[feature].status === 'unavailable'
    && compatibility.features[feature].reason === 'game-update');
  if (preparationFailed && gameUpdate) {
    return {
      degraded: true,
      acknowledgePerBuild: false,
      recovery: 'both',
      summary: 'Some GWonMac features are temporarily unavailable.',
      details: [
        `Unavailable: ${unavailableNames(unavailable)}.`,
        'Guild Wars is ready to play. Restart GWonMac to retry features that didn’t start, and check for updates for this Guild Wars version.',
      ],
    };
  }
  if (preparationFailed) {
    return {
      degraded: true,
      acknowledgePerBuild: false,
      recovery: 'restart',
      summary: unavailable.length === 1 && unavailable[0] === 'nativeCursor'
        ? 'The Guild Wars cursor didn’t start.'
        : 'Some GWonMac features didn’t start.',
      details: [
        `Unavailable: ${unavailableNames(unavailable)}.`,
        'Guild Wars is ready to play. Restart GWonMac to try again.',
      ],
    };
  }

  if (unavailable.length === 1 && unavailable[0] === 'gameFileSaving') {
    return {
      degraded: true,
      acknowledgePerBuild: true,
      recovery: 'update',
      summary: 'Some Guild Wars files won’t save in this session.',
      details: [
        'Build templates, screenshots, and chat logs are unavailable.',
        'Your saved builds and teams are safe. You can keep playing.',
      ],
    };
  }

  if (unavailable.length === 1 && unavailable[0] === 'nativeCursor') {
    return {
      degraded: true,
      acknowledgePerBuild: true,
      recovery: 'update',
      summary: 'The Guild Wars cursor is temporarily unavailable.',
      details: ['The macOS pointer still works. You can keep playing.'],
    };
  }

  if (unavailable.every((feature) =>
    feature === 'targetObservation' || feature === 'partyObservation')) {
    const names = unavailableNames(unavailable);
    return {
      degraded: true,
      acknowledgePerBuild: true,
      recovery: 'update',
      summary: 'Live game information is temporarily unavailable.',
      details: [
        unavailable.length === 2
          ? 'Target distance, party details, and party capture are off.'
          : `${names[0]!.toUpperCase()}${names.slice(1)} is off.`,
        'Your saved builds and teams still work.',
      ],
    };
  }

  if (unavailable.length === 1 && unavailable[0] === 'teamApply') {
    return {
      degraded: true,
      acknowledgePerBuild: true,
      recovery: 'update',
      summary: 'Apply team is temporarily unavailable.',
      details: [
        'You can still view the live party and edit, import, or export saved builds and teams.',
      ],
    };
  }

  const fileSavingAvailable =
    compatibility.features.gameFileSaving.status === 'available';
  return {
    degraded: true,
    acknowledgePerBuild: true,
    recovery: 'update',
    summary: 'Some GWonMac features are temporarily unavailable.',
    details: [
      `Unavailable: ${unavailableNames(unavailable)}.`,
      fileSavingAvailable
        ? 'Build templates and your saved builds and teams still work. You can keep playing.'
        : 'Your saved builds and teams are safe. You can keep playing.',
    ],
  };
}

function requiredElement(root: Document, id: string): HTMLElement {
  const node = root.getElementById(id);
  if (!node) throw new Error(`missing compatibility element: ${id}`);
  return node;
}

function featureStatusLabel(status: ClientCompatibility['features'][Feature]): string {
  switch (status.status) {
    case 'available': return 'Available';
    case 'off': return 'Off';
    case 'unavailable': return 'Unavailable';
  }
}

/**
 * Render the session into both fixed compatibility surfaces.
 */
export function renderClientCompatibility(
  root: Document,
  session: ClientSession,
): CompatibilityReport | null {
  const settingsStatus = requiredElement(root, 'settings-compat-status');
  const settingsDetail = requiredElement(root, 'settings-compat-detail');
  const settingsVersion = requiredElement(root, 'settings-compat-version');
  const settingsAvailability = requiredElement(
    root,
    'settings-availability',
  ) as HTMLDetailsElement;
  const launcherTitle = requiredElement(root, 'client-compat-title');
  const launcherDetail = requiredElement(root, 'client-compat-detail');
  const launcherVersion = requiredElement(root, 'client-compat-version');
  const recovery = requiredElement(root, 'client-compat-check') as HTMLButtonElement;
  const restart = requiredElement(root, 'client-compat-restart') as HTMLButtonElement;
  const updateStatus = requiredElement(root, 'client-compat-update');

  settingsVersion.textContent = `App version ${session.appVersion}`;
  // The launcher notice reminds the player it will not nag: acknowledged once
  // per new game build, keyed by the build's hash.
  launcherVersion.textContent =
    `Shown once per new game build · App version ${session.appVersion}.`;
  if (!session.compatibility) {
    settingsStatus.hidden = true;
    settingsDetail.hidden = true;
    return null;
  }

  const report = compatibilityReport(session.compatibility);
  settingsAvailability.open = report.degraded;
  for (const feature of Object.keys(session.compatibility.features) as Feature[]) {
    requiredElement(root, `settings-feature-${feature}`).textContent =
      featureStatusLabel(session.compatibility.features[feature]);
  }
  const detail = report.details.join(' ');
  settingsStatus.hidden = false;
  settingsDetail.hidden = false;
  settingsStatus.textContent = report.summary;
  settingsDetail.textContent = detail;
  launcherTitle.textContent = report.summary;
  launcherDetail.textContent = detail;
  recovery.dataset.recovery = report.recovery ?? '';
  restart.hidden = report.recovery !== 'both';
  if (report.recovery === 'restart') {
    recovery.textContent = 'Restart GWonMac';
    updateStatus.hidden = true;
  } else if (report.recovery === 'both') {
    recovery.textContent = 'Check for updates';
    updateStatus.hidden = false;
  } else {
    recovery.textContent = 'Check for updates';
    updateStatus.hidden = false;
  }
  return report;
}

/**
 * Show the warning until the player acknowledges it. A failed settings write
 * must never keep the player out of the game.
 */
export function showCompatibilityNotice(
  root: Document,
  acknowledge: () => Promise<unknown>,
): Promise<void> {
  const notice = requiredElement(root, 'client-compat');
  // The one control whose `disabled` this module writes. index.html declares
  // it as a `<button>`; the assertion narrows to the property that needs it
  // and leaves the other six ids plain elements.
  const play = requiredElement(root, 'client-compat-play') as HTMLButtonElement;
  notice.hidden = false;
  play.disabled = false;

  return new Promise((resolve) => {
    play.addEventListener(
      'click',
      () => {
        play.disabled = true;
        void Promise.resolve()
          .then(acknowledge)
          .catch(() => undefined)
          .finally(() => {
            notice.hidden = true;
            resolve();
          });
      },
      { once: true },
    );
  });
}
