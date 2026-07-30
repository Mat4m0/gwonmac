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

import type { NoticeCode, SteamRefusalReason } from '../shared/contracts.js';
import type { ErrorCode } from '../shared/errors.js';

/**
 * The launch failed and the game cannot start. The default is the sentence
 * this path has always shown; the entries above it are the cases with a
 * different answer.
 */
const LAUNCH_FAILURE: Partial<Record<ErrorCode, string>> = {
  disk_full:
    'There is not enough free disk space to prepare the game client. Free some space, then choose Retry.',
  not_ready:
    'No game client has been downloaded yet, and ArenaNet could not be reached.',
  artifact_unverified:
    'The downloaded game client failed verification. Choose Retry to fetch it again.',
  wrong_profile:
    'The live probe selected an unexpected profile. No update was started.',
  net_offline:
    'This Mac appears to be offline, so ArenaNet could not be reached. Check the connection, then choose Retry — hotel and café networks often need a browser sign-in first.',
  http_status:
    'ArenaNet answered with a server error, so the game client could not be fetched. This is usually temporary — choose Retry in a few minutes.',
};

const LAUNCH_DEFAULT =
  'ArenaNet is unavailable and no previous game client could be restored.';

/**
 * The full-game download stopped and can be resumed. Verified data is always
 * kept, so every sentence here ends at the same action.
 */
const DOWNLOAD_FAILURE: Partial<Record<ErrorCode, string>> = {
  disk_full:
    'There is not enough free disk space to download the full game. Free some space, then choose Resume Download.',
  not_ready: 'The game files are not ready yet. Try again in a moment.',
  net_offline:
    'The connection to ArenaNet was lost. Check that this Mac is online, then choose Resume Download.',
  http_status:
    'ArenaNet answered with a server error. This is usually temporary — choose Resume Download in a few minutes.',
};

const DOWNLOAD_DEFAULT =
  'The download could not continue. Check your connection, then choose Resume Download.';

/**
 * A fatal snapshot read: the running client asked for game data that could
 * not be produced. The code arrives as a string tagged by the gw://app
 * response, so the lookup tolerates any value and lands on the default.
 */
const SNAPSHOT_READ: Partial<Record<ErrorCode, string>> = {
  chunk_offline:
    'No cached copy of the required game data is available while offline. Reconnect, then choose Retry.',
  net_offline:
    'This Mac appears to be offline, and this area of the game is not downloaded yet. Reconnect, then choose Retry.',
  http_status:
    'ArenaNet answered with a server error while fetching game data. This is usually temporary — choose Retry in a few minutes.',
  disk_full:
    'There is not enough free disk space to store game data. Free some space, then choose Retry.',
};

const SNAPSHOT_DEFAULT =
  'No cached copy of the required game data is available.';

export function describeLaunchFailure(code: ErrorCode): string {
  return LAUNCH_FAILURE[code] ?? LAUNCH_DEFAULT;
}

/**
 * `shortfall` is a preformatted size ("2.3 GB") from the caller, which owns
 * the one byte formatter on its surface; a second formatter here would drift.
 */
export function describeDownloadFailure(
  code: ErrorCode,
  context?: { shortfall?: string },
): string {
  const text = DOWNLOAD_FAILURE[code] ?? DOWNLOAD_DEFAULT;
  return code === 'disk_full' && context?.shortfall
    ? `${text} At least ${context.shortfall} more is needed.`
    : text;
}

export function describeSnapshotReadFailure(code: string | null): string {
  return (code && SNAPSHOT_READ[code as ErrorCode]) || SNAPSHOT_DEFAULT;
}

/**
 * The launch succeeded through a fallback the player may want to know about.
 * A `Record`, not a `Partial`: a notice code without a sentence is a compile
 * error, because a silent notice is a notice that never happened.
 */
const NOTICE: Record<NoticeCode, string> = {
  'cached-live-probe': 'The live probe is using the existing cached client.',
  'rejected-candidate-fallback':
    'Using the previous game client — a newer one did not start successfully.',
  'update-failed-previous-restored':
    'Using the previous game client — the update will retry next launch.',
  'offline-using-cached-client':
    "You're offline — starting with the downloaded client.",
  'interrupted-update-retryable':
    'An interrupted client update was found — it will finish next launch.',
};

export function describeNotice(code: NoticeCode): string {
  return NOTICE[code];
}

/**
 * Why a Steam sign-in produced no login, shown as a transient line over the
 * client's own login screen. `null` for a plain cancel: the player closed the
 * window themselves and needs no explanation of their own action. One
 * sentence set for every other reason — the host cannot see inside ArenaNet's
 * flow, so pretending to distinguish them would be guessing.
 */
export function describeSteamRefusal(
  reason: SteamRefusalReason,
): string | null {
  if (reason === 'cancelled') return null;
  return (
    "Steam sign-in didn't complete — you can try again or use your " +
    'Guild Wars account. Steam sign-in needs a Steam account that is ' +
    'already linked to a Guild Wars account.'
  );
}

/**
 * Whether the failure is worth a bug report. Network and disk conditions are
 * the player's to fix — suggesting "Report a Problem" for them blames the app
 * for the Wi-Fi. Anything else might genuinely be ours.
 */
const PLAYER_SIDE: ReadonlySet<string> = new Set<ErrorCode>([
  'net_offline',
  'http_status',
  'disk_full',
  'not_ready',
  'chunk_offline',
  'dns_failed',
  'dns_timeout',
  'dns_truncated',
  'dns_rcode',
  'dns_no_a',
  'dns_bad_reply',
]);

export function suggestReport(code: string): boolean {
  return !PLAYER_SIDE.has(code);
}

const REPORT_HINT = 'You can retry, or choose Help → Report a Problem.';

/**
 * The quiet second line under a failure: the report hint when the fault may
 * be ours, and always the raw code — it costs the player nothing and makes
 * every bug report specific.
 */
export function failureDetail(code?: string | null): string {
  if (!code) return REPORT_HINT;
  const footer = `Error code: ${code}`;
  return suggestReport(code) ? `${REPORT_HINT} · ${footer}` : footer;
}
