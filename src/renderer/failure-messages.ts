/**
 * The one place a failure becomes a sentence.
 *
 * The main process sends codes and never prose: it cannot see the UI, its
 * strings cannot be tested against what the player actually reads, and free
 * text on a channel is what let an error message reach the diagnostics export
 * in the first place. So every user-facing failure sentence is written here,
 * beside the surface that shows it, and a unit test executes this file.
 *
 * The maps are deliberately partial. Most of the catalogue names a fault in
 * something the player cannot act on, and inventing fifty sentences to say
 * "it broke" fifty ways would be worse than one honest default. A code earns
 * an entry only when it changes what the player should *do*.
 */

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
 *
 * A locked Keychain belongs here for the same reason and `keychain_unentitled`
 * deliberately does not: that one says the installed application is signed
 * wrongly, which no player can fix and we want to hear about.
 */
const PLAYER_SIDE: ReadonlySet<string> = new Set<ErrorCode>([
  'net_offline',
  'http_status',
  'disk_full',
  'not_ready',
  'keychain_locked',
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
 * The running game client died (Emscripten abort, or exit with a non-zero
 * code). One crash is usually transient; from the second crash in the same
 * app run the sentence stops promising that a retry will fix it and leads
 * with the report, because a repeating crash is the case a diagnostics
 * bundle exists for.
 */
export interface ClientCrashPresentation {
  label: string;
  detail: string;
  reportButton: string;
  retryButton: string;
}

const CRASH_RETRY = 'Retry';
const CRASH_REPORT = 'Report a Problem…';

export interface MemoryPressurePresentation {
  label: string;
  detail: string;
  reloadButton: string;
  dismissButton: string;
  whyLink: string;
}

export interface MemoryPressureChip {
  text: string;
  /** The whole sentence, for the button's accessible name. */
  label: string;
}

export interface MemoryExplanationBlock {
  title: string;
  body: string;
}

export interface MemoryExplanation {
  title: string;
  blocks: readonly MemoryExplanationBlock[];
  closeButton: string;
}

/**
 * The game client's WASM heap is approaching its hard 2 GiB cap; once it gets
 * there the next big allocation kills the client wherever the player happens
 * to be standing. These sentences exist so the player spends that death at a
 * moment of their choosing.
 *
 * They state a condition and not a deadline, which is where they ended up
 * rather than where they started. "Running low" meant half an hour in the open
 * world and about two minutes in a mission, and a player could not tell which —
 * so the *thresholds* count in time now, and that is the fix. It is only the
 * printed figure that is gone, and a real crash bundle is why.
 *
 * Replayed against the Eye of the North session of 2026-08-04 — the player's
 * own `wasm.heapGrew` staircase, ending at exactly 2 GiB — the levels arrived
 * where they should: `low` with 31 minutes of real play left against the
 * shipped rule's 11, `critical` with 7. The figure did not. It read
 * 10 → 15 → 20 → 75 → 40 → 20 → 15 → 10 → 3, and at one point offered "about
 * 75 minutes" to a player with 18 left, because a quiet stretch sat in the
 * measurement window just before they went back into heavy loading.
 *
 * No rate can see a player about to zone into a dungeon. The estimate still
 * exists — the thresholds are computed from it, the debug panel shows it and
 * the log records it — but it is a diagnostic, and a diagnostic printed on a
 * banner is a promise. The level is the part that survived contact with a
 * real session, so the level is the part the player is told.
 *
 * They state the reconnect rather than hedging it, which they did not always.
 * The uncertainty was never whether Guild Wars gives a player their instance
 * back after a dropped connection — it does — but whether *our* reload looks
 * like a dropped connection to its server. Tested 2026-08-05 across all five
 * reload paths this app can take, from inside an instance: every one came back
 * with progress intact, in under thirty seconds. That is the specific question
 * the hedge existed for, so the hedge is gone.
 *
 * The outpost is no longer in the notice. It is still true that an outpost
 * risks nothing at all, and the explanation says so — but leading with it is
 * what made the shipped sentence easy to ignore from inside a dungeon, and now
 * that the reconnect is measured, repeating the caveat argues against a fact.
 */
const MEMORY_RELOAD = 'Reload Now';
const MEMORY_DISMISS = 'Later';
const MEMORY_WHY = 'Why is this happening?';
const MEMORY_REJOIN =
  'Guild Wars puts you back where you were, in under a minute.';

export function memoryPressurePresentation(
  level: 'low' | 'critical',
): MemoryPressurePresentation {
  const critical = level === 'critical';
  return {
    label: critical
      ? 'Guild Wars is almost out of memory.'
      : 'Guild Wars is running low on memory.',
    detail: critical
      ? `Reload soon — ${MEMORY_REJOIN}`
      : `Reload when it suits you — ${MEMORY_REJOIN}`,
    reloadButton: MEMORY_RELOAD,
    dismissButton: MEMORY_DISMISS,
    whyLink: MEMORY_WHY,
  };
}

/**
 * What `Later` leaves behind: the thing that stops a dismissal meaning silence
 * until the crash, which is what the shipped build did. It carried a live
 * countdown until the Eye of the North bundle showed that countdown reading
 * "75 min" to a player with eighteen minutes left — a figure that moves is
 * only worth more than a word if it moves the right way.
 */
export function memoryPressureChip(
  level: 'low' | 'critical',
): MemoryPressureChip {
  return level === 'critical'
    ? {
        text: 'Memory almost full',
        label:
          'Guild Wars is almost out of memory. Open the memory warning again.',
      }
    : {
        text: 'Low memory',
        label: 'Guild Wars is low on memory. Open the memory warning again.',
      };
}

/**
 * The four things a player asks once they have read the warning twice. The
 * third block says what is true today — measured, documented, published. It
 * must not claim we are in contact with ArenaNet until someone has actually
 * written to them.
 */
export function memoryExplanation(): MemoryExplanation {
  return {
    title: 'Why Guild Wars runs out of memory',
    closeButton: 'Close',
    blocks: [
      {
        title: 'What this is',
        body:
          'The game client can only use 2 GB of memory. It does not release '
          + 'what it loads, so a long session gradually fills that up and the '
          + 'game stops — usually after two to three hours, and faster in '
          + 'dungeons and missions with a lot of new scenery.',
      },
      {
        title: 'Why we cannot fix it',
        body:
          "The limit and the memory use are both inside ArenaNet's game "
          + 'client. This app only hosts that client on macOS — it cannot '
          + 'change how the game allocates memory. What it can do is watch it '
          + 'and warn you before it runs out, which is what this is.',
      },
      {
        title: 'Where it stands',
        body:
          'We have measured it, documented it in detail, and published the '
          + 'findings for ArenaNet.',
      },
      {
        title: 'What to do',
        body:
          'Reloading gives the game a fresh 2 GB. It takes under a minute, '
          + 'and Guild Wars puts you back where you were — the same way it '
          + 'handles a dropped connection. We tested that from inside an '
          + 'instance, on every way this app can reload the game. A town or '
          + 'outpost is still the one place with nothing at all to lose.',
      },
    ],
  };
}

export function clientCrashPresentation(
  crashCount: number,
): ClientCrashPresentation {
  const repeated = crashCount >= 2;
  return {
    label: repeated
      ? 'The game client keeps stopping unexpectedly.'
      : 'The game client stopped unexpectedly.',
    detail: repeated
      ? 'Retrying alone may not fix this. Choose Report a Problem to export '
        + 'diagnostics and open the bug form — the report shows what stopped, '
        + 'not your account or chat.'
      : 'This is usually temporary — choose Retry to start it again. '
        + 'If it keeps happening, choose Report a Problem.',
    reportButton: CRASH_REPORT,
    retryButton: CRASH_RETRY,
  };
}

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
