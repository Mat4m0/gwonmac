/**
 * Owns people search and explicit friend actions inside Hub.
 * Uses the shared observer and the existing private whisper session.
 */
import { currentTravelFriend, presenceLabel, type TravelFriend, type TravelFriends } from '../shared/friends.js';
import { travelDestination } from '../shared/travel.js';
import { parseHubQuery, type HubRow, type HubSource, type HubTask } from '../shared/hub.js';
import { normaliseCharacterName } from '../shared/player-text.js';
import { findPeople, whisperPersonKey, whisperUnread, type Person, type WhisperSession } from '../shared/whisper-session.js';
import { isCharacterName, isFullCharacterName } from '../shared/whispers.js';
import type { Hub } from './hub.js';
import type { PartyInvite } from './party-invite.js';

const toolEnabled = (setting: 'whispersEnabled' | 'travelPalette') =>
  !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.()[setting];
const MAX_PEOPLE = 8;
const PARTIAL_NAME = 'Type the full character name';
const WHISPER_WAITING = 'Whispers is waiting for Guild Wars chat…';

type FriendTravel = Readonly<{
  /** Why a trip to this friend cannot start now, e.g. a map load or the player already there (HUB-068). */
  unavailable(friend: TravelFriend): string | null;
  run(friend: TravelFriend, generation: number): Promise<void>;
}>;
export function createHubPeople(hub: Pick<Hub, 'attach' | 'showRows' | 'notify'>, session: WhisperSession,
  travel: FriendTravel | null, party: PartyInvite | null = null) {
  let friends: TravelFriends = { status: 'waiting', reason: 'unavailable' };
  let enabled = false;
  let detach: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const refresh = () => { for (const listener of listeners) listener(); };
  const unsubscribe = session.subscribe(refresh);
  const unsubscribeParty = party?.subscribe(refresh);
  const whisper = (name: string) => {
    if (!toolEnabled('whispersEnabled')) throw new Error('Whispers is disabled.');
    if (!session.state.available) throw new Error(WHISPER_WAITING);
    session.open(name, { visible: false });
    window.dispatchEvent(new CustomEvent('gw:whispers-toggle', { cancelable: true, detail: 'show' }));
  };
  // Another tool asks for a conversation (Trade's Whisper). Accepting cancels the event; while
  // Whispers cannot open, nothing is queued for a later ⌘D and the caller says why (HUB-129).
  const contact = (event: Event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== 'string' || !toolEnabled('whispersEnabled') || !session.state.available) return;
    event.preventDefault();
    whisper(event.detail);
  };
  window.addEventListener('gw:whisper-person', contact);
  /** Why Travel to a friend cannot start; `current` is false once the selected friend changed. */
  function travelReason(friend: TravelFriend | undefined, current: boolean): string | null {
    return !friend ? 'Waiting for a fresh friend location'
      : friend.status === 'offline' ? 'This friend is offline'
      : friend.status === 'unknown' ? 'Friend status is unavailable'
      : !travelDestination(friend.mapId) ? 'This location is not a travel destination'
      : !current ? 'This friend’s location changed. Select them again.'
      : travel?.unavailable(friend) ?? (travel ? null : 'Travel is unavailable');
  }
  /**
   * Travel and invite exists only with the Travel palette on: undefined hides it,
   * null lets it start. Invite points to it only when it can start.
   */
  function travelInviteReason(party: PartyInvite, friend: TravelFriend | undefined, current: boolean): string | null | undefined {
    if (!friend || !travel || !toolEnabled('travelPalette')) return undefined;
    return travelReason(friend, current) ?? (friend.character ? party.travelUnavailable(friend) : 'This friend is offline');
  }
  function personRows(name: string, friendKey?: string): () => readonly HubRow[] {
    const selectedFeed = friends;
    const selectedFriend = selectedFeed.status === 'ready'
      ? selectedFeed.friends.find(candidate => candidate.key === friendKey) : undefined;
    return () => {
      const feed = friends;
      const friend = feed.status === 'ready' ? feed.friends.find(candidate => candidate.key === friendKey) : undefined;
      const currentName = friend?.character || friend?.alias || name;
      const destination = friend ? travelDestination(friend.mapId) : null;
      const changed = !!friendKey && (!friend || currentName !== name);
      const current = !!selectedFriend && selectedFeed.status === 'ready' && !!currentTravelFriend(feed, selectedFriend, selectedFeed.generation);
      const reason = travelReason(friend, current);
      const rows: HubRow[] = toolEnabled('whispersEnabled') ? [{ id: 'person:whisper', title: 'Whisper', detail: `Message ${currentName}`, group: 'Actions', action: 'Write whisper',
        ...(changed ? { unavailable: 'This friend changed or is unavailable. Select them again.' } : !session.state.available ? { unavailable: WHISPER_WAITING } : {}),
        run: () => whisper(currentName) }] : [];
      if (friendKey && toolEnabled('travelPalette')) rows.push({ id: 'person:travel', title: 'Travel to outpost', detail: `${destination?.name ?? 'Location unavailable'} · Any district`, group: 'Actions', action: destination ? `Travel to ${destination.name}` : 'Travel', consequential: true, preferred: false,
        ...(reason ? { unavailable: reason } : {}), run: async task => {
          if (!selectedFriend || selectedFeed.status !== 'ready' || !travel) throw new Error('Friend travel is unavailable');
          await travel.run(selectedFriend, selectedFeed.generation);
          task.done();
        } });
      if (party && toolEnabled('whispersEnabled')) {
        // Invites address a character; an offline friend has only an account alias.
        const target = friendKey ? friend?.character ?? '' : name;
        const offline = !!friendKey && (!friend || friend.status === 'offline' || !friend.character);
        const travelInvite = travelInviteReason(party, friend, current);
        const inviteReason = changed ? 'This friend changed or is unavailable. Select them again.'
          : offline ? 'This friend is offline' : !friendKey && !isFullCharacterName(name) ? PARTIAL_NAME : party.unavailable(friend, travelInvite === null);
        rows.push({ id: 'person:invite', title: 'Invite to party', detail: `Add ${target || name} to your party`, group: 'Actions', action: `Invite ${target || name}`, consequential: true, preferred: false,
          pending: invitePending(target || name), ...(inviteReason ? { unavailable: inviteReason } : {}), run: task => inviteNow(party, target, task, friend) });
        if (travelInvite !== undefined) {
          const place = destination?.name ?? 'the outpost';
          rows.push({ id: 'person:travel-invite', title: 'Travel and invite', detail: `${place} · Any district, then invite ${target}`, group: 'Actions', action: `Travel and invite ${target}`, consequential: true, preferred: false,
            ...(travelInvite ? { unavailable: travelInvite } : {}), run: async task => {
              if (!selectedFriend || selectedFeed.status !== 'ready') throw new Error('Friend travel is unavailable');
              const { invited } = await party.travelAndInvite(selectedFriend, selectedFeed.generation);
              task.done(`Travelling to ${place}. Hub sends /invite ${target} on arrival.`);
              invited.then(() => hub.notify(`Sent /invite ${target}. Guild Wars answers in chat.`),
                error => hub.notify(error instanceof Error ? error.message : 'The invite was not sent.', 'failed'));
            } });
        }
      }
      return rows;
    };
  }
  function person(name: string, friendKey?: string) {
    hub.showRows(name, personRows(name, friendKey), undefined, undefined, source);
  }
  const source: HubSource = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible() {},
    search(query) {
      const whispersEnabled = toolEnabled('whispersEnabled');
      const parsed = parseHubQuery(query);
      // `whisper` and `invite` address one person; both need the Whispers chat mailbox.
      const addressed = parsed.scope === 'whisper' || (parsed.scope === 'invite' && !!party);
      if (parsed.scope && (!addressed || !whispersEnabled)) return [];
      if (parsed.scope === 'invite' && party && !parsed.term) {
        // `invite ` lists the online friends, those who can be invited now first, then by name.
        // No name was typed, so Hub preselects none of them; a chosen row invites by character name.
        const online = friends.status === 'ready' && session.state.suggest.friends
          ? friends.friends.filter(friend => friend.character && friend.status !== 'offline' && friend.status !== 'unknown') : [];
        return online.map(friend => inviteRow(party, row({ key: whisperPersonKey(friend.character), name: friend.character, source: 'friend', activity: 0, exact: false, friend }), friend))
          .sort((a, b) => Number(!!a.unavailable) - Number(!!b.unavailable) || a.action.localeCompare(b.action) || a.id.localeCompare(b.id)).slice(0, MAX_PEOPLE);
      }
      if (!parsed.term) {
        // A pending invite belongs to its arrival owner, even after the player closes Hub.
        const pending = party?.pending;
        return [
          ...(pending && party ? [{ id: 'pending-invite', title: `Invite ${pending.name} after arrival`, detail: `Travelling to ${pending.place}`, group: 'Continue', action: `Cancel invite to ${pending.name}`,
            run: (task: HubTask) => { party.cancel(pending); task.done(); } }] : []),
          ...(whispersEnabled ? session.state.conversations.filter(conversation => whisperUnread(conversation) || conversation.draft)
          .map(conversation => ({ ...row({ key: conversation.key, name: conversation.name, source: 'conversation', activity: conversation.activity, exact: false, conversation }), group: 'Continue', action: conversation.draft ? 'Continue draft' : `Reply to ${conversation.name}`, actionsLabel: 'View all actions', ...(!session.state.available ? { unavailable: WHISPER_WAITING } : {}), run: () => whisper(conversation.name) })) : []),
        ];
      }
      const people = findPeople(session.state, parsed.text, friends)
        .filter(person => whispersEnabled || person.source === 'friend').slice(0, MAX_PEOPLE);
      const rows = people.map(row);
      // An addressed name stays reachable beside similar known names. Unscoped search
      // offers only known people: any phrase could otherwise pose as a name.
      const typed = normaliseCharacterName(parsed.text);
      const typedRow: HubRow | null = addressed && isCharacterName(typed) && !people.some(person => person.exact)
        ? { id: `person:typed:${whisperPersonKey(typed)}`, title: typed, detail: 'Character name', group: 'People',
          action: 'View actions', menuActions: personRows(typed), actions: () => person(typed), run: () => person(typed) } : null;
      if (parsed.scope === 'invite' && party) {
        // Only an exact name invites, and it comes first. A prefix or chat match
        // opens the person page instead, so Enter never invites a similar name.
        // A single word is part of a name: it stays last and says why it cannot invite.
        const invites = rows.map((entry, index) => people[index]!.exact ? inviteRow(party, entry, people[index]!.friend) : entry);
        if (!typedRow) return invites;
        return isFullCharacterName(typed) ? [inviteRow(party, typedRow), ...invites]
          : [...invites, { ...inviteRow(party, typedRow), unavailable: PARTIAL_NAME }];
      }
      // A whisper only opens a draft, so Enter on a partial name keeps the known person first.
      if (typedRow) rows.push(typedRow);
      return parsed.scope === 'whisper'
        ? rows.map(entry => ({ ...entry, action: 'Write whisper', actionsLabel: 'View all actions', ...(!session.state.available ? { unavailable: WHISPER_WAITING } : {}), run: () => whisper(entry.keywords || entry.title) }))
        : rows;
    },
  };
  function inviteRow(party: PartyInvite, entry: HubRow, friend?: TravelFriend): HubRow {
    // Invites address a character; an offline friend has only an account alias.
    const target = friend ? friend.character : entry.title;
    const reason = friend && (friend.status === 'offline' || !friend.character) ? 'This friend is offline'
      : party.unavailable(friend, travelInviteReason(party, friend, true) === null);
    return { ...entry, action: `Invite ${target || entry.title}`, actionsLabel: 'View all actions', consequential: true, preferred: false, pending: invitePending(target || entry.title),
      ...(reason ? { unavailable: reason } : {}), run: task => inviteNow(party, target, task, friend) };
  }
  const invitePending = (target: string) => ({ label: `Inviting ${target}…`, again: `/invite ${target} is still being sent.` });
  /**
   * Guild Wars answers the invite in chat; Hub claims only that the command was sent.
   * A refusal names the command it stopped, so it still reads right after the Hub moved on.
   */
  async function inviteNow(party: PartyInvite, target: string, task: HubTask, friend?: TravelFriend) {
    try { await party.invite(target, friend); }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Try again';
      throw new Error(`/invite ${target} was not sent. ${reason}${/[.!?]$/u.test(reason) ? '' : '.'}`, { cause: error });
    }
    task.done(`Sent /invite ${target}. Guild Wars answers in chat.`);
  }
  function row(entry: Person): HubRow {
    const conversation = entry.conversation;
    const friend = entry.friend ?? (friends.status === 'ready' ? friends.friends.find(friend => whisperPersonKey(friend.character || friend.alias) === entry.key) : undefined);
    const unread = conversation ? whisperUnread(conversation) : 0;
    const continuation = unread ? `${unread} unread · Whisper` : conversation?.draft ? 'Continue draft' : '';
    if (friend) {
      const name = friend.character || friend.alias;
      return { id: `friend:${friend.key}`, title: friend.alias || name,
        detail: `${friend.character && friend.character !== friend.alias ? `${friend.character} · ` : ''}${presenceLabel(friend.status)}${friend.status !== 'offline' ? ` · ${travelDestination(friend.mapId)?.name ?? 'Location unavailable'}` : ''}${continuation ? ` · ${continuation}` : ''}`,
        aliases: [name], keywords: name, group: 'People', action: 'View actions', menuActions: personRows(name, friend.key), actions: () => person(name, friend.key), run: () => person(name, friend.key) };
    }
    const detail = conversation ? (unread ? `${unread} unread · Whisper` : conversation.draft ? 'Continue draft' : 'Conversation')
      : entry.source === 'recent' ? 'Recent conversation' : 'Seen in chat';
    return { id: `person:${entry.key}`, title: entry.name, detail, group: 'People', action: 'View actions',
      menuActions: personRows(entry.name), actions: () => person(entry.name), run: () => person(entry.name) };
  }
  return {
    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      if (next) detach = hub.attach(source);
      else { detach?.(); detach = null; friends = { status: 'waiting', reason: 'unavailable' }; }
    },
    updateFriends(next: TravelFriends) { friends = next; refresh(); },
    dispose() { window.removeEventListener('gw:whisper-person', contact); detach?.(); unsubscribe(); unsubscribeParty?.(); listeners.clear(); },
  };
}
