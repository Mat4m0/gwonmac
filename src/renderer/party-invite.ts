/**
 * Owns the player-requested party invite and the Travel-then-invite sequence.
 * The certified chat mailbox sends the invite; this owner only decides when a
 * request is allowed and waits for a fresh outpost arrival before inviting.
 */
import type { TravelFriend } from '../shared/friends.js';
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

export function createPartyInvite(input: PartyInviteInput) {
  const settleMs = input.settleMs ?? 2_000;
  const arrivalTimeoutMs = input.arrivalTimeoutMs ?? 60_000;
  let travelling = false;
  const unavailable = (): string | null => travelling ? 'Travelling. The invite follows on arrival.'
    : !inOutpost(input.region()) ? 'Invite players from an outpost'
    : !input.chatReady() ? 'Guild Wars chat is not ready' : null;

  /** Resolves on a settled, ready outpost of `mapId` for the same character. */
  function arrival(mapId: number, characterKey: string | null) {
    let cancel = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      let settle: ReturnType<typeof setTimeout> | null = null;
      const finish = (error?: Error) => {
        unsubscribe(); clearTimeout(timeout); if (settle) clearTimeout(settle);
        if (error) reject(error); else resolve();
      };
      cancel = () => finish(new Error('Travel was cancelled. The invite was not sent.'));
      const check = () => {
        const region = input.region();
        const arrived = region.status === 'ready' && region.mapId === mapId && inOutpost(region)
          && region.characterKey === characterKey && input.chatReady();
        if (region.status === 'ready' && region.characterKey !== characterKey) {
          finish(new Error('The character changed. The invite was not sent.'));
        } else if (arrived && !settle) settle = setTimeout(() => finish(), settleMs);
        else if (!arrived && settle) { clearTimeout(settle); settle = null; }
      };
      const unsubscribe = input.subscribeRegion(check);
      const timeout = setTimeout(() => finish(new Error('Travel did not finish. The invite was not sent.')), arrivalTimeoutMs);
    });
    promise.catch(() => {});
    return { promise, cancel };
  }
  function invite(name: string): Promise<void> {
    const reason = unavailable();
    return reason ? Promise.reject(new Error(reason)) : input.invite(name);
  }

  return {
    unavailable,
    /** Why Travel and invite cannot start now, or null. */
    travelUnavailable(friend: TravelFriend): string | null {
      const region = input.region();
      if (!input.travel) return 'Travel is unavailable';
      if (region.status === 'ready' && region.mapId === friend.mapId) return 'You are already in this outpost';
      return travelling ? 'Travelling. The invite follows on arrival.' : null;
    },
    invite,
    /**
     * Starts Travel to the friend's outpost (any district). Refusals before
     * departure throw; `invited` settles once the arrival invite was sent or
     * withdrawn. The invite is sent once and never retried.
     */
    async travelAndInvite(friend: TravelFriend, generation: number): Promise<{ invited: Promise<void> }> {
      if (!input.travel) throw new Error('Travel is unavailable');
      if (travelling) throw new Error('Travelling. The invite follows on arrival.');
      const region = input.region();
      if (region.status !== 'ready') throw new Error('Wait for Guild Wars to finish loading');
      if (region.mapId === friend.mapId) throw new Error('You are already in this outpost');
      const name = friend.character;
      if (!name) throw new Error('This friend is offline');
      travelling = true;
      const arrived = arrival(friend.mapId, region.characterKey);
      try { await input.travel(friend, generation); } catch (error) {
        travelling = false; arrived.cancel(); throw error;
      }
      const invited = arrived.promise.finally(() => { travelling = false; }).then(() => invite(name));
      invited.catch(() => {});
      return { invited };
    },
  };
}
