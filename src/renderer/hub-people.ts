/**
 * Owns people search and explicit friend actions inside Hub.
 * Uses the shared observer and the existing private whisper session.
 */
import { currentTravelFriend, type TravelFriend, type TravelFriends } from '../shared/friends.js';
import { travelDestination } from '../shared/travel.js';
import { parseHubQuery, type HubRow, type HubSource } from '../shared/hub.js';
import { normaliseCharacterName } from '../shared/player-text.js';
import { findPeople, whisperPersonKey, whisperUnread, type Person, type WhisperSession } from '../shared/whisper-session.js';
import { isCharacterName } from '../shared/whispers.js';
import type { Hub } from './hub.js';
import type { PartyInvite } from './party-invite.js';

const toolEnabled = (setting: 'whispersEnabled' | 'travelPalette') =>
  !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.()[setting];
const MAX_PEOPLE = 8;

type FriendTravel = Readonly<{
  unavailable(): string | null;
  run(friend: TravelFriend, generation: number): Promise<void>;
}>;
export function createHubPeople(hub: Pick<Hub, 'attach' | 'showRows' | 'close' | 'notify'>, session: WhisperSession,
  travel: FriendTravel | null, party: PartyInvite | null = null) {
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
  const contact = (event: Event) => { if (event instanceof CustomEvent && typeof event.detail === 'string' && toolEnabled('whispersEnabled')) whisper(event.detail); };
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
      const rows: HubRow[] = toolEnabled('whispersEnabled') ? [{ id: 'person:whisper', title: 'Whisper', detail: `Message ${currentName}`, group: 'Actions', action: 'Write whisper',
        ...(changed ? { unavailable: 'This friend changed or is unavailable. Select them again.' } : !session.state.available ? { unavailable: 'Whispers is unavailable. Enable it in Settings or wait for Guild Wars.' } : {}),
        run: () => whisper(currentName) }] : [];
      if (friendKey && toolEnabled('travelPalette')) rows.push({ id: 'person:travel', title: 'Travel to outpost', detail: `${destination?.name ?? 'Location unavailable'} · Any district`, group: 'Actions', action: 'Travel',
        ...(reason ? { unavailable: reason } : {}), run: async () => {
          if (!selectedFriend || selectedFeed.status !== 'ready' || !travel) throw new Error('Friend travel is unavailable');
          await travel.run(selectedFriend, selectedFeed.generation);
        } });
      if (party && toolEnabled('whispersEnabled')) {
        // Invites address a character; an offline friend has only an account alias.
        const target = friendKey ? friend?.character ?? '' : name;
        const offline = !!friendKey && (!friend || friend.status === 'offline' || !friend.character);
        const inviteReason = changed ? 'This friend changed or is unavailable. Select them again.'
          : offline ? 'This friend is offline' : party.unavailable();
        rows.push({ id: 'person:invite', title: 'Invite to party', detail: `Add ${target || name} to your party`, group: 'Actions', action: 'Invite',
          ...(inviteReason ? { unavailable: inviteReason } : {}), run: async () => {
            await party.invite(target);
            hub.close(`Invited ${target}. Guild Wars shows the answer in chat.`);
          } });
        if (friendKey && friend && travel && toolEnabled('travelPalette')) {
          const place = destination?.name ?? 'the outpost';
          const travelInviteReason = reason ?? (offline ? 'This friend is offline' : party.travelUnavailable(friend));
          rows.push({ id: 'person:travel-invite', title: 'Travel and invite', detail: `${place} · Any district, then invite ${target}`, group: 'Actions', action: 'Travel and invite',
            ...(travelInviteReason ? { unavailable: travelInviteReason } : {}), run: async () => {
              if (!selectedFriend || selectedFeed.status !== 'ready') throw new Error('Friend travel is unavailable');
              const { invited } = await party.travelAndInvite(selectedFriend, selectedFeed.generation);
              hub.close(`Travelling to ${place}. ${target} is invited on arrival.`);
              invited.then(() => hub.notify(`Invited ${target}. If you landed in another district, Guild Wars cannot find them.`),
                error => hub.notify(error instanceof Error ? error.message : 'The invite was not sent.'));
            } });
        }
      }
      return rows;
    });
  }
  const source: HubSource = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible() {},
    search(query) {
      const whispersEnabled = toolEnabled('whispersEnabled');
      const parsed = parseHubQuery(query);
      if (parsed.scope === 'whisper' && !whispersEnabled) return [];
      if (parsed.scope && parsed.scope !== 'whisper') return [];
      if (!parsed.term) {
        // Home lists only conversations that still need the player.
        return whispersEnabled ? session.state.conversations.filter(conversation => whisperUnread(conversation) || conversation.draft)
          .map(conversation => row({ key: conversation.key, name: conversation.name, source: 'conversation', activity: conversation.activity, exact: false, conversation })) : [];
      }
      const people = findPeople(session.state, parsed.text, friends)
        .filter(person => whispersEnabled || person.source === 'friend').slice(0, MAX_PEOPLE);
      const rows = people.map(row);
      // An addressed name stays reachable beside similar known names. It comes last,
      // so Enter on a partial name still chooses the known person. Unscoped search
      // offers only known people: any phrase could otherwise pose as a name.
      const typed = normaliseCharacterName(parsed.text);
      if (parsed.scope === 'whisper' && session.state.available && isCharacterName(typed) && !people.some(person => person.exact)) {
        rows.push({ id: `person:typed:${whisperPersonKey(typed)}`, title: typed, detail: 'Character name', group: 'People',
          action: 'View actions', actions: () => person(typed), run: () => person(typed) });
      }
      return parsed.scope === 'whisper'
        ? rows.map(entry => ({ ...entry, action: 'Write whisper', run: () => whisper(entry.keywords || entry.title) }))
        : rows;
    },
  };
  function row(entry: Person): HubRow {
    const { friend, conversation } = entry;
    if (friend) {
      const name = friend.character || friend.alias;
      return { id: `friend:${friend.key}`, title: friend.alias || name,
        detail: `${friend.character && friend.character !== friend.alias ? `${friend.character} · ` : ''}${friend.status}${friend.status !== 'offline' ? ` · ${travelDestination(friend.mapId)?.name ?? 'Location unavailable'}` : ''}`,
        keywords: name, group: 'People', action: 'View actions', actions: () => person(name, friend.key), run: () => person(name, friend.key) };
    }
    const unread = conversation ? whisperUnread(conversation) : 0;
    const detail = conversation ? (unread ? `${unread} unread · Whisper` : conversation.draft ? 'Continue draft' : 'Conversation')
      : entry.source === 'recent' ? 'Recent conversation' : 'Seen in chat';
    return { id: `person:${entry.key}`, title: entry.name, detail, group: 'People', action: 'View actions',
      actions: () => person(entry.name), run: () => person(entry.name) };
  }
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
