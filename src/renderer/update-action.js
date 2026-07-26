// The renderer half of "is there a newer release of this app?".
//
// DOM-free on purpose. Everything here is a part of the feature that can lie:
// the three answers that must never collapse into two, the sentence chosen for
// each failure reason, and the single-flight rule that stops a mashed button
// from burning a 60-per-hour rate limit. Those live where a unit test can
// execute them, and `settings.js` binds one instance to both mount points —
// the launcher's corner links and the Settings dialog. A copy per surface is
// how the two would come to disagree about what was asked and what came back.

/** @typedef {import('../shared/contracts.js').ReleaseCheckFailure} ReleaseCheckFailure */
/** @typedef {import('../shared/contracts.js').ReleaseNotice} ReleaseNotice */

/**
 * One sentence per failure reason, keyed by the closed vocabulary so that a
 * reason added to the contract fails `tsc` here instead of rendering as a
 * blank line. "Couldn't check" never says "up to date": that conflation is the
 * quiet lie this whole path exists to remove.
 * @type {Record<ReleaseCheckFailure, string>}
 */
const FAILURE_MESSAGE = {
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

/**
 * @param {ReleaseNotice} notice
 * @returns {string}
 */
export function describeReleaseNotice(notice) {
  if (notice.state === 'update-available') {
    return `Version ${notice.latestVersion} is available.`;
  }
  if (notice.state === 'up-to-date') return "You're on the latest version.";
  return FAILURE_MESSAGE[notice.reason];
}

/**
 * @param {number} value
 * @param {string} unit
 */
const plural = (value, unit) => `${value} ${unit}${value === 1 ? '' : 's'}`;

/**
 * When GitHub was last asked. Empty string means never, which is the state
 * that `unknown` would otherwise be indistinguishable from.
 *
 * @param {number | null} checkedAt epoch milliseconds, or null if never asked
 * @param {number} now epoch milliseconds
 * @returns {string}
 */
export function formatLastChecked(checkedAt, now) {
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

/**
 * @typedef {object} UpdateActionView
 * @property {string} actionLabel Label for the control that starts a check.
 * @property {boolean} busy A check is in flight; starting another does nothing.
 * @property {string} message The answer, or '' before the first one arrives.
 * @property {string} lastChecked '' until GitHub has been asked once.
 * @property {boolean} updateAvailable Whether to offer the releases page.
 */

/**
 * @typedef {object} UpdateAction
 * @property {(listener: (view: UpdateActionView) => void) => void} subscribe
 * @property {(checkedAt: number | null) => void} restore
 * @property {() => Promise<void>} check
 */

/**
 * @param {object} options
 * @param {() => Promise<ReleaseNotice>} options.check Asks the main process.
 * @param {(checkedAt: number) => Promise<unknown>} options.remember Persists
 *   the timestamp, so "never asked" survives a relaunch.
 * @param {() => number} [options.now]
 * @returns {UpdateAction}
 */
export function createUpdateAction({ check, remember, now = () => Date.now() }) {
  /** @type {ReleaseNotice | 'unavailable' | null} */
  let result = null;
  /** @type {number | null} */
  let lastCheckedAt = null;
  /** @type {Promise<void> | null} */
  let running = null;
  /** @type {((view: UpdateActionView) => void)[]} */
  const listeners = [];

  /** @returns {UpdateActionView} */
  function view() {
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
      const operation = (async () => {
        try {
          const notice = await check();
          result = notice;
          // Every result carries `checkedAt`, including the failures: the
          // timestamp records that GitHub was asked, not that it answered
          // usefully. A cached answer keeps its original time, so repeated
          // clicks do not claim a request that was never made.
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
