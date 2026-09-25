/** Hub people search: every known name source, the typed exact name, and source switches. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHubPeople } from '../../src/renderer/hub-people.ts';
import type { HubSource } from '../../src/shared/hub.ts';
import { createWhisperSession } from '../../src/shared/whisper-session.ts';

const KAISER = 'Kai Account|Mo Kaiser · online · Kamadan, Jewel of Istan';

function withPeople(settings: Record<string, boolean>, run: (people: {
  search(query: string): string[]; source: HubSource; session: ReturnType<typeof createWhisperSession>;
}) => void) {
  const originalWindow = globalThis.window;
  const browserWindow = Object.assign(new EventTarget(), { gwToolsSettings: () => settings });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow });
  let source: HubSource | null = null;
  const session = createWhisperSession(async () => {});
  session.setAvailable(true);
  const people = createHubPeople({ showRows() {}, attach(next) { source = next; return () => {}; } }, session, null);
  try {
    people.setEnabled(true);
    const friends = { status: 'ready' as const, sequence: 1, generation: 1, friends: [
      { key: 'f', character: 'Mo Kaiser', alias: 'Kai Account', status: 'online' as const, mapId: 449 },
    ] };
    session.updateFriends(friends); people.updateFriends(friends);
    session.observe([{ id: 1, sender: 'Moira Chatter', direction: 'participant' }]);
    run({ source: source!, session, search: query => source!.search(query).map(row => `${row.title}|${row.detail}`) });
  } finally {
    people.dispose();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
}
const ALL_TOOLS = { gwonmacTools: true, whispersEnabled: true, travelPalette: true };

test('Hub finds names seen in chat beside friends', () => withPeople(ALL_TOOLS, ({ search }) => {
  assert.deepEqual(search('mo'), [KAISER, 'Moira Chatter|Seen in chat']);
}));

test('Hub keeps a typed full name reachable and spelled as typed', () => withPeople(ALL_TOOLS, ({ search, source, session }) => {
  assert.deepEqual(search('Mo Kai'), [KAISER, 'Mo Kai|Character name'], 'a similar friend does not hide the typed name');
  const scoped = source.search('whisper Mo\u00a0Kai ');
  assert.deepEqual(scoped.map(row => `${row.title}|${row.action}`), ['Kai Account|Write whisper', 'Mo Kai|Write whisper'],
    'Enter on a partial name still chooses the known person');
  void scoped[1]!.run();
  assert.deepEqual(session.state.conversations.map(c => c.name), ['Mo Kai']);
  assert.deepEqual(search('Mo Kaiser'), [KAISER], 'an exact known name is not offered twice');
  assert.deepEqual(search('kamadan'), [], 'one unscoped word is a search, not a name');
}));

test('Hub respects the Messenger source switches', () => withPeople(ALL_TOOLS, ({ search, session }) => {
  session.setSuggest('chat', false);
  assert.deepEqual(search('moira'), []);
}));

test('Hub without Whispers keeps friend search only', () => withPeople({ gwonmacTools: true, whispersEnabled: false, travelPalette: true }, ({ search }) => {
  assert.deepEqual(search('mo'), [KAISER]);
  assert.deepEqual(search('Mo Kai'), [KAISER]);
}));
