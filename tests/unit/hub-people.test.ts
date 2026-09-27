/** Hub people search: every known name source, the typed exact name, and source switches. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHubPeople } from '../../src/renderer/hub-people.ts';
import { createPartyInvite, type PartyInvite } from '../../src/renderer/party-invite.ts';
import type { TravelFriend } from '../../src/shared/friends.ts';
import type { HubRow, HubSource, HubTask } from '../../src/shared/hub.ts';
import { createWhisperSession } from '../../src/shared/whisper-session.ts';

const KAISER = 'Kai Account|Mo Kaiser · online · Kamadan, Jewel of Istan';

type Harness = {
  search(query: string): string[]; source: HubSource; session: ReturnType<typeof createWhisperSession>;
  page(): readonly HubRow[]; receipts: string[]; setFriends(friends: readonly TravelFriend[]): void;
};
type FriendTravel = Parameters<typeof createHubPeople>[2];
let currentReceipts: string[] = [];
/** A task on a page that still shows: its receipt is what closing the Hub shows. */
const task: HubTask = { live: () => true, progress() {}, done(receipt) { if (receipt) currentReceipts.push(receipt); } };
function withPeople(settings: Record<string, boolean>, run: (people: Harness) => void | Promise<void>, party: PartyInvite | null = null,
  travel: FriendTravel = { unavailable: () => null, run: async () => {} }) {
  const originalWindow = globalThis.window;
  const browserWindow = Object.assign(new EventTarget(), { gwToolsSettings: () => settings });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow });
  let source: HubSource | null = null;
  let page: () => readonly HubRow[] = () => [];
  const receipts: string[] = [];
  currentReceipts = receipts;
  const session = createWhisperSession(async () => {});
  session.setAvailable(true);
  const people = createHubPeople({
    showRows(_title, rows) { page = rows; }, attach(next) { source = next; return () => {}; },
    notify(message) { receipts.push(message); },
  }, session, travel, party);
  const finish = () => {
    people.dispose();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  };
  try {
    people.setEnabled(true);
    const setFriends = (list: readonly TravelFriend[]) => {
      const friends = { status: 'ready' as const, sequence: 1, generation: 1, friends: list };
      session.updateFriends(friends); people.updateFriends(friends);
    };
    setFriends([{ key: 'f', character: 'Mo Kaiser', alias: 'Kai Account', status: 'online', mapId: 449 }]);
    session.observe([{ id: 1, sender: 'Moira Chatter', direction: 'participant' }]);
    const result = run({ source: source!, session, receipts, page: () => page(), setFriends,
      search: query => source!.search(query).map(row => `${row.title}|${row.detail}`) });
    if (result instanceof Promise) return result.finally(finish);
  } catch (error) { finish(); throw error; }
  finish();
}
const ALL_TOOLS = { gwonmacTools: true, whispersEnabled: true, travelPalette: true };

test('Hub finds names seen in chat beside friends', () => withPeople(ALL_TOOLS, ({ search }) => {
  assert.deepEqual(search('mo'), [KAISER, 'Moira Chatter|Seen in chat']);
}));

test('Hub keeps an addressed full name reachable and spelled as typed', () => withPeople(ALL_TOOLS, ({ search, source, session }) => {
  assert.deepEqual(search('Mo Kai'), [KAISER], 'unscoped search offers only known people');
  const scoped = source.search('whisper Mo\u00a0Kai ');
  assert.deepEqual(scoped.map(row => `${row.title}|${row.action}`), ['Kai Account|Write whisper', 'Mo Kai|Write whisper'],
    'Enter on a partial name still chooses the known person');
  void scoped[1]!.run(task);
  assert.deepEqual(session.state.conversations.map(c => c.name), ['Mo Kai']);
  assert.deepEqual(source.search('whisper Mo Kaiser').map(row => row.title), ['Kai Account'], 'an exact known name is not offered twice');
}));

test('Hub respects the Messenger source switches', () => withPeople(ALL_TOOLS, ({ search, session }) => {
  session.setSuggest('chat', false);
  assert.deepEqual(search('moira'), []);
}));

test('Hub without Whispers keeps friend search only', () => withPeople({ gwonmacTools: true, whispersEnabled: false, travelPalette: true }, ({ search }) => {
  assert.deepEqual(search('mo'), [KAISER]);
  assert.deepEqual(search('Mo Kai'), [KAISER]);
}));

const invitePort = (overrides: Partial<PartyInvite> = {}) => {
  const calls: string[] = [];
  const party: PartyInvite = {
    unavailable: () => null, travelUnavailable: () => null,
    invite: async name => { calls.push(`invite:${name}`); },
    travelAndInvite: async (friend) => { calls.push(`travel:${friend.character}`); return { invited: Promise.resolve() }; },
    dispose() {},
    ...overrides,
  };
  return { party, calls };
};
const actions = (rows: readonly HubRow[]) => rows.map(row => `${row.title}${row.unavailable ? ` (${row.unavailable})` : ''}`);

test('a person page offers Invite to party and, for a friend elsewhere, Travel and invite', async () => {
  const { party, calls } = invitePort();
  await withPeople(ALL_TOOLS, async ({ source, page, receipts }) => {
    void source.search('moira')[0]!.run(task);
    assert.deepEqual(actions(page()), ['Whisper', 'Invite to party']);
    await page().find(row => row.id === 'person:invite')!.run(task);
    void source.search('mo kaiser')[0]!.run(task);
    assert.deepEqual(actions(page()), ['Whisper', 'Travel to outpost', 'Invite to party', 'Travel and invite']);
    await page().find(row => row.id === 'person:travel-invite')!.run(task);
    await Promise.resolve();
    assert.deepEqual(calls, ['invite:Moira Chatter', 'travel:Mo Kaiser']);
    assert.deepEqual(receipts, [
      'Sent /invite Moira Chatter. Guild Wars answers in chat.',
      'Travelling to Kamadan, Jewel of Istan. Hub sends /invite Mo Kaiser on arrival.',
      'Sent /invite Mo Kaiser. Guild Wars answers in chat.',
    ], 'receipts claim only the sent command, never an accepted invite');
  }, party);
});

test('invite rows explain why they are unavailable and stay absent without Whispers', async () => {
  const { party } = invitePort({ unavailable: () => 'Invite players from an outpost', travelUnavailable: () => 'You are already in this outpost' });
  await withPeople(ALL_TOOLS, ({ source, page }) => {
    void source.search('mo kaiser')[0]!.run(task);
    assert.deepEqual(actions(page()).slice(2), ['Invite to party (Invite players from an outpost)', 'Travel and invite (You are already in this outpost)']);
  }, party);
  await withPeople({ gwonmacTools: true, whispersEnabled: false, travelPalette: true }, ({ source, page }) => {
    void source.search('mo kaiser')[0]!.run(task);
    assert.deepEqual(actions(page()), ['Travel to outpost']);
  }, party);
});

test('the invite scope invites only an exact name, first, and names it in the footer', async () => {
  const { party, calls } = invitePort();
  await withPeople(ALL_TOOLS, async ({ source, session, page, receipts }) => {
    session.observe([{ id: 2, sender: 'Mo Kaiser Bearer', direction: 'participant' }]);
    const rows = source.search('invite Mo Kai');
    assert.deepEqual(rows.map(row => `${row.title}|${row.detail}|${row.action}`),
      ['Mo Kai|Character name|Invite Mo Kai', `${KAISER}|View actions`, 'Mo Kaiser Bearer|Seen in chat|View actions']);
    await rows[1]!.run(task);
    await rows[2]!.run(task);
    assert.deepEqual(calls, [], 'a prefix row opens the person page and never invites');
    assert.deepEqual(actions(page()), ['Whisper', 'Invite to party']);
    await rows[0]!.run(task);
    assert.deepEqual(calls, ['invite:Mo Kai']);
    assert.equal(receipts.at(-1), 'Sent /invite Mo Kai. Guild Wars answers in chat.');

    const exact = source.search('invite Mo Kaiser');
    assert.deepEqual(exact.map(row => `${row.title}|${row.action}`), ['Kai Account|Invite Mo Kaiser', 'Mo Kaiser Bearer|View actions'],
      'an exact friend is invited by character name');
    await exact[0]!.run(task);
    assert.deepEqual(source.search('invite Kai Account').map(row => row.action), ['Invite Mo Kaiser'], 'an exact alias names the character');
    for (const row of source.search('invite m')) if (!row.id.startsWith('person:typed:')) await row.run(task);
    assert.deepEqual(calls, ['invite:Mo Kai', 'invite:Mo Kaiser'], 'chat and friend prefixes never invite');
  }, party);
  await withPeople(ALL_TOOLS, ({ source }) => {
    assert.deepEqual(source.search('invite Mo Kai'), [], 'no invite scope without the certified invite');
  });
});

test('a single typed word never becomes the default invite', async () => {
  const { party, calls } = invitePort();
  await withPeople(ALL_TOOLS, ({ source, page }) => {
    assert.deepEqual(source.search('invite z').map(row => `${row.title}|${row.unavailable ?? row.action}`),
      ['z|Type the full character name'], 'nothing known matches, so the partial name says why');
    assert.deepEqual(source.search('invite Mo').map(row => `${row.title}|${row.unavailable ?? row.action}`),
      ['Kai Account|View actions', 'Moira Chatter|View actions', 'Mo|Type the full character name'],
      'known people come first; the partial name stays last');
    void source.search('whisper Mo').find(row => row.id.startsWith('person:typed:'))!.actions!();
    assert.equal(page().find(row => row.id === 'person:invite')!.unavailable, 'Type the full character name');
    assert.deepEqual(calls, []);
  }, party);
});

test('Invite is unavailable for a friend in another map and says where they are', async () => {
  const invited: string[] = [];
  const region = { status: 'ready', sequence: 1, mapId: 55, instanceType: 0, playRegion: 'pve', travelContext: 'world', characterKey: 'a',
    unlockedMapWords: null, guildHall: false, hasGuildHall: false } as const;
  const party = createPartyInvite({ region: () => region, subscribeRegion: () => () => {}, chatReady: () => true,
    invite: async name => { invited.push(name); }, travel: async () => {} });
  await withPeople(ALL_TOOLS, async ({ source, page }) => {
    const reason = 'Mo Kaiser is in Kamadan, Jewel of Istan. Use Travel and invite.';
    void source.search('mo kaiser')[0]!.run(task);
    const invite = page().find(row => row.id === 'person:invite')!;
    assert.equal(invite.unavailable, reason);
    assert.equal(invite.action, 'Invite Mo Kaiser');
    assert.equal(page().find(row => row.id === 'person:travel-invite')!.unavailable, undefined);
    await assert.rejects(Promise.resolve(invite.run(task)), /is in Kamadan/);
    assert.equal(source.search('invite Mo Kaiser')[0]!.unavailable, reason);
    void source.search('moira')[0]!.run(task);
    assert.equal(page().find(row => row.id === 'person:invite')!.unavailable, undefined, 'a chat name has no known map');
    assert.deepEqual(invited, []);
  }, party);
});

function lionsArchInvite() {
  const region = { status: 'ready', sequence: 1, mapId: 55, instanceType: 0, playRegion: 'pve', travelContext: 'world', characterKey: 'a',
    unlockedMapWords: null, guildHall: false, hasGuildHall: false } as const;
  return createPartyInvite({ region: () => region, subscribeRegion: () => () => {}, chatReady: () => true, invite: async () => {}, travel: async () => {} });
}

test('Invite points to Travel and invite only when that row is shown and can start', async () => {
  const elsewhere = 'Mo Kaiser is in Kamadan, Jewel of Istan.';
  const inviteReason = (page: () => readonly HubRow[]) => page().find(row => row.id === 'person:invite')!.unavailable;
  await withPeople({ gwonmacTools: true, whispersEnabled: true, travelPalette: false }, ({ source, page }) => {
    void source.search('mo kaiser')[0]!.run(task);
    assert.deepEqual(actions(page()), ['Whisper', `Invite to party (${elsewhere})`], 'a hidden Travel palette is never pointed to');
    assert.equal(source.search('invite Mo Kaiser')[0]!.unavailable, elsewhere);
  }, lionsArchInvite());
  await withPeople(ALL_TOOLS, ({ source, page }) => {
    void source.search('mo kaiser')[0]!.run(task);
    assert.equal(page().find(row => row.id === 'person:travel-invite')!.unavailable, 'Travel is busy');
    assert.equal(inviteReason(page), elsewhere, 'an unavailable Travel is never pointed to');
    assert.equal(source.search('invite Mo Kaiser')[0]!.unavailable, elsewhere);
  }, lionsArchInvite(), { unavailable: () => 'Travel is busy', run: async () => {} });
  await withPeople(ALL_TOOLS, ({ source, page, setFriends }) => {
    setFriends([{ key: 'f', character: 'Mo Kaiser', alias: 'Kai Account', status: 'online', mapId: 188 }]);
    void source.search('mo kaiser')[0]!.run(task);
    assert.equal(page().find(row => row.id === 'person:travel-invite')!.unavailable, 'Invites from Hub need a PvE outpost');
    assert.equal(inviteReason(page), 'Mo Kaiser is in Random Arenas.', 'a PvP outpost is never pointed to');
  }, lionsArchInvite());
});

test('`invite ` lists the online friends as named invites, those invitable now first', async () => {
  const { party, calls } = invitePort({ unavailable: friend => friend?.mapId === 55 ? null : 'Elsewhere' });
  await withPeople(ALL_TOOLS, async ({ source, setFriends }) => {
    setFriends([
      { key: 'z', character: 'Zed Delta', alias: 'Zed', status: 'away', mapId: 55 },
      { key: 'f', character: 'Mo Kaiser', alias: 'Kai Account', status: 'online', mapId: 449 },
      { key: 'o', character: '', alias: 'Offline Friend', status: 'offline', mapId: 0 },
      { key: 'u', character: 'Unknown Status', alias: 'Unknown', status: 'unknown', mapId: 55 },
    ]);
    const rows = source.search('invite ');
    assert.deepEqual(rows.map(row => `${row.title}|${row.action}|${row.unavailable ?? ''}`), ['Zed|Invite Zed Delta|', 'Kai Account|Invite Mo Kaiser|Elsewhere'],
      'online friends by character name; offline and unknown friends are left out');
    await rows[0]!.run(task);
    assert.deepEqual(calls, ['invite:Zed Delta']);
    assert.deepEqual(source.search('whisper '), [], 'a bare whisper scope lists only conversations that need the player');
  }, party);
  await withPeople(ALL_TOOLS, ({ source }) => {
    assert.deepEqual(source.search('invite '), [], 'no invite scope without the certified invite');
  });
});
