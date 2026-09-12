/**
 * Resolves only reviewed boss and skill wiki pages; callers cannot supply URLs.
 * Both IPC validation and its refusal tests use this closed destination policy.
 */
import { ELITE_LOCATIONS } from "./elite-locations.js";
export type EliteWikiRequest = Readonly<{ locationId: string; page: "boss" | "skill" }>;
export function eliteWikiUrl(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid wiki request");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || (input.page !== "boss" && input.page !== "skill")) {
    throw new TypeError("Invalid wiki page");
  }
  const location = ELITE_LOCATIONS.find((entry) => entry.id === input.locationId);
  if (!location) throw new TypeError("Unknown capture location");
  return input.page === "skill" ? `https://wiki.guildwars.com/wiki/Game_link:Skill_${location.skillId}`
    : `https://wiki.guildwars.com/wiki/${encodeURIComponent(location.boss.replaceAll(" ", "_"))}`;
}
