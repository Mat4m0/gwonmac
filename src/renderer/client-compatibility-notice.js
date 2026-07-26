// What the player is told about the client build this session is running.
//
// DOM-free on purpose: the sentences are the feature. Each of the three states
// has to name which of build templates, screenshots and chat logs are
// affected, say what happens to the pointer, say that gameplay is untouched,
// and say that recovery needs a new release of this app rather than a retry.
// `settings.js` renders this in two places — the launcher dock notice and the
// Settings status — so the two cannot come to describe the same build
// differently.

/** @typedef {import('../shared/contracts.js').ClientCompatibility} ClientCompatibility */

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
 * @property {boolean} degraded Something works worse than on a certified build.
 * @property {boolean} cursorDegraded The player asked for the game’s cursors
 *   and this build cannot give them.
 * @property {string} summary One line, shown on both surfaces.
 * @property {string[]} details The contract: what is affected, what is not,
 *   and what recovery actually requires.
 */

/**
 * @param {ClientCompatibility} compatibility
 * @returns {CompatibilityReport}
 */
export function compatibilityReport(compatibility) {
  const { state, toolboxRequested } = compatibility;
  const cursorDegraded = toolboxRequested && state !== 'certified';

  if (state === 'uncertified') {
    return {
      state,
      degraded: true,
      cursorDegraded,
      summary:
        'This ArenaNet client build has not been certified with this version '
        + 'of the app.',
      details: [
        `The app is using ArenaNet’s untouched module, so ${FEATURES} may not `
          + 'work correctly.',
        cursorDegraded
          ? 'Toolbox does not load on an uncertified build, so Guild Wars’ '
            + 'own cursors are unavailable and macOS draws the pointer.'
          : 'Toolbox does not load on an uncertified build, so the game’s own '
            + 'cursors stay unavailable even if you switch them on.',
        GAMEPLAY,
        RECOVERY,
        SEPARATION,
      ],
    };
  }

  if (state === 'template-only') {
    return {
      state,
      degraded: cursorDegraded,
      cursorDegraded,
      summary:
        `This client build is certified for ${FEATURES}, but not yet for `
        + 'Guild Wars’ own cursors.',
      details: cursorDegraded
        ? [
            `${capitalise(FEATURES)} work normally.`,
            'Guild Wars’ own cursors are unavailable, so macOS draws the '
              + 'pointer.',
            GAMEPLAY,
            RECOVERY,
            SEPARATION,
          ]
        : [
            `${capitalise(FEATURES)} work normally.`,
            'Guild Wars’ own cursors are not certified for this build, so '
              + 'switching them on under Controls would have no effect yet.',
            RECOVERY,
          ],
    };
  }

  return {
    state,
    degraded: false,
    cursorDegraded: false,
    summary: 'This game client build is certified.',
    details: [
      `${capitalise(FEATURES)} work normally.`,
      toolboxRequested
        ? 'Guild Wars’ own cursors are in use.'
        : 'Guild Wars’ own cursors are available for this build; switch them '
          + 'on under Controls.',
    ],
  };
}

/** @param {string} text */
function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
