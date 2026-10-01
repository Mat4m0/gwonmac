import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHubSettingsChange, HUB_SETTINGS_FIELDS } from '../../src/shared/hub-settings.js';

test('Hub settings accepts in-game changes and rejects launcher administration', () => {
  assert.deepEqual(parseHubSettingsChange({ kind: 'settings', patch: { uiStyle: 'obsidian', uiPanelOpacity: 80, uiTextSize: 200 } }), { kind: 'settings', patch: { uiStyle: 'obsidian', uiPanelOpacity: 80, uiTextSize: 200 } });
  // Every game setting is changeable in game, including the one that applies after a restart (docs/settings.md).
  assert.deepEqual(parseHubSettingsChange({ kind: 'settings', patch: { extendedMemoryEnabled: true, showDiagnostics: true } }), { kind: 'settings', patch: { extendedMemoryEnabled: true, showDiagnostics: true } });
  for (const patch of [{ autoCheckUpdates: false }, { updateTrack: 'beta' }, { unknown: true }, { uiPanelOpacity: 14 }, { uiTextSize: 99 }, { uiTextSize: 201 }, { uiTextSize: 100.5 }, { uiTextSize: '200' }, { uiStyle: 'invented' }]) assert.throws(() => parseHubSettingsChange({kind:'settings',patch}));
  for (const value of [null, [], {kind:'master',enabled:'true'}, {kind:'tool',tool:'unknown',enabled:true}, {kind:'tool',tool:'whispers',enabled:true,profile:'another'}, {kind:'shortcut',action:'invalid',binding:null}, {kind:'shortcut',action:'character.switch',binding:{key:'ee',shift:false,option:false}}]) assert.throws(() => parseHubSettingsChange(value));
  assert.ok(!HUB_SETTINGS_FIELDS.some(field => String(field) === 'updateTrack'));
});
test('Hub settings routes feature and shortcut intent without arbitrary settings writes', () => {
  assert.deepEqual(parseHubSettingsChange({kind:'tool',tool:'whispers',enabled:false}),{kind:'tool',tool:'whispers',enabled:false});
  assert.deepEqual(parseHubSettingsChange({kind:'master',enabled:true}),{kind:'master',enabled:true});
  assert.deepEqual(parseHubSettingsChange({kind:'shortcut',action:'character.switch',binding:null}),{kind:'shortcut',action:'character.switch',binding:null});
});
