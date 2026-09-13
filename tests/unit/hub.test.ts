/** Search and shortcut refusal tests for the Core palette. */
import { currentTravelFriend, type TravelFriend, type TravelFriends } from '../../src/shared/friends.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchHubRows, parseHubQuery, type HubRow } from '../../src/shared/hub.js';
import { resolveShortcuts, hubShortcutAvailable } from '../../src/shared/keyboard-shortcuts.js';
const row = (id: string, title: string, keywords = ''): HubRow => ({ id, title, keywords, group: 'Commands', detail: '', action: 'Open', run() {} });
test('search ranks exact names and prefixes before keywords without executing anything', () => {
  const rows = [row('alias', 'Travel', 'Romi'), row('prefix', 'Romi Ranger'), row('exact', 'Romi')];
  assert.deepEqual(matchHubRows(rows, 'romi').map(row => row.id), ['exact', 'prefix', 'alias']);
  assert.deepEqual(matchHubRows(rows, 'RANGER romi').map(row => row.id), ['prefix']);
  assert.equal(matchHubRows(rows, 'unknown').length, 0);
});
test('Hub and Switch Character defaults preserve custom and cleared overrides', () => {
  assert.equal(hubShortcutAvailable({}), true);
  assert.equal(hubShortcutAvailable({ 'travel.open': { key: 'r', shift: false, option: false } }), false);
  const resolved = resolveShortcuts({ 'game.resign': { key: 'r', shift: true, option: false } });
  assert.equal(resolved['character.switch']?.key, 'e');
  assert.equal(resolved['game.resign']?.key, 'r');
  assert.equal(resolveShortcuts({ 'character.switch': null })['character.switch'], null);
  assert.equal(resolveShortcuts({})['game.resign'], null);
});

test('friend travel refuses stale generations, new characters, moved and offline friends', () => {
  const selected: TravelFriend = { key: 'friend', alias: 'Friend', character: 'Friend Ranger', mapId: 449, status: 'online' };
  const feed: TravelFriends = { status: 'ready', generation: 1, sequence: 1, friends: [selected] };
  assert.equal(currentTravelFriend(feed, selected, 1), selected);
  assert.equal(currentTravelFriend(feed, selected, 2), null);
  assert.equal(currentTravelFriend({ status: 'waiting', reason: 'unavailable' }, selected, 1), null);
  for (const changed of [{ ...selected, mapId: 55 }, { ...selected, character: 'Friend Monk' }, { ...selected, status: 'offline' as const }]) {
    assert.equal(currentTravelFriend({ ...feed, friends: [changed] }, selected, 1), null);
  }
});

test('Hub preserves diacritics, refuses typos and does not match inside words', () => {
  const rows = [row('one', 'Smiter'), row('two', 'Rómi')];
  assert.equal(matchHubRows(rows, 'smtier').length, 0);
  assert.equal(matchHubRows(rows, 'miter').length, 0);
  assert.equal(matchHubRows(rows, 'romi').length, 0);
  assert.equal(matchHubRows(rows, 'SMI').length, 1);
});

test('explicit scopes never reinterpret the remaining words as another action', () => {
  assert.deepEqual(parseHubQuery(' TEAM  gom AFK '), { scope: 'team', term: 'gom afk' });
  assert.deepEqual(parseHubQuery('build smiter'), { scope: 'build', term: 'smiter' });
  assert.deepEqual(parseHubQuery('team'), { scope: null, term: 'team' });
  assert.deepEqual(parseHubQuery('gmo afk'), { scope: null, term: 'gmo afk' });
});

test('saved phrases reject grammar conflicts and private references in global settings', async () => {
  const { isHubShortcuts } = await import('../../src/shared/hub-preferences.ts');
  const { parseRendererSettingsPatch } = await import('../../src/main/core/settings.ts');
  assert.equal(isHubShortcuts([{ id: 'travel', phrase: 'travel home', pinned: false }]), false);
  assert.equal(isHubShortcuts([{ id: 'travel', phrase: 'ecto', pinned: false }]), false);
  assert.equal(isHubShortcuts([{ id: 'travel', phrase: 'home', pinned: false }, { id: 'trade', phrase: 'HOME', pinned: false }]), false);
  assert.throws(() => parseRendererSettingsPatch({ hubShortcuts: [{ id: 'build:private', phrase: 'my build', pinned: true }] }), /Invalid Hub/);
});


test('search phrases reject command scopes and calculator expressions', async () => {
  const { isHubShortcuts } = await import('../../src/shared/hub-preferences.js');
  for (const phrase of ['acc second', 'team gom afk', '1p in a', '1 p in g', '10e in p', '2+2']) {
    assert.equal(isHubShortcuts([{ id: 'travel', phrase, pinned: false }]), false, phrase);
  }
  assert.equal(isHubShortcuts([{ id: 'travel', phrase: 'my route', pinned: false }]), true);
});
