// A saved Hub phrase is player data. A later release can make its first word a
// scope (`invite`, 2026.9) or a calculator unit, and the query grammar then wins
// at search time: the old phrase simply stops matching. What must never happen
// is the load-time validator treating that phrase as corruption, because
// settings then reset to defaults and the Build Library moves to `*.corrupt-*`.
//
// Stored data is therefore checked for structure only. The phrase editor alone
// refuses grammar words, and only for the phrase being saved.
import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadBuildLibrary } from "../../src/main/core/build-library.ts";
import { loadSettings, parseSettings } from "../../src/main/core/settings.ts";
import { HUB_CALCULATOR_UNITS, HUB_RESERVED_WORDS, hubPhraseReserved } from "../../src/shared/hub-preferences.ts";
import { parseBuildLibrary } from "../../src/shared/builds/parse-library.ts";
import { LIBRARY_VERSION } from "../../src/shared/builds/library.ts";
import { HUB_SCOPES } from "../../src/shared/hub.ts";
import { isHubShortcuts } from "../../src/shared/hub-preferences.ts";

const dir = () => mkdtemp(join(tmpdir(), "gw-hub-phrases-"));
const slot = { build: null, hero: null, behaviour: null };
/** The shape v2026.9.2-beta.1 wrote: team GOM AFK with a pin and a saved phrase. */
const library = (phrase: string) => ({
  version: LIBRARY_VERSION, tags: [],
  builds: [],
  teams: [{ id: "t1", name: "GOM AFK", tags: [], mode: "none", favourite: false, lastUsed: null, notes: "", slots: Array(8).fill(slot) }],
  hubShortcuts: [{ id: "team:t1", phrase, pinned: true }],
});
const settings = (phrase: string) => ({ hubShortcuts: [{ id: "whispers", phrase, pinned: true }, { id: "maps", phrase: "", pinned: true }] });

/** Every word the grammar owns today, as a phrase an older release accepted. */
const legacyPhrases = [
  ...HUB_SCOPES.flatMap(scope => [scope, `${scope} heroes`]),
  ...HUB_RESERVED_WORDS, ...HUB_CALCULATOR_UNITS,
  "1p in g", "10e in p", "2+2",
];

test("a legacy phrase that is now a grammar word keeps parsing, with its pin", () => {
  for (const phrase of legacyPhrases) {
    assert.equal(isHubShortcuts([{ id: "travel", phrase, pinned: true }]), true, phrase);
    assert.deepEqual(parseSettings(settings(phrase)).hubShortcuts, settings(phrase).hubShortcuts, phrase);
    assert.deepEqual(parseBuildLibrary(library(phrase)).hubShortcuts, library(phrase).hubShortcuts, phrase);
  }
});

test("loading the upgraded files quarantines nothing and requests no reset", async () => {
  const folder = await dir();
  const settingsPath = join(folder, "settings.json");
  const libraryPath = join(folder, "build-library.json");
  await writeFile(settingsPath, JSON.stringify(settings("invite")));
  await writeFile(libraryPath, JSON.stringify(library("invite heroes")));
  const recovered: string[] = [];
  const loadedSettings = await loadSettings(settingsPath, backup => { recovered.push(backup); });
  const loadedLibrary = await loadBuildLibrary(libraryPath, backup => { recovered.push(backup); });
  assert.deepEqual(loadedSettings.hubShortcuts, settings("invite").hubShortcuts);
  assert.deepEqual(loadedLibrary.hubShortcuts, [{ id: "team:t1", phrase: "invite heroes", pinned: true }]);
  assert.equal(loadedLibrary.teams[0]?.name, "GOM AFK");
  assert.deepEqual(recovered, []);
  assert.deepEqual((await readdir(folder)).filter(name => name.includes("corrupt")), []);
});

test("stored phrases are refused only for shape, id, length and uniqueness", () => {
  const valid = { id: "travel", phrase: "home", pinned: false };
  assert.equal(isHubShortcuts([valid]), true);
  for (const invalid of [
    [{ ...valid, extra: 1 }], [{ id: "travel", phrase: "home" }], [{ ...valid, id: "hub" }],
    [{ ...valid, phrase: "x".repeat(65) }], [{ ...valid, phrase: "a\u0007" }], [{ ...valid, pinned: "yes" }],
    [valid, { ...valid, phrase: "other" }], [valid, { ...valid, id: "trade", phrase: " HOME " }],
    Array.from({ length: 65 }, (_, index) => ({ id: `place:${index}`, phrase: "", pinned: true })),
  ]) assert.equal(isHubShortcuts(invalid), false, JSON.stringify(invalid).slice(0, 80));
});

test("the phrase editor still refuses a new phrase that the grammar reads first, and says how it reads it", () => {
  const reads = {
    "invite x": "command", "Invite": "command", "acc second": "command", "team gom afk": "command",
    "ecto": "unit", "P": "unit", "k": "unit", "a": "unit", "armbrace of truth": "unit", "zkeys": "unit", "zaishen keys": "unit", "iron": "unit",
    "1p in g": "calculation", "1 p in g": "calculation", "10e in p": "calculation", "2+2": "calculation",
    "": null, "my route": null, "inviter": null, "romi": null, "ranger": null,
  };
  for (const [phrase, reading] of Object.entries(reads)) assert.equal(hubPhraseReserved(phrase), reading, phrase);
});


test("utility pins persist through the closed shortcut validator without accepting executable ids", () => {
  const pins = ['commands', 'settings', 'accounts'].map(id => ({ id, phrase: '', pinned: true }));
  assert.equal(isHubShortcuts(pins), true);
  assert.deepEqual(parseSettings({ ...settings(''), hubShortcuts: pins }).hubShortcuts, pins);
  for (const id of ['javascript:quit()', 'command:arbitrary', 'accounts:replace']) {
    assert.equal(isHubShortcuts([{ id, phrase: '', pinned: true }]), false, id);
  }
});
