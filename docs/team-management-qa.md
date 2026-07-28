# Team-management QA

This checklist verifies the player-facing **Apply team** workflow. It uses the
normal saved library and the same Tools button a player uses; no developer
command is required.

Use a test character in a **PvE outpost**. Enable **Team management** in
Settings, accept the restart, and open Tools with **Command-B**. Create a small
test team containing the player and one hero available on that account. Save
the current player and hero builds first if you want an easy manual restore.

Do not use a PvP character or PvP map for a successful Apply test. Do not put
account or character names in screenshots or bug reports.

## Release check

- [ ] **Apply once.** Give the player and hero visibly different saved builds,
  behavior, disabled-skill choices, and panel choices. Press **Apply team**.
  The button must read **Applying…** and remain disabled until the command
  finishes.
- [ ] **Verify the game, not only the notice.** The selected heroes are in the
  party, unselected owned heroes are gone, and the player/hero professions,
  attributes, skill bars, behavior, disabled skills, difficulty, and panel
  choices match the saved team. Matching heroes may remain in their current
  relative order.
- [ ] **Verify the result.** Tools reports **Team applied** with the number of
  changes. Press Apply again without editing anything; it must report
  **0 changes** and leave the game unchanged.
- [ ] **Check an unavailable skill when possible.** Apply a saved bar containing
  a skill the current account or character cannot use. Guild Wars may leave
  that slot empty. Tools must still report success plus
  **Guild Wars skipped one or more unavailable skills.** The saved build must
  not be edited.
- [ ] **Check the safety gate.** Enter an explorable area, Guild Hall, or PvP
  map/lobby and press Apply. Tools must say that team management is available
  only in a PvE outpost, and the party and builds must remain unchanged.
- [ ] **Check persistence.** Close and reopen Tools. The team and its builds
  must still be present, and a successful Apply must show an updated last-used
  time.

## Reporting a failure

Record the checklist item, map, expected result, visible Guild Wars result, and
the exact Tools notice. Include a screenshot if useful, with account and
character names hidden. If Apply stopped after changing part of the team,
describe the last change visible in Guild Wars; do not repeatedly press Apply
until the cause is understood.
