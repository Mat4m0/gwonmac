# Elite skills

Elite skills joins the installed skill catalogue to a pinned GWToolbox++
capture-location list. The imported list owns boss names, map IDs, alternate
positions, capture regions, and encounter notes. It never authorizes travel.
See [third-party notices](../THIRD-PARTY-NOTICES.md#elite-capture-locations).

## Data and tracking

Rebuild the list with `python3 scripts/import-elite-locations.py <Toolbox checkout>`.
The importer accepts only the reviewed location and enum source hashes. Review the geographic
section boundaries before accepting another revision. Location coordinates
are world-map units. Empty coordinates mean no usable boss position; they
must never become a marker at zero or an invented entrance.

Main stores `elite-tracking.json` beside each account profile's build library.
The existing privacy-safe character key separates characters. Named actions
are validated and serialized before an atomic save. Concurrent actions merge
against current disk state. Tracking records only skill IDs, one active boss,
and the mission-map preference. It does not record learned skills, routes,
character names, or account unlocks. Corrupt documents are quarantined.

A skill is learned only when the current character's live observation says so.
An absent observation or an ID outside its observed range means unknown.
Account unlocks never imply that the current character learned a skill.

## Map planner

Enable **Maps**, then open the native world map. **Elite skills** opens the
planner in its upper-right corner. Search matches skill, boss, and area names.
Profession, capture-region, learned-status, and tracked filters reduce the list.
Hover or focus a skill for a preview. Open it for full details and capture notes.
The Builds skill inspector opens the same details through **Find capture locations**.
Both interfaces read descriptions, mechanics, and icons from the installed client.

Track a skill to save it for this character. **Track this boss** also selects
one active capture location. Closing the planner leaves only tracked markers.
Overlapping markers form selectable groups. A selected boss outside the map
view has an edge indicator. Pan and zoom remain native game controls.

The mission map shows only tracked locations whose map ID matches the current
instance. It requires matching certified frame generations, a valid world
anchor, and a current area that belongs to the campaign world map. Unsupported
areas, transitions, and stale observations withdraw the affected markers.
Known positions are spawn references, never observations of a living boss.
Empty coordinates remain a notes-only capture target.

Disabling Maps removes the planner and stops its frame reads. Changing the
character clears learned status and loads that character's saved plan. Failed
saves retain the confirmed plan and offer retry. Wiki buttons resolve reviewed
boss or skill entries through a closed, validated main-process action.

## Verification

`tests/unit/elite-skills.test.ts` covers data provenance and persistence.
`tests/unit/elite-map-projection.test.ts` covers native projection refusal and
wiki input validation. Tools component tests cover searching, tracking,
character changes, learned status, failure recovery, and marker placement.

Run `pnpm tools:dev`, then open `/?elites` for an offline interaction fixture.
It uses four illustrative skill records and synthetic map frames. It does not
prove native alignment, game input, or capture behavior. Live game QA must
check a known boss on both maps, native pan/zoom, an area transition, character
switching, and Maps off/on. Keep the standard live cartography checks as the
owner of native projection certification.
