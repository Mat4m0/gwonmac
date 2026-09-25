/** Party invite and Travel-then-invite: outpost gate, fresh arrival, one invite, no retry. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanionPlayRegionState } from '../../src/renderer/companion-play-region-snapshot.ts';
import { createPartyInvite } from '../../src/renderer/party-invite.ts';
import type { TravelFriend } from '../../src/shared/friends.ts';

const outpost = (mapId: number, characterKey = 'a', instanceType = 0) => ({
  status: 'ready', sequence: 1, mapId, instanceType, playRegion: 'pve', travelContext: 'world', characterKey,
  unlockedMapWords: null, guildHall: false, hasGuildHall: false,
}) as unknown as CompanionPlayRegionState;
const loading = { status: 'waiting', reason: 'stale' } as const;
const friend: TravelFriend = { key: 'f', character: 'Mo Kaiser', alias: 'Kai', status: 'online', mapId: 449 };

function harness(options: { travel?: () => Promise<void> } = {}) {
  let region: CompanionPlayRegionState = outpost(55);
  let chat = true;
  const listeners = new Set<() => void>();
  const invited: string[] = [];
  const party = createPartyInvite({
    region: () => region,
    subscribeRegion: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    chatReady: () => chat,
    invite: async name => { invited.push(name); },
    travel: options.travel ?? (async () => {}),
    settleMs: 2_000, arrivalTimeoutMs: 60_000,
  });
  return { party, invited, listeners,
    move(next: CompanionPlayRegionState) { region = next; for (const listener of [...listeners]) listener(); },
    setChat(next: boolean) { chat = next; } };
}

test('an invite is only sent from an outpost with chat ready', async () => {
  const h = harness();
  await h.party.invite('Mo Kai');
  h.move(outpost(55, 'a', 1));
  assert.equal(h.party.unavailable(), 'Invite players from an outpost');
  await assert.rejects(h.party.invite('Mo Kai'), /from an outpost/);
  h.move(outpost(55)); h.setChat(false);
  await assert.rejects(h.party.invite('Mo Kai'), /chat is not ready/);
  assert.deepEqual(h.invited, ['Mo Kai']);
});

test('Travel and invite waits for a settled arrival in the friend outpost, then invites once', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  assert.equal(h.party.travelUnavailable({ ...friend, mapId: 55 }), 'You are already in this outpost');
  await assert.rejects(h.party.travelAndInvite({ ...friend, mapId: 55 }, 1), /already in this outpost/);
  const { invited } = await h.party.travelAndInvite(friend, 1);
  assert.equal(h.party.unavailable(), 'Travelling. The invite follows on arrival.');
  await assert.rejects(h.party.travelAndInvite(friend, 1), /Travelling/);
  h.move(loading);
  h.move(outpost(449));
  context.mock.timers.tick(1_999);
  h.move(loading);
  context.mock.timers.tick(10);
  assert.deepEqual(h.invited, [], 'a loading screen restarts the settle time');
  h.move(outpost(449));
  context.mock.timers.tick(2_000);
  await invited;
  assert.deepEqual(h.invited, ['Mo Kaiser']);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.party.unavailable(), null);
});

test('Travel and invite never invites after a refused trip, a character change or a timeout', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const refused = harness({ travel: async () => { throw new Error('This friend’s location changed. Select them again.'); } });
  await assert.rejects(refused.party.travelAndInvite(friend, 1), /location changed/);
  assert.equal(refused.listeners.size, 0);
  assert.equal(refused.party.unavailable(), null);

  const switched = harness();
  const { invited: switchedInvite } = await switched.party.travelAndInvite(friend, 1);
  switched.move(outpost(449, 'b'));
  await assert.rejects(switchedInvite, /character changed/);

  const stuck = harness();
  const { invited: stuckInvite } = await stuck.party.travelAndInvite(friend, 1);
  context.mock.timers.tick(60_000);
  await assert.rejects(stuckInvite, /Travel did not finish/);
  assert.deepEqual([...refused.invited, ...switched.invited, ...stuck.invited], []);
});
