/**
 * Defines the pointer-free, session-local friend view used by Quick Travel.
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
