/** Party invite and Travel-then-invite: outpost gate, fresh arrival, one invite, no retry, PvE only. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanionPlayRegionState } from '../../src/renderer/companion-play-region-snapshot.ts';
import { createPartyInvite } from '../../src/renderer/party-invite.ts';
import type { TravelFriend } from '../../src/shared/friends.ts';

const outpost = (mapId: number, characterKey: string | null = 'a', instanceType = 0, playRegion = 'pve') => ({
  status: 'ready', sequence: 1, mapId, instanceType, playRegion, travelContext: 'world', characterKey,
  unlockedMapWords: null, guildHall: false, hasGuildHall: false,
}) as unknown as CompanionPlayRegionState;
const loading = { status: 'waiting', reason: 'stale' } as const;
const friend: TravelFriend = { key: 'f', character: 'Mo Kaiser', alias: 'Kai', status: 'online', mapId: 449 };

function harness(options: { travel?: () => Promise<void>; start?: CompanionPlayRegionState } = {}) {
  let region: CompanionPlayRegionState = options.start ?? outpost(55);
  let trips = 0;
  let chat = true;
  const listeners = new Set<() => void>();
  const invited: string[] = [];
  const party = createPartyInvite({
    region: () => region,
    subscribeRegion: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    chatReady: () => chat,
    invite: async name => { invited.push(name); },
    travel: options.travel ?? (async () => { trips++; }),
    settleMs: 2_000, arrivalTimeoutMs: 60_000,
  });
  return { party, invited, listeners, trips: () => trips,
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

test('Invite is unavailable for a friend in another map and names where they are', () => {
  const h = harness();
  assert.equal(h.party.unavailable(friend), 'Mo Kaiser is in Kamadan, Jewel of Istan. Use Travel and invite.');
  assert.equal(h.party.unavailable({ ...friend, mapId: 55 }), null);
  assert.equal(h.party.unavailable(), null, 'a name without a known map is not refused');
});

test('Invite points to Travel and invite only where Travel and invite can start', () => {
  const h = harness();
  assert.equal(h.party.unavailable({ ...friend, mapId: 0 }), 'Mo Kaiser is in another map.', 'an explorable area is no travel destination');
  assert.equal(h.party.unavailable({ ...friend, mapId: 188 }), 'Mo Kaiser is in Random Arenas.', 'Travel and invite refuses a PvP outpost');
  assert.equal(h.party.travelUnavailable({ ...friend, mapId: 188 }), 'Invites from Hub need a PvE outpost');
});

test('Travel and invite from the first outpost after login adopts the first known character key', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const known of [false, true]) {
    const h = harness({ start: outpost(55, null) });
    const { invited } = await h.party.travelAndInvite(friend, 1);
    if (known) h.move(outpost(55, 'a'));
    h.move(loading);
    h.move(outpost(449, 'a'));
    context.mock.timers.tick(2_000);
    await invited;
    assert.deepEqual(h.invited, ['Mo Kaiser'], known ? 'key published before departure' : 'key published on arrival');
  }
  const h = harness({ start: outpost(55, null) });
  const { invited } = await h.party.travelAndInvite(friend, 1);
  h.move(outpost(55, 'a'));
  h.move(outpost(449, 'b'));
  await assert.rejects(invited, /character changed/);
  assert.deepEqual(h.invited, []);
});

test('Travel and invite never sends from a relogged character that publishes no key yet', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const relogged = harness();
  const { invited } = await relogged.party.travelAndInvite(friend, 1);
  relogged.move({ status: 'waiting', reason: 'game' });
  relogged.move(outpost(449, null));
  context.mock.timers.tick(2_000);
  await assert.rejects(invited, /character changed\. The invite was not sent/, 'character selection withdraws the invite');
  assert.equal(relogged.listeners.size, 0);

  const unknown = harness();
  const { invited: unknownInvite } = await unknown.party.travelAndInvite(friend, 1);
  unknown.move(loading);
  unknown.move(outpost(449, null));
  context.mock.timers.tick(2_000);
  assert.deepEqual(unknown.invited, [], 'a null key after a known one is no arrival');
  unknown.move(outpost(449, 'b'));
  await assert.rejects(unknownInvite, /character changed/);
  assert.deepEqual([...relogged.invited, ...unknown.invited], []);
});

test('Travel and invite refuses a PvP outpost up front and a non-PvE arrival at once', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  for (const mapId of [188, 330]) {
    assert.equal(h.party.travelUnavailable({ ...friend, mapId }), 'Invites from Hub need a PvE outpost');
    await assert.rejects(h.party.travelAndInvite({ ...friend, mapId }, 1), /need a PvE outpost/);
  }
  assert.equal(h.trips(), 0);
  const { invited } = await h.party.travelAndInvite(friend, 1);
  h.move(outpost(449, 'a', 0, 'pvp'));
  await assert.rejects(invited, /need a PvE outpost\. The invite was not sent/);
  assert.equal(h.listeners.size, 0, 'no 60 s wait');
  context.mock.timers.tick(60_000);
  assert.deepEqual(h.invited, []);
});

test('dispose withdraws a pending arrival, so no invite is sent after Tools leave', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const { invited } = await h.party.travelAndInvite(friend, 1);
  h.party.dispose();
  await assert.rejects(invited, /The invite was not sent/);
  h.move(outpost(449));
  context.mock.timers.tick(2_000);
  assert.deepEqual(h.invited, []);
  assert.equal(h.listeners.size, 0);
});
