import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activateHubAccount, hubAccountSnapshot } from '../../src/main/hub-account-actions.js';
import { parseHubAccountRequest } from '../../src/main/accounts-ipc-values.js';
import { parseProfileId } from '../../src/shared/multiple-accounts.js';
import type { HubRow, HubTask } from '../../src/shared/hub.js';
import type { LauncherProfileSummary } from '../../src/shared/launcher-contracts.js';
const task: HubTask = { live: () => true, progress() {}, done() {} };
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
  const source = createHubAccounts({ close() {}, notify() {}, attach: () => () => {}, showView() {}, showRows(_title, rows) { displayed = rows(); }, direct(_destination, open) { open(); } }, { get: async () => snapshot, open: async () => { opened = true; } });
  source.setVisible(true); await Promise.resolve();
  const action = source.search('acc second')[0]!;
  snapshot = { ...snapshot, profiles: snapshot.profiles.map(profile => profile.id === second ? { ...profile, name: 'Renamed' } : profile) };
  await assert.rejects(async () => action.run(task), /Accounts changed/u);
  assert.equal(opened, false);
  assert.ok(displayed.some(row => row.title === 'Renamed'));
  assert.ok(source.search('acc renamed').some(row => row.title.includes('Renamed')));
});

test('Hub account actions keep the running game first and name each consequence (D-23)', async () => {
  const { createHubAccounts } = await import('../../src/renderer/hub-accounts.js');
  for (const [state, detail, title] of [['ready', 'Saved account', 'Open Second'], ['running', 'Running', 'Show Second']] as const) {
    const f = fixture(); f.setState(state);
    const snapshot = hubAccountSnapshot(f.accounts, current);
    const source = createHubAccounts({ close() {}, notify() {}, attach: () => () => {}, showView() {}, showRows() {}, direct() {} }, { get: async () => snapshot, open: async () => {} });
    source.setVisible(true); await Promise.resolve();
    assert.equal(source.search('acc ').find(row => row.title === 'Second')?.detail, detail);
    assert.deepEqual(source.search('acc second').map(row => [row.title, row.action, row.detail, !!row.destructive]), [
      [title, title, 'Keep Main running', false],
      ['Close Main and open Second', 'Close Main and open Second', 'Closes Main', true],
    ]);
  }
});

test('Hub accounts name their loading and failed reads instead of acting or finding nothing (HUB-232, HUB-233)', async () => {
  const { createHubAccounts } = await import('../../src/renderer/hub-accounts.js');
  const hub = { close() {}, notify() {}, attach: () => () => {}, showView() {}, showRows() {}, direct() {} };
  let fail!: (error: Error) => void;
  const events: string[] = [];
  const source = createHubAccounts(hub, { get: () => new Promise((_resolve, reject) => { fail = reject; }), open: async () => {}, manage: async () => { events.push('launcher'); } });
  source.setVisible(true);
  // Enter on the loading row is refused by its unavailable reason; it never shows the Launcher.
  assert.deepEqual(source.search('acc ').map(row => [row.title, row.unavailable]), [['Loading accounts…', 'Accounts are still loading.']]);
  fail(new Error('offline')); await Promise.resolve(); await Promise.resolve();
  for (const query of ['acc ', 'acc second']) assert.deepEqual(source.search(query).map(row => row.title), ['Retry accounts']);
  assert.deepEqual(events, []);
});
