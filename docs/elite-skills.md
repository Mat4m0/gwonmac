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
Preferences include search, profession selection, region, learned status, the
All matches or Hunt list view, explicit skill focus, panel height, and the
expanded panel choice.
Older files that still contain the retired per-character `missionMap` switch
load normally and drop it on their next save.
An absent preferences object uses defaults without discarding an existing plan.
Tracking does not record learned skills, routes,
character names, or account unlocks. Corrupt documents are quarantined.

A skill is learned only when the current character's live observation says so.
An absent observation or an ID outside its observed range means unknown.
Account unlocks never imply that the current character learned a skill.

## Settings

**Settings → Maps → Elite skills** owns two app-wide settings. They apply only
while **Maps** is enabled. The in-game Hub **Maps** view has the on/off switch.

- **Elite skill planner** (`eliteSkillsEnabled`, on by default) adds the planner
  and its markers. Turning it off removes both without affecting other Maps
  layers.
- **Mission Map markers** (`eliteMissionMapMarkers`) chooses what the Mission
  Map shows while you play: **Hunt list** (default), **All planner matches**, or
  **Off**. Both marker modes include the target, even when planner filters
  would hide it.

The planner footer has the same Mission Map choice.

## Hunt list and target

The **Hunt list** holds the elite skills this character wants to capture. The
star on each skill adds or removes it. A captured skill stays on the list with
a ✓ as progress, and **Remove captured from Hunt list** clears them in one step.
The list and its progress ("1/3") are kept per character.

The **target** is the boss to capture next. Players do not have to choose it.
The next uncaptured Hunt list boss with a known position is chosen
automatically: this area first, then this region, then list order. **Set target**
overrides that choice until its skill is captured; **Use automatic target**
returns to the automatic choice. Setting a target on a skill that is not on the
Hunt list adds it and says so. A learned skill cannot become the target.

A capture notice appears only when a Hunt list skill that was open in the last
observation becomes learned for the same loaded character. Loading a plan,
switching characters, or adding a learned skill never shows one. The notice
names the next target. **Remove captured from Hunt list** saves in one change.

## Map planner

Open the native world map. The compact control in its upper-right corner opens
the planner (◆) and switches the World Map between **Hunt** and **All** matches,
with progress and match counts. The Mission Map has no planner controls. The
planner's default height is 80% of the screen, limited to the available map
space. Drag the bottom grip to change its height, or focus the grip and use
Up/Down (Shift takes larger steps). Height is saved for each character.

The top of the planner switches between **All matches** and **Hunt list**.
Filters apply only to All matches; the Hunt list never loses a skill to a
filter. Each filter has one control:

- **Search** matches skill, boss, and area names.
- The ten **class** buttons toggle freely; **Mine** follows the observed primary
  and secondary professions and **All** clears the class filter. Without live
  professions, Mine shows no results and asks for a manual choice.
- **Not learned** (default), **Learned**, or **Any** uses this character's
  learned skills. Without a learned observation every skill is shown.
- **Region** narrows to one campaign region.

The result count offers **Clear filters** whenever filters differ from the
defaults. Rows show **Target**, **✓ Captured**, and **In this area** tags.

Hover or focus a skill for a preview. Click a result to expand its details in
place; only one result expands at a time. The details list every capture
location, target first, with **Set target** and boss wiki links. Inspection
never changes map filters. **Show only this skill** explicitly focuses both maps;
**Clear skill focus** exits it and brings back the saved filters, which focus
never changes. The Builds skill inspector opens the same details through **Find
capture locations**: a Hunt list skill opens in the Hunt list, and any other
skill opens as a focus. Both interfaces read descriptions,
mechanics, and skill artwork from the installed client.
The shared detail component follows the game's own skill description: the
skill type ("Elite Axe Attack"), costs in the game's order (adrenaline in
strikes, energy, overcast, sacrifice, activation, recharge), quarter seconds as
fractions, and attribute-scaled values highlighted. With an observed attribute
rank, the value for that rank replaces the `10...45` range, which stays in the
tooltip. Aftercast appears only when it differs from the usual ¾ second. Cost
and timing icons are locally bundled Tango-style artwork with accessible labels.
See [icon attribution](../THIRD-PARTY-NOTICES.md#guild-wars-wiki-stat-icons).

Search and visibility survive restart. Opening the native world map restores the
saved panel choice; closing a native map never overwrites that choice.
No panel opens automatically during login or gameplay without a world map.

## Map markers

The World Map shows the Hunt list or all matches, always with the target. The
Mission Map shows the chosen Mission Map markers for the current map ID. Markers
are skill icons without the client's built-in four-pixel rim. A gold frame marks
Hunt list skills; a heavier gold frame marks the target. Other matches are
smaller. Captured skills dim and carry a ✓. Markers grow with the game's own
map zoom, up to 1.8 times their size fully zoomed in. On the Mission Map, a
boss with several possible spawn positions shows "1/4", "2/4", … on each
position. The World Map shows those labels for the hovered boss and the target.
Dotted links join the possible positions of the hovered boss and the target
along the shortest paths. Different
skills keep their own icons. Touching copies of the same skill in the same map
area share one marker; distant positions remain separate.

Markers draw inside the native map draw event, after Cartography. Game panels,
tooltips, map fades, and map clipping cover them exactly like the map's own
icons. Each distinct marker look is painted once into an atlas at the game's
framebuffer resolution. Each marker and each link dot is one native world
rectangle that samples the atlas, so markers stay sharp at every zoom. A pan
changes nothing. A zoom step moves the rectangles and sends the unchanged atlas
again from a cached copy. Only a changed look paints the atlas again. A target outside the map view moves to the map edge with an
arrow toward its position.

Guild Wars keeps receiving every pointer move. The host asks the game which
frame is under the pointer. A marker responds only when that frame is its map or
one of the map's children, so a panel over a marker keeps the pointer. Hover a
marker to see its preview; when positions overlap, the preview offers each
distinct skill once. Hover previews stay available
while the pointer crosses onto them. They fit within the viewport and scroll for
long descriptions.

The preview shows the boss, the area ("in this area"), how many positions the
boss can spawn at, encounter notes, and the Hunt list status. Click a marker to
pin a small card with **Set target**, **☆ Hunt**, and **Planner**. Press Esc or
click elsewhere to close the card, even while the game keeps keyboard focus.
With the planner open, a click opens that skill's details instead. Only a left
press on a marker is taken from the game; right-drag panning and all other
presses reach the map.
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
