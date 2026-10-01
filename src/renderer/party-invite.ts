/**
 * Owns the player-requested party invite and the Travel-then-invite sequence.
 * The certified chat mailbox sends the invite; this owner only decides when a
 * request is allowed and waits for a fresh outpost arrival before inviting.
 */
import type { TravelFriend } from '../shared/friends.js';
import { isPvpTravelDestination, travelDestination } from '../shared/travel.js';
import type { CompanionPlayRegionState } from './companion-play-region-snapshot.js';

type PartyInviteInput = Readonly<{
  region(): CompanionPlayRegionState;
  subscribeRegion(listener: () => void): () => void;
  /** The whisper tool owns the chat mailbox that also carries invites. */
  chatReady(): boolean;
  invite(name: string): Promise<void>;
  travel: ((friend: TravelFriend, generation: number) => Promise<void>) | null;
  /** Guild Wars refuses an invite sent while the arriving party is still forming. */
  settleMs?: number;
  arrivalTimeoutMs?: number;
}>;

export type PartyInvite = ReturnType<typeof createPartyInvite>;

const inOutpost = (region: CompanionPlayRegionState) =>
  region.status === 'ready' && region.playRegion === 'pve' && region.instanceType === 0;
const NEEDS_PVE = 'Invites from Hub need a PvE outpost';

export function createPartyInvite(input: PartyInviteInput) {
  const settleMs = input.settleMs ?? 2_000;
  const arrivalTimeoutMs = input.arrivalTimeoutMs ?? 60_000;
  /** Withdraws the one pending arrival; null while nothing waits. */
  let pending: { details: Readonly<{ name: string; place: string }>; cancelled: boolean; cancel(): void } | null = null;
  const listeners = new Set<() => void>();
  const refresh = () => { for (const listener of listeners) listener(); };
  const travelling = () => pending ? `Travelling to ${pending.details.place}. The invite to ${pending.details.name} follows on arrival.` : null;
  function cancel(expected?: Readonly<{ name: string; place: string }>) {
    const request = pending;
    if (expected && request?.details !== expected) throw new Error('This pending invite changed. Select it again.');
    if (!request) return;
    request.cancelled = true; request.cancel(); pending = null; refresh();
  }
  /**
   * Why an invite cannot be sent now. A friend elsewhere cannot receive it from here;
   * the reason points to Travel and invite only when the caller offers that action.
   */
  function unavailable(friend?: TravelFriend, travelOffered = false): string | null {
    const region = input.region();
    if (pending) return travelling();
    if (!inOutpost(region)) return 'Invite players from an outpost';
    if (!input.chatReady()) return 'Guild Wars chat is not ready';
    if (friend && region.status === 'ready' && friend.mapId !== region.mapId) {
      const place = travelDestination(friend.mapId)?.name ?? 'another map';
      return `${friend.character || friend.alias} is in ${place}.${travelOffered ? ' Use Travel and invite.' : ''}`;
    }
    return null;
  }
  function travelUnavailable(friend: TravelFriend): string | null {
    const region = input.region();
    if (!input.travel) return 'Travel is unavailable';
    if (isPvpTravelDestination(friend.mapId)) return NEEDS_PVE;
    if (region.status === 'ready' && region.mapId === friend.mapId) return 'You are already in this outpost';
    return travelling();
  }

  /**
   * Resolves on a settled, ready PvE outpost of `mapId` for the same character.
   * The first outpost after login can publish no character key yet: an unknown
   * key adopts the first known one, and only two different known keys refuse.
   * Once a key is known only that key arrives, so a relogged character never
   * sends the invite. While no key is known yet, leaving the game refuses: that
   * is the only case where a relog could pass for the same character. The game
   * state also reads unavailable for a moment during an ordinary zone change,
   * so it never refuses once the key is known.
   */
  function arrival(mapId: number, characterKey: string | null) {
    let cancel = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      let known = characterKey;
      let finished = false;
      let settle: ReturnType<typeof setTimeout> | null = null;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        unsubscribe(); clearTimeout(timeout); if (settle) clearTimeout(settle);
        if (error) reject(error); else resolve();
      };
      cancel = () => finish(new Error('Travel and invite stopped. The invite was not sent.'));
      const check = () => {
        const region = input.region();
        const left = known === null && region.status === 'waiting' && region.reason === 'game';
        if (left || region.status === 'ready' && known !== null && region.characterKey !== null && region.characterKey !== known) {
          finish(new Error('The character changed. The invite was not sent.')); return;
        }
        if (region.status === 'ready') known ??= region.characterKey;
        if (region.status === 'ready' && region.mapId === mapId && !inOutpost(region)) {
          finish(new Error(`${NEEDS_PVE}. The invite was not sent.`)); return;
        }
        const arrived = region.status === 'ready' && region.mapId === mapId && region.characterKey === known
          && input.chatReady();
        if (arrived && !settle) settle = setTimeout(() => finish(), settleMs);
        else if (!arrived && settle) { clearTimeout(settle); settle = null; }
      };
      const unsubscribe = input.subscribeRegion(check);
      const timeout = setTimeout(() => finish(new Error('Travel did not finish. The invite was not sent.')), arrivalTimeoutMs);
    });
    promise.catch(() => {});
    return { promise, cancel };
  }
  function invite(name: string, friend?: TravelFriend): Promise<void> {
    const reason = unavailable(friend);
    return reason ? Promise.reject(new Error(reason)) : input.invite(name);
  }

  return {
    get pending() { return pending?.details ?? null; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancel,
    unavailable,
    /** Why Travel and invite cannot start now, or null. */
    travelUnavailable,
    invite,
    /**
     * Starts Travel to the friend's outpost (any district). Refusals before
     * departure throw; `invited` settles once the arrival invite was sent or
     * withdrawn. The invite is sent once and never retried.
     */
    async travelAndInvite(friend: TravelFriend, generation: number): Promise<{ invited: Promise<void> }> {
      const travel = input.travel;
      const refusal = travelUnavailable(friend);
      if (refusal || !travel) throw new Error(refusal ?? 'Travel is unavailable');
      const region = input.region();
      if (region.status !== 'ready') throw new Error('Wait for Guild Wars to finish loading');
      const name = friend.character;
      if (!name) throw new Error('This friend is offline');
      const arrived = arrival(friend.mapId, region.characterKey);
      const request = { details: Object.freeze({ name, place: travelDestination(friend.mapId)?.name ?? 'the outpost' }), cancelled: false, cancel: arrived.cancel };
      pending = request; refresh();
      const clear = () => { if (pending === request) { pending = null; refresh(); } };
      try { await travel(friend, generation); } catch (error) {
        clear(); arrived.cancel(); throw error;
      }
      const invited = arrived.promise.finally(clear).then(() => {
        // Cancellation can follow the settle timer before its promise continuation runs.
        if (request.cancelled) throw new Error('Travel and invite stopped. The invite was not sent.');
        return invite(name);
      });
      invited.catch(() => {});
      return { invited };
    },
    /** Tools are leaving: a pending arrival never invites later. */
    dispose() { cancel(); listeners.clear(); },
  };
}
