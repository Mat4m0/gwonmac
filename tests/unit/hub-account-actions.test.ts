import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activateHubAccount, hubAccountSnapshot } from '../../src/main/hub-account-actions.js';
import { parseHubAccountRequest } from '../../src/main/accounts-ipc-values.js';
import { parseProfileId } from '../../src/shared/multiple-accounts.js';
import type { HubRow } from '../../src/shared/hub.js';
import type { LauncherProfileSummary } from '../../src/shared/launcher-contracts.js';
const current = parseProfileId('9e1bd41c-cfc0-4ca8-a57f-2f0ca159c72d');
const second = parseProfileId('e98a37bc-5211-4bc5-8094-0b1286b3c42d');
function fixture() {
  let profiles: LauncherProfileSummary[] = [current, second].map((id, index) => ({ id, name: index ? 'Second' : 'Main', archived: false, state: index ? 'ready' : 'running', appearance: { icon: 'shield', color: '#496b58' } }));
  const events: string[] = [];
  const accounts = { profiles: () => profiles, async activate(id: typeof current) { events.push('open'); profiles = profiles.map(profile => profile.id === id ? { ...profile, state: 'running' } : profile); } };
  return { accounts, events, close: async () => { events.push('close'); }, setState(state: LauncherProfileSummary['state']) { profiles = profiles.map(profile => profile.id === second ? { ...profile, state } : profile); } };
}
test('account choices open first and close only the source on explicit replacement', async () => {
  const f = fixture();
  assert.deepEqual(hubAccountSnapshot(f.accounts, current).profiles.map(p => p.name), ['Main', 'Second']);
  await activateHubAccount(f.accounts, current, { id: second, mode: 'open' }, f.close);
  assert.deepEqual(f.events, ['open']);
  await activateHubAccount(f.accounts, current, { id: second, mode: 'replace' }, f.close);
  assert.deepEqual(f.events, ['open', 'open', 'close']);
});
test('failed, incomplete, current and duplicate activations never close the source', async () => {
  const f = fixture();
  await assert.rejects(activateHubAccount({ ...f.accounts, activate: async () => { throw new Error('offline'); } }, current, { id: second, mode: 'replace' }, f.close), /offline/);
  await assert.rejects(activateHubAccount({ ...f.accounts, activate: async () => {} }, current, { id: second, mode: 'replace' }, f.close), /did not open/);
  await assert.rejects(activateHubAccount(f.accounts, current, { id: current, mode: 'replace' }, f.close), /another/);
  f.setState('opening');
  await assert.rejects(activateHubAccount(f.accounts, current, { id: second, mode: 'replace' }, f.close), /still opening/);
  assert.deepEqual(f.events, []);
  f.setState('ready');
  let release!: () => void;
  const pending = activateHubAccount({ ...f.accounts, activate: () => new Promise<void>(resolve => { release = resolve; }) }, current, { id: second, mode: 'replace' }, f.close);
  await assert.rejects(activateHubAccount(f.accounts, current, { id: second, mode: 'open' }, f.close), /already opening/);
  release(); await assert.rejects(pending, /did not open/);
  assert.deepEqual(f.events, []);
});
test('the account request cannot supply a source account or an arbitrary operation', () => {
  assert.deepEqual(parseHubAccountRequest({ id: second, mode: 'open' }), { id: second, mode: 'open' });
  for (const input of [null, { id: second, mode: 'delete' }, { id: second, mode: 'replace', current }, { id: '../other', mode: 'open' }]) assert.throws(() => parseHubAccountRequest(input));
});

test('Hub account choices reload on rename before any account operation', async () => {
  const { createHubAccounts } = await import('../../src/renderer/hub-accounts.js');
  let snapshot = hubAccountSnapshot(fixture().accounts, current);
  let displayed: readonly HubRow[] = [];
  let opened = false;
  const source = createHubAccounts({ close() {}, attach: () => () => {}, showView() {}, showRows(_title, rows) { displayed = rows(); } }, { get: async () => snapshot, open: async () => { opened = true; } });
  source.setVisible(true); await Promise.resolve();
  const action = source.search('acc second')[0]!;
  snapshot = { ...snapshot, profiles: snapshot.profiles.map(profile => profile.id === second ? { ...profile, name: 'Renamed' } : profile) };
  await assert.rejects(async () => action.run(), /Accounts changed/u);
  assert.equal(opened, false);
  assert.ok(displayed.some(row => row.title === 'Renamed'));
  assert.ok(source.search('acc renamed').some(row => row.title.includes('Renamed')));
});
