// The one place a failure becomes a sentence.
//
// The main process sends codes and never prose: it cannot see the UI, its
// strings cannot be tested against what the player actually reads, and free
// text on a channel is what let an error message reach the diagnostics export
// in the first place. So every user-facing failure sentence is written here,
// beside the surface that shows it, and a unit test executes this file.
//
// The maps are deliberately partial. Most of the catalogue names a fault in
// something the player cannot act on, and inventing fifty sentences to say
// "it broke" fifty ways would be worse than one honest default. A code earns
// an entry only when it changes what the player should *do*.

/** @typedef {import('../shared/errors.js').ErrorCode} ErrorCode */

/**
 * The launch failed and the game cannot start. The default is the sentence
 * this path has always shown; the entries above it are the cases with a
 * different answer.
 * @type {Partial<Record<ErrorCode, string>>}
 */
const LAUNCH_FAILURE = {
  disk_full:
    'There is not enough free disk space to prepare the game client. Free some space, then choose Retry.',
  not_ready:
    'No game client has been downloaded yet, and ArenaNet could not be reached.',
  artifact_unverified:
    'The downloaded game client failed verification. Choose Retry to fetch it again.',
  wrong_profile:
    'The live probe selected an unexpected profile. No update was started.',
};

const LAUNCH_DEFAULT =
  'ArenaNet is unavailable and no previous game client could be restored.';

/**
 * The full-game download stopped and can be resumed. Verified data is always
 * kept, so every sentence here ends at the same action.
 * @type {Partial<Record<ErrorCode, string>>}
 */
const DOWNLOAD_FAILURE = {
  disk_full:
    'There is not enough free disk space to download the full game. Free some space, then choose Resume Download.',
  not_ready: 'The game files are not ready yet. Try again in a moment.',
};

const DOWNLOAD_DEFAULT =
  'The download could not continue. Check your connection, then choose Resume Download.';

/**
 * @param {ErrorCode} code
 * @returns {string}
 */
export function describeLaunchFailure(code) {
  return LAUNCH_FAILURE[code] ?? LAUNCH_DEFAULT;
}

/**
 * @param {ErrorCode} code
 * @returns {string}
 */
export function describeDownloadFailure(code) {
  return DOWNLOAD_FAILURE[code] ?? DOWNLOAD_DEFAULT;
}
