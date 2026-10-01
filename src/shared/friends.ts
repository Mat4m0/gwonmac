/**
 * Owns the pointer-free friend view and presence labels shared by People and Whispers.
 * It is transient renderer state and never crosses IPC or reaches disk.
 */
export type FriendPresence = "offline" | "online" | "away" | "do-not-disturb" | "unknown";
export type TravelFriend = Readonly<{
  key: string;
  status: FriendPresence;
  mapId: number;
  alias: string;
  character: string;
}>;
export type TravelFriends = Readonly<{
  status: "ready";
  sequence: number;
  generation: number;
  friends: readonly TravelFriend[];
}> | Readonly<{ status: "waiting"; reason: "unavailable" | "invalid" }>;

/** Revalidate a selected identity after an asynchronous view load. */
export function currentTravelFriend(
  feed: TravelFriends, selected: TravelFriend, generation: number,
): TravelFriend | null {
  if (feed.status !== 'ready' || feed.generation !== generation) return null;
  const current = feed.friends.find(friend => friend.key === selected.key);
  return current && current.mapId === selected.mapId && current.character === selected.character
    && current.status !== 'offline' && current.status !== 'unknown' ? current : null;
}

/** One readable label for each observed presence; protocol values remain unchanged. */
export const presenceLabel = (status: FriendPresence): string => ({
  online: "Online", away: "Away", "do-not-disturb": "Do not disturb",
  offline: "Offline", unknown: "Status unknown",
})[status];
