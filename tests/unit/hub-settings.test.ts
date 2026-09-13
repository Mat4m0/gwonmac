import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHubSettingsChange, HUB_SETTINGS_FIELDS } from '../../src/shared/hub-settings.js';

test('Hub settings accepts in-game changes and rejects launcher administration', () => {
  assert.deepEqual(parseHubSettingsChange({ kind: 'settings', patch: { uiStyle: 'obsidian', uiPanelOpacity: 80 } }), { kind: 'settings', patch: { uiStyle: 'obsidian', uiPanelOpacity: 80 } });
  for (const patch of [{ autoCheckUpdates: false }, { updateTrack: 'beta' }, { showDiagnostics: true }, { unknown: true }, { uiPanelOpacity: 14 }, { uiStyle: 'invented' }]) assert.throws(() => parseHubSettingsChange({kind:'settings',patch}));
  for (const value of [null, [], {kind:'master',enabled:'true'}, {kind:'tool',tool:'unknown',enabled:true}, {kind:'tool',tool:'whispers',enabled:true,profile:'another'}, {kind:'shortcut',action:'invalid',binding:null}, {kind:'shortcut',action:'character.switch',binding:{key:'ee',shift:false,option:false}}]) assert.throws(() => parseHubSettingsChange(value));
  assert.ok(!HUB_SETTINGS_FIELDS.some(field => String(field) === 'updateTrack'));
});
test('Hub settings routes feature and shortcut intent without arbitrary settings writes', () => {
  assert.deepEqual(parseHubSettingsChange({kind:'tool',tool:'whispers',enabled:false}),{kind:'tool',tool:'whispers',enabled:false});
  assert.deepEqual(parseHubSettingsChange({kind:'master',enabled:true}),{kind:'master',enabled:true});
  assert.deepEqual(parseHubSettingsChange({kind:'shortcut',action:'character.switch',binding:null}),{kind:'shortcut',action:'character.switch',binding:null});
});
