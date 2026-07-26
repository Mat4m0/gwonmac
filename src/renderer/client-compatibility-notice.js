// What the player is told about the client build this session is running.
//
// The pure report below owns every compatibility sentence. The concrete DOM
// binding at the end renders that same report in the launcher and Settings and
// owns the notice acknowledgement. Certification gaps require a new release;
// a runtime preparation failure is retryable and says so.

/** @typedef {import('../shared/contracts.js').ClientCompatibility} ClientCompatibility */
/** @typedef {import('../shared/contracts.js').ClientSession} ClientSession */
/** @typedef {import('../shared/contracts.js').ToolboxSelection} ToolboxSelection */

/**
 * The compatibility transform repairs three call-site families, not one.
 * Naming them is the point: "a compatibility issue" tells a player nothing,
 * and they find out when a build template will not save.
 */
const FEATURES = 'build templates, screenshots and chat logs';

const GAMEPLAY =
  'Gameplay itself is unaffected: no stat, no timing and no input path changes.';

const RECOVERY =
  'Certifying a client build takes a new release of this app. Retrying, '
  + 'reinstalling or clearing downloaded game data cannot fix it.';

/**
 * An uncertified ArenaNet build proves only that *this* client build has not
 * been certified with *this* version of the app. Whether a newer app release
 * exists is a different fact, established by a different question, and neither
 * surface may let one stand in for the other.
 */
const SEPARATION =
  'This does not mean the app is out of date — whether a newer version of the '
  + 'app exists is a separate question.';

/**
 * @typedef {object} CompatibilityReport
 * @property {import('../shared/contracts.js').ClientCompatibilityState} state
 * @property {boolean} degraded Something works worse than in a fully prepared
 *   certified session.
 * @property {boolean} toolboxDegraded The player selected at least one Toolbox
 *   tool and this build cannot provide it.
 * @property {string} summary One line, shown on both surfaces.
 * @property {string[]} details The contract: what is affected, what is not,
 *   and what recovery actually requires.
 */

/** @param {ToolboxSelection} selection */
function selectedToolNames(selection) {
  return [
    selection.nativeCursor ? 'game cursor' : '',
    selection.targetReadout ? 'target readout' : '',
  ].filter(Boolean);
}

/** @param {string[]} names */
function toolList(names) {
  return names.length === 2 ? `${names[0]} and ${names[1]}` : names[0] ?? '';
}

/**
 * @param {ClientCompatibility} compatibility
 * @param {ToolboxSelection} selection
 * @returns {CompatibilityReport}
 */
export function compatibilityReport(compatibility, selection) {
  const { state } = compatibility;
  const selectedTools = selectedToolNames(selection);
  const requestedTools = toolList(selectedTools);
  const toolboxAvailable =
    state === 'certified' && compatibility.toolboxActive;
  const toolboxDegraded = selectedTools.length > 0 && !toolboxAvailable;

  if (state === 'uncertified') {
    return {
      state,
      degraded: true,
      toolboxDegraded,
      summary:
        'This ArenaNet client build has not been certified with this version '
        + 'of the app.',
      details: [
        `The app is using ArenaNet’s untouched module, so ${FEATURES} may not `
          + 'work correctly.',
        toolboxDegraded
          ? `Toolbox does not load on an uncertified build, so your ${
              requestedTools
            } ${selectedTools.length === 1 ? 'is' : 'are'} unavailable for this session.`
          : 'Toolbox does not load on an uncertified build. The game cursor '
            + 'and target readout remain available once this build is certified.',
        GAMEPLAY,
        RECOVERY,
        SEPARATION,
      ],
    };
  }

  if (state === 'template-only') {
    return {
      state,
      degraded: toolboxDegraded,
      toolboxDegraded,
      summary:
        `This client build is certified for ${FEATURES}, but not yet for `
        + 'the Toolbox tools.',
      details: toolboxDegraded
        ? [
            `${capitalise(FEATURES)} work normally.`,
            `Your ${requestedTools} ${
              selectedTools.length === 1 ? 'is' : 'are'
            } unavailable for this session.`,
            GAMEPLAY,
            RECOVERY,
            SEPARATION,
          ]
        : [
            `${capitalise(FEATURES)} work normally.`,
            'The game cursor and target readout are not certified for this '
              + 'build, so switching either on would have no effect yet.',
            RECOVERY,
          ],
    };
  }

  if (toolboxDegraded) {
    return {
      state,
      degraded: true,
      toolboxDegraded: true,
      summary:
        'This client build is certified, but Toolbox could not be prepared '
        + 'for this session.',
      details: [
        `${capitalise(FEATURES)} work normally.`,
        `Your ${requestedTools} ${
          selectedTools.length === 1 ? 'is' : 'are'
        } unavailable for this session.`,
        GAMEPLAY,
        'Restart the app to try preparing Toolbox again. If it keeps failing, '
          + 'export diagnostics and report the problem.',
        SEPARATION,
      ],
    };
  }

  return {
    state,
    degraded: false,
    toolboxDegraded: false,
    summary: 'This game client build is certified.',
    details: [
      `${capitalise(FEATURES)} work normally.`,
      selectedTools.length > 0
        ? `Your ${requestedTools} ${
            selectedTools.length === 1 ? 'is' : 'are'
          } available.`
        : 'The game cursor and target readout are available under Controls.',
    ],
  };
}

/** @param {string} text */
function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * @param {Document} root
 * @param {string} id
 */
function requiredElement(root, id) {
  const node = root.getElementById(id);
  if (!node) throw new Error(`missing compatibility element: ${id}`);
  return node;
}

/**
 * Render the session into both fixed compatibility surfaces.
 *
 * @param {Document} root
 * @param {ClientSession} session
 * @param {ToolboxSelection} selection
 * @returns {CompatibilityReport | null}
 */
export function renderClientCompatibility(root, session, selection) {
  const settingsStatus = requiredElement(root, 'settings-compat-status');
  const settingsDetail = requiredElement(root, 'settings-compat-detail');
  const settingsVersion = requiredElement(root, 'settings-compat-version');
  const launcherTitle = requiredElement(root, 'client-compat-title');
  const launcherDetail = requiredElement(root, 'client-compat-detail');
  const launcherVersion = requiredElement(root, 'client-compat-version');

  settingsVersion.textContent = `App version ${session.appVersion}`;
  launcherVersion.textContent = `App version ${session.appVersion}.`;
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
 *
 * @param {Document} root
 * @param {() => Promise<unknown>} acknowledge
 * @returns {Promise<void>}
 */
export function showCompatibilityNotice(root, acknowledge) {
  const notice = requiredElement(root, 'client-compat');
  const play =
    /** @type {HTMLButtonElement} */ (
      requiredElement(root, 'client-compat-play')
    );
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
