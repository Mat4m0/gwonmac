/**
 * Owns the Mission Map marker modes for the Elite Skills planner.
 * Settings validation, the launcher, and the in-game Hub share this one vocabulary.
 */
/** "saved" is the Hunt list, which always includes the target. */
export const ELITE_MISSION_MAP_MARKERS = ["saved", "all", "off"] as const;
export type EliteMissionMapMarkers = (typeof ELITE_MISSION_MAP_MARKERS)[number];

export const ELITE_MISSION_MAP_MARKER_LABELS: Readonly<Record<EliteMissionMapMarkers, string>> = Object.freeze({
  saved: "Hunt list",
  all: "All planner matches",
  off: "Off",
});

export function isEliteMissionMapMarkers(value: unknown): value is EliteMissionMapMarkers {
  return ELITE_MISSION_MAP_MARKERS.includes(value as EliteMissionMapMarkers);
}

/** Labels for the compact planner switch, where the context names the Mission Map. */
export const ELITE_MISSION_MAP_MARKER_SHORT_LABELS: Readonly<Record<EliteMissionMapMarkers, string>> = Object.freeze({
  saved: "Hunt list", all: "All", off: "Off",
});
