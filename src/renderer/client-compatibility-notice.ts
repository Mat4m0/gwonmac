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
  ClientCompatibilityState,
  ClientSession,
} from '../shared/contracts.js';
import type { EnhancementSelection } from '../shared/enhancement-contracts.js';

/**
 * The compatibility transform repairs three call-site families, not one.
 * Naming them is the point: "a compatibility issue" tells a player nothing,
 * and they find out when a build template will not save.
 */
const FEATURES = 'build templates, screenshots and chat logs';

const GAMEPLAY = 'You can keep playing normally.';

/**
 * Recovery is an app update. The launcher offers that check beside the notice,
 * so the copy names the action without explaining internal certification.
 */
const RECOVERY =
  'Check for a GWonMac update to restore the disabled features.';

export type CompatibilityReport = {
  state: ClientCompatibilityState;
  /** Something works worse than in a fully prepared certified session. */
  degraded: boolean;
  /**
   * The player selected at least one Enhancement tool and this build cannot
   * provide it.
   */
  enhancementDegraded: boolean;
  /** One line, shown on both surfaces. */
  summary: string;
  /**
   * The contract: what is affected, what is not, and what recovery actually
   * requires.
   */
  details: string[];
};

function selectedToolNames(selection: EnhancementSelection): string[] {
  return [
    selection.nativeCursor ? 'game cursor' : '',
    selection.tools ? 'GWonMac Tools Beta' : '',
  ].filter(Boolean);
}

function toolList(names: string[]): string {
  return names.length === 2 ? `${names[0]} and ${names[1]}` : names[0] ?? '';
}

export function compatibilityReport(
  compatibility: ClientCompatibility,
  selection: EnhancementSelection,
): CompatibilityReport {
  const { state } = compatibility;
  const selectedTools = selectedToolNames(selection);
  const requestedTools = toolList(selectedTools);
  const enhancementAvailable =
    state === 'certified' && compatibility.enhancementActive;
  const enhancementDegraded = selectedTools.length > 0 && !enhancementAvailable;

  if (state === 'uncertified') {
    return {
      state,
      degraded: true,
      enhancementDegraded,
      summary:
        'A Guild Wars update temporarily disabled some GWonMac features.',
      details: [
        GAMEPLAY,
        `${capitalise(FEATURES)} may not work correctly. Your local Build `
          + 'and Team library is still available. Live Tools features are off.',
        ...(enhancementDegraded
          ? [
              `Your ${requestedTools} ${
                selectedTools.length === 1 ? 'is' : 'are'
              } off for this session.`,
            ]
          : []),
        RECOVERY,
      ],
    };
  }

  if (state === 'template-only') {
    return {
      state,
      degraded: enhancementDegraded,
      enhancementDegraded,
      summary: enhancementDegraded
        ? `A Guild Wars update temporarily disabled your ${requestedTools}.`
        : 'The game cursor is temporarily unavailable after a Guild Wars update.',
      details: [
        `${capitalise(FEATURES)} still work.`,
        GAMEPLAY,
        RECOVERY,
      ],
    };
  }

  if (enhancementDegraded) {
    return {
      state,
      degraded: true,
      enhancementDegraded: true,
      summary:
        'The game tools could not be prepared for this session.',
      details: [
        `${capitalise(FEATURES)} work normally.`,
        `Your ${requestedTools} ${
          selectedTools.length === 1 ? 'is' : 'are'
        } unavailable for this session.`,
        GAMEPLAY,
        'Restart the app to try preparing the game tools again. If it keeps '
          + 'failing, export diagnostics and report the problem.',
      ],
    };
  }

  return {
    state,
    degraded: false,
    enhancementDegraded: false,
    summary: 'This game client build is fully supported.',
    details: [
      `${capitalise(FEATURES)} work normally.`,
      selectedTools.length > 0
        ? `Your ${requestedTools} ${
            selectedTools.length === 1 ? 'is' : 'are'
          } available.`
        : 'The Core game cursor is available.',
    ],
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function requiredElement(root: Document, id: string): HTMLElement {
  const node = root.getElementById(id);
  if (!node) throw new Error(`missing compatibility element: ${id}`);
  return node;
}

/**
 * Render the session into both fixed compatibility surfaces.
 */
export function renderClientCompatibility(
  root: Document,
  session: ClientSession,
  selection: EnhancementSelection,
): CompatibilityReport | null {
  const settingsStatus = requiredElement(root, 'settings-compat-status');
  const settingsDetail = requiredElement(root, 'settings-compat-detail');
  const settingsVersion = requiredElement(root, 'settings-compat-version');
  const launcherTitle = requiredElement(root, 'client-compat-title');
  const launcherDetail = requiredElement(root, 'client-compat-detail');
  const launcherVersion = requiredElement(root, 'client-compat-version');

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

  const report = compatibilityReport(session.compatibility, selection);
  const detail = report.details.join(' ');
  settingsStatus.hidden = false;
  settingsDetail.hidden = false;
  settingsStatus.textContent = report.summary;
  settingsDetail.textContent = detail;
  launcherTitle.textContent = report.summary;
  launcherDetail.textContent = detail;
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
