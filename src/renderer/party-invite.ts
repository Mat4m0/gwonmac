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
const TRAVELLING = 'Travelling. The invite follows on arrival.';
const NEEDS_PVE = 'Invites from Hub need a PvE outpost';

export function createPartyInvite(input: PartyInviteInput) {
  const settleMs = input.settleMs ?? 2_000;
  const arrivalTimeoutMs = input.arrivalTimeoutMs ?? 60_000;
  /** Withdraws the one pending arrival; null while nothing waits. */
  let pending: (() => void) | null = null;
  /** Why an invite cannot be sent now. A friend elsewhere cannot receive it from here. */
  function unavailable(friend?: TravelFriend): string | null {
    const region = input.region();
    if (pending) return TRAVELLING;
    if (!inOutpost(region)) return 'Invite players from an outpost';
    if (!input.chatReady()) return 'Guild Wars chat is not ready';
    if (friend && region.status === 'ready' && friend.mapId !== region.mapId) {
      return `${friend.character || friend.alias} is in ${travelDestination(friend.mapId)?.name ?? 'another map'}.${input.travel ? ' Use Travel and invite.' : ''}`;
    }
    return null;
  }
  function travelUnavailable(friend: TravelFriend): string | null {
    const region = input.region();
    if (!input.travel) return 'Travel is unavailable';
    if (isPvpTravelDestination(friend.mapId)) return NEEDS_PVE;
    if (region.status === 'ready' && region.mapId === friend.mapId) return 'You are already in this outpost';
    return pending ? TRAVELLING : null;
  }

  /**
   * Resolves on a settled, ready PvE outpost of `mapId` for the same character.
   * The first outpost after login can publish no character key yet: an unknown
   * key adopts the first known one, and only two different known keys refuse.
   */
  function arrival(mapId: number, characterKey: string | null) {
    let cancel = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      let known = characterKey;
      let settle: ReturnType<typeof setTimeout> | null = null;
      const finish = (error?: Error) => {
        unsubscribe(); clearTimeout(timeout); if (settle) clearTimeout(settle);
        if (error) reject(error); else resolve();
      };
      cancel = () => finish(new Error('Travel and invite stopped. The invite was not sent.'));
      const check = () => {
        const region = input.region();
        if (region.status === 'ready' && region.characterKey !== null) {
          if (known !== null && region.characterKey !== known) { finish(new Error('The character changed. The invite was not sent.')); return; }
          known = region.characterKey;
        }
        if (region.status === 'ready' && region.mapId === mapId && !inOutpost(region)) {
          finish(new Error(`${NEEDS_PVE}. The invite was not sent.`)); return;
        }
        const arrived = region.status === 'ready' && region.mapId === mapId && input.chatReady();
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
      pending = arrived.cancel;
      try { await travel(friend, generation); } catch (error) {
        pending = null; arrived.cancel(); throw error;
      }
      const invited = arrived.promise.finally(() => { pending = null; }).then(() => invite(name));
      invited.catch(() => {});
      return { invited };
    },
    /** Tools are leaving: a pending arrival never invites later. */
    dispose() { pending?.(); },
  };
}
