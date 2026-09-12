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
against current disk state. Tracking records skill IDs, one active boss, and
each character’s map preferences.
Preferences include search, profession selection, region, learned and tracked
filters, explicit skill focus, marker visibility, and the expanded panel choice.
An absent preferences object uses defaults without discarding an existing plan.
Tracking does not record learned skills, routes,
character names, or account unlocks. Corrupt documents are quarantined.

A skill is learned only when the current character's live observation says so.
An absent observation or an ID outside its observed range means unknown.
Account unlocks never imply that the current character learned a skill.

## Map planner

Enable **Maps**, then open the native world map. **Elite skills** opens the
planner in its upper-right corner. Its default height is 80% of the screen,
limited to the available map space. The list reserves space for skill rows even
when the filter controls need their own scrollbar. Drag the bottom grip to change its height,
or focus the grip and use Up/Down (Shift takes larger steps). Height is saved
for each character and fits smaller windows automatically. Filters retain their
own space above the scrolling skill list, including with a full catalogue. Search matches skill, boss, and area names.
**All matching skills** and **Saved skills** choose the skill scope. The ten
profession icons toggle each class independently. **Select all** and **Deselect all**
include or exclude every profession. An empty selection remains empty after restart.
**Current class** follows the observed primary and secondary professions. Manual
selections stay fixed. If live professions are unavailable, Current class shows
no results and offers manual selection. **Hide already learned** uses this
character's learned skills and also applies to saved skills. Capture region and
**Reset filters** are under **More filters**.

Hover or focus a skill for a preview. Click a result to expand its details in
place; only one result expands at a time. The search, filters, and neighboring
results remain available. Click the same row to close its details. The star on
every row saves or removes that skill without opening details or choosing a boss.
The first capture location is visible; other locations and encounter notes expand
on demand. Inspection never changes map filters. **Show only this skill** explicitly
focuses both maps; **Clear skill focus** exits it.
The Builds skill inspector opens the same details through **Find capture locations**.
Both interfaces read descriptions, mechanics, and skill artwork from the installed client.
The shared detail component shows locally bundled Tango-style cost and timing icons
with accessible labels. See [icon attribution](../THIRD-PARTY-NOTICES.md#guild-wars-wiki-stat-icons).
Markers crop the built-in four-pixel rim from the client’s 64-pixel skill textures
for display only. Decoded assets remain unchanged. One thin CSS edge surrounds
the inner artwork, with a steady pointer target. Hover or
keyboard focus brings the individual marker above its neighbors. When positions
overlap, the preview offers each distinct skill once. Touching copies of the same
skill in the same map area share one marker; distant positions remain separate.
The hover card lists all possible bosses for the selected skill. The active boss
keeps its source position. Hover or focus an icon to inspect it; click to open
its capture details without changing filters.
These choices use only the visible, filtered markers and do not move boss positions.
Hover previews stay available while the pointer crosses onto them. They fit within
the viewport and scroll for long descriptions. Keyboard previews open immediately;
pointer previews use a short entrance when reduced motion is not requested.
Closing either native map removes its preview immediately, with no exit animation.

**Save** keeps a skill for this character. **Set target** also saves the skill
and selects one active capture location. The footer shows that target and keeps
world and mission visibility switches under **Map display**. Collapsing the planner preserves all filtered markers.
A compact row keeps only a visibility checkbox and the **Elite skills** button.
Hover the button to see the active filters and mission target status. Open it to
change or clear filters; collapsing does not change which markers appear.
Search and visibility survive restart. Opening the native world map restores the
saved panel choice; closing a native map never overwrites that choice.
No panel opens automatically during login or gameplay without a world map.
Different skills keep their own icons; repeated artwork at a shared spot is deduplicated. A
selected boss outside the map view has an edge indicator. Pan and zoom remain
native game controls.

The mission map uses the same filtered locations, limited to the current map ID.
Its visibility toggle is separate from world-map visibility. Both maps require
matching certified frame generations, a valid world
anchor, and a current area that belongs to the campaign world map. Unsupported
areas, transitions, and stale observations withdraw the affected markers.
Known positions are spawn references, never observations of a living boss.
Empty coordinates remain a notes-only capture target.

Disabling Maps removes the planner and stops its frame reads. Changing the
character clears learned status and loads that character's saved plan. Failed
saves retain unsaved edits visibly and offer **Retry** or **Restore saved setup**.
Ordered saves preserve rapid typing and finish for their original character after
a character switch; old responses never replace the new character’s setup.
Wiki buttons resolve reviewed
boss or skill entries through a closed, validated main-process action.

## Verification

`tests/unit/elite-skills.test.ts` covers data provenance and persistence.
`tests/unit/elite-map-projection.test.ts` covers native projection refusal and
wiki input validation. Tools component tests cover searching, tracking,
character changes, learned status, failure recovery, and marker placement.

Run `pnpm tools:dev`, then open `/?elites` for an offline interaction fixture.
It uses six illustrative skill records and synthetic map frames. Add
`&fullCatalogue` to exercise a full-length list with synthetic skill names. It does not
prove native alignment, game input, or capture behavior. Live game QA must
check a known boss on both maps, native pan/zoom, an area transition, character
switching, and Maps off/on. Keep the standard live cartography checks as the
owner of native projection certification.
