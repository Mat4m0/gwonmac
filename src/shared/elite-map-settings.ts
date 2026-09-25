/**
 * Owns the Mission Map marker modes for the Elite Skills planner.
 * Settings validation, the launcher, and the in-game Hub share this one vocabulary.
 */
export const ELITE_MISSION_MAP_MARKERS = ["off", "target", "saved", "all"] as const;
export type EliteMissionMapMarkers = (typeof ELITE_MISSION_MAP_MARKERS)[number];

export const ELITE_MISSION_MAP_MARKER_LABELS: Readonly<Record<EliteMissionMapMarkers, string>> = Object.freeze({
  off: "Off",
  target: "Target only",
  saved: "Target and saved skills",
  all: "All planner matches",
});

export function isEliteMissionMapMarkers(value: unknown): value is EliteMissionMapMarkers {
  return ELITE_MISSION_MAP_MARKERS.includes(value as EliteMissionMapMarkers);
}
