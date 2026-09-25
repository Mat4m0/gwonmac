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
each character’s planner preferences.
Preferences include search, profession selection, region, learned and tracked
filters, explicit skill focus, World Map marker visibility, and the expanded panel choice.
Older files that still contain the retired per-character `missionMap` switch
load normally and drop it on their next save.
An absent preferences object uses defaults without discarding an existing plan.
Tracking does not record learned skills, routes,
character names, or account unlocks. Corrupt documents are quarantined.

A skill is learned only when the current character's live observation says so.
An absent observation or an ID outside its observed range means unknown.
Account unlocks never imply that the current character learned a skill.

## Settings

**Settings → Maps → Elite skills** and the in-game Hub **Maps** view own two
app-wide settings. They apply only while **Maps** is enabled.

- **Elite skill planner** (`eliteSkillsEnabled`, on by default) adds the planner
  and its markers. Turning it off removes both without affecting other Maps
  layers.
- **Mission Map markers** (`eliteMissionMapMarkers`) chooses what the Mission
  Map shows while you play: **Off**, **Target only**, **Target and saved
  skills** (default), or **All planner matches**. Saved skills stay visible even
  when planner filters would hide them.

The planner footer shows the same Mission Map choice under **Map display**.

## Map planner

Open the native world map. **Elite skills** opens the planner in its upper-right
corner; the button also counts saved skills and names the target in its tooltip.
The Mission Map has no planner controls. Its default height is 80% of the screen,
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

**Save** keeps a skill for this character. **Set target** also saves the skill
and selects one active capture location. The footer shows that target and keeps
the World Map marker switch and the Mission Map choice under **Map display**.
Search and visibility survive restart. Opening the native world map restores the
saved panel choice; closing a native map never overwrites that choice.
No panel opens automatically during login or gameplay without a world map.

## Map markers

The World Map shows the planner's matches and the target. The Mission Map shows
the chosen Mission Map markers for the current map ID. Markers are skill icons
without the client's built-in four-pixel rim. A gold frame marks saved skills;
a heavier gold frame marks the target. Other matches are smaller. Different
skills keep their own icons. Touching copies of the same skill in the same map
area share one marker; distant positions remain separate.

Markers draw inside the native map draw event, after Cartography. Game panels,
tooltips, map fades, and map clipping cover them exactly like the map's own
icons. Their texture is anchored in world-map units, so native pan and zoom move
it at the game's frame rate. Only a changed marker set, icon, hover, or zoom
step repaints it. A target outside the map view moves to the map edge with an
arrow toward its position.

Guild Wars keeps receiving every pointer move. The host asks the game which
frame is under the pointer. A marker responds only when that frame is its map or
one of the map's children, so a panel over a marker keeps the pointer. Hover a
marker to see its preview; when positions overlap, the preview offers each
distinct skill once and lists every possible boss. Hover previews stay available
while the pointer crosses onto them. They fit within the viewport and scroll for
long descriptions.

Click a marker to pin a small card with **Set as target**, **Save**, and **Open
planner**. With the planner open, a click opens that skill's details instead.
Only a left press on a marker is taken from the game; right-drag panning and all
other presses reach the map. Clicking elsewhere or **Close** removes the card.
Closing either native map removes its preview immediately, with no exit animation.
Map markers are pointer targets only; the planner list is the keyboard path to
the same details and actions.

Both maps require matching certified frame generations, a valid world
anchor, and a current area that belongs to the campaign world map. Unsupported
areas, transitions, and stale observations withdraw the affected markers.
Known positions are spawn references, never observations of a living boss.
Empty coordinates remain a notes-only capture target.

Disabling Maps or the Elite skill planner removes the planner and its markers
and stops their frame reads. Changing the character clears learned status and
loads that character's saved plan. Failed saves retain unsaved edits visibly and
offer **Retry** or **Restore saved setup**.
Ordered saves preserve rapid typing and finish for their original character after
a character switch; old responses never replace the new character’s setup.
Wiki buttons resolve reviewed
boss or skill entries through a closed, validated main-process action.

## Verification

`tests/unit/elite-skills.test.ts` covers data provenance and persistence.
`tests/unit/elite-map-projection.test.ts` covers native projection refusal and
wiki input validation. `tests/unit/elite-map-graphics.test.ts` covers world-anchored
native textures, reuse during pan, and edge withdrawal.
`tests/client-artifact/native-map-graphics.test.ts` executes the Elite surfaces,
their draw order after Cartography, and the bounded map pointer answer against
the real client. Tools component tests cover searching, tracking, character
changes, learned status, Mission Map modes, marker activation, pointer claiming,
failure recovery, and marker placement.

Run `pnpm tools:dev`, then open `/?elites` for an offline interaction fixture.
It uses six illustrative skill records and synthetic map frames. A plain canvas
uses the same marker painter and pointer rules. Add `&fullCatalogue` to exercise
a full-length list with synthetic skill names. It does not prove native
alignment, panel coverage, game input, or capture behavior. Live game QA must
check a known boss on both maps, a game panel dragged over a marker, native
pan/zoom, an area transition, character switching, each Mission Map mode, and
Maps and Elite skill planner off/on. Keep the standard live cartography checks
as the owner of native projection certification.
