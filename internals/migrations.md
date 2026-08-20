# Active migrations

## Map-only Travel shortcuts

- Introduced: the Travel preferences stack in August 2026.
- Why: released previews stored region, language, and district choices with each
  shortcut. Those copied values can become stale and can send a player to a
  different district than their current one.
- Dependency: profiles written by a release that predates map-only Travel may
  still contain the three legacy fields.
- Removal condition: remove the legacy parser after the oldest supported Stable
  version has included this one-time settings rewrite for a full support cycle.
  The canonical settings file then contains exactly nine map-only slots.
- Tracking: the Travel preferences stacked pull requests.
