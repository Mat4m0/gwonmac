/**
 * Owns people search and explicit friend actions inside Hub.
 * Uses the shared observer and the existing private whisper session.
 */
import { currentTravelFriend, type TravelFriend, type TravelFriends } from '../shared/friends.js';
import { travelDestination } from '../shared/travel.js';
import { matchHubRows, parseHubQuery, type HubRow, type HubSource } from '../shared/hub.js';
import { whisperPersonKey, whisperUnread, type WhisperSession } from '../shared/whisper-session.js';
import { whisperLine } from '../shared/whispers.js';
import type { Hub } from './hub.js';

type FriendTravel = Readonly<{
  unavailable(): string | null;
  run(friend: TravelFriend, generation: number): Promise<void>;
}>;
export function createHubPeople(hub: Hub, session: WhisperSession, travel: FriendTravel | null) {
  let friends: TravelFriends = { status: 'waiting', reason: 'unavailable' };
  let enabled = false;
  let detach: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const refresh = () => { for (const listener of listeners) listener(); };
  const unsubscribe = session.subscribe(refresh);
  const whisper = (name: string) => {
    session.open(name, { visible: false });
    window.dispatchEvent(new CustomEvent('gw:whispers-toggle', { cancelable: true, detail: 'show' }));
  };
  const contact = (event: Event) => { if (event instanceof CustomEvent && typeof event.detail === 'string' && window.gwToolsSettings?.().gwonmacTools && window.gwToolsSettings?.().whispersEnabled) whisper(event.detail); };
  window.addEventListener('gw:whisper-person', contact);
  function person(name: string, friendKey?: string) {
    const selectedFeed = friends;
    const selectedFriend = selectedFeed.status === 'ready'
      ? selectedFeed.friends.find(candidate => candidate.key === friendKey) : undefined;
    hub.showRows(name, () => {
      const feed = friends;
      const friend = feed.status === 'ready' ? feed.friends.find(candidate => candidate.key === friendKey) : undefined;
      const currentName = friend?.character || friend?.alias || name;
      const destination = friend ? travelDestination(friend.mapId) : null;
      const changed = !!friendKey && (!friend || currentName !== name);
      const reason = !friend ? 'Waiting for a fresh friend location'
        : friend.status === 'offline' ? 'This friend is offline'
        : friend.status === 'unknown' ? 'Friend status is unavailable'
        : !destination ? 'This location is not a travel destination'
        : !selectedFriend || selectedFeed.status !== 'ready' || !currentTravelFriend(feed, selectedFriend, selectedFeed.generation)
        ? 'This friend’s location changed. Select them again.'
        : travel?.unavailable() ?? (travel ? null : 'Travel is unavailable');
      const whispersEnabled = !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().whispersEnabled;
      const travelEnabled = !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().travelPalette;
      const rows: HubRow[] = whispersEnabled ? [{ id: 'person:whisper', title: 'Whisper', detail: `Message ${currentName}`, group: 'Actions', action: 'Write whisper',
        ...(changed ? { unavailable: 'This friend changed or is unavailable. Select them again.' } : !session.state.available ? { unavailable: 'Whispers is unavailable. Enable it in Settings or wait for Guild Wars.' } : {}),
        run: () => whisper(currentName) }] : [];
      if (friendKey && travelEnabled) rows.push({ id: 'person:travel', title: 'Travel to outpost', detail: `${destination?.name ?? 'Location unavailable'} · Any district`, group: 'Actions', action: 'Travel',
        ...(reason ? { unavailable: reason } : {}), run: async () => {
          if (!selectedFriend || selectedFeed.status !== 'ready' || !travel) throw new Error('Friend travel is unavailable');
          await travel.run(selectedFriend, selectedFeed.generation);
        } });
      return rows;
    });
  }
  const source: HubSource = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible() {},
    search(query) {
      const whispersEnabled = !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().whispersEnabled;
      const parsed = parseHubQuery(query);
      if (parsed.scope === 'whisper' && !whispersEnabled) return [];
      if (parsed.scope && parsed.scope !== 'whisper') return [];
      query = parsed.term;
      const rows: HubRow[] = [];
      const names = new Set<string>();
      if (friends.status === 'ready') for (const friend of friends.friends) {
        const name = friend.character || friend.alias;
        if (!name) continue;
        names.add(whisperPersonKey(name));
        if (!query.trim()) continue;
        rows.push({ id: `friend:${friend.key}`, title: friend.alias || name,
          detail: `${friend.character && friend.character !== friend.alias ? `${friend.character} · ` : ''}${friend.status}${friend.status !== 'offline' ? ` · ${travelDestination(friend.mapId)?.name ?? 'Location unavailable'}` : ''}`,
          keywords: name, group: 'People', action: 'View actions', actions: () => person(name, friend.key), run: () => person(name, friend.key) });
      }
      for (const conversation of whispersEnabled ? session.state.conversations : []) {
        const unread = whisperUnread(conversation);
        if (!query.trim() && !unread && !conversation.draft) continue;
        if (query.trim() && names.has(conversation.key)) continue;
        rows.push({ id: `person:${conversation.key}`, title: conversation.name, detail: unread ? `${unread} unread · Whisper` : conversation.draft ? 'Continue draft' : 'Conversation', group: 'People', action: 'View actions', actions: () => person(conversation.name), run: () => person(conversation.name) });
      }
      if (query.trim() && whispersEnabled) for (const recent of session.state.recent) {
        if (names.has(recent.key)) continue;
        rows.push({ id: `person:${recent.key}`, title: recent.name, detail: 'Recent conversation', group: 'People', action: 'View actions', actions: () => person(recent.name), run: () => person(recent.name) });
      }
      const matches = matchHubRows(rows, query).slice(0, 8);
      const recipient = parsed.scope === 'whisper' ? parsed.term : null;
      if (!matches.length && recipient && session.state.available) {
        const name = recipient;
        try {
          whisperLine(name, 'x');
          matches.push({ id: 'person:new', title: `Whisper to ${name}`, detail: 'Character name · Write a message', group: 'People', action: 'Write whisper', run: () => whisper(name) });
        } catch { /* A partial or invalid character name is not an action. */ }
      }
      return parsed.scope === 'whisper' ? matches.map(row => row.id === 'person:new' ? row : ({ ...row, action: 'Write whisper', run: () => whisper(row.keywords || row.title) })) : matches;
    },
  };
  return {
    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      if (next) detach = hub.attach(source);
      else { detach?.(); detach = null; friends = { status: 'waiting', reason: 'unavailable' }; }
    },
    updateFriends(next: TravelFriends) { friends = next; refresh(); },
    dispose() { window.removeEventListener('gw:whisper-person', contact); detach?.(); unsubscribe(); listeners.clear(); },
  };
}
