# Elite skills

Elite skills joins the installed skill catalogue to a pinned GWToolbox++
capture-location list. The imported list owns boss names, map IDs, alternate
positions, capture regions, and encounter notes. It never authorizes travel.
See [third-party notices](../THIRD-PARTY-NOTICES.md#elite-capture-locations).

## Data and tracking

Rebuild the list with `python3 scripts/import-elite-locations.py <Toolbox checkout>`.
The importer accepts only the reviewed source hash. Review the geographic
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
