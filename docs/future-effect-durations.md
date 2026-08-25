# Future research: skill effects and debuffs

This is not part of the cooldown feature. Recharge state answers when a skill
can be used again. Effects, enchantments, conditions, and hexes describe state
on agents and need separate certification, policy, data contracts, and UI.

## Evidence and open questions

Toolbox reads the player's effect collection in local
`GWToolboxpp/GWToolboxdll/Widgets/SkillbarWidget.cpp:157-209`. It matches each
effect's `skill_id` to a bar skill, derives time remaining, can keep the longest
match, and has a special multiple-effect path at lines 231-257. It explicitly
does not treat a skill typed as a hex as a friendly player effect. GWCA derives
effect time from the same precise skill timer in local
`GWCA/Source/Skill.cpp:27-33`.

Those sources are leads only. Before implementation, exact JSPi proof must
answer:

1. Which bounded collection contains effects Guild Wars legitimately exposes
   for the player and party?
2. Which fields prove effect identity, source/target agent, duration, start
   timestamp, and removal?
3. Can one skill create multiple simultaneous records, and what stable identity
   distinguishes them?
4. Which condition, hex, and other debuff facts are actually exposed to the
   local player, especially in PvP?
5. Which reviewed functions update or consume each field in the exact client?

## Recommended capability split

- Start with friendly player enchantment/effect durations only if exact client
  functions uniquely prove the bounded collection and timer relationship.
- Represent multiple records explicitly; do not collapse them to one duration
  in the observation layer. A presentation may later choose the longest only as
  a documented derived view.
- Treat party effects and hostile-agent debuffs as separate capabilities. Do
  not infer them from skill-bar recharge or animation state.
- Keep the present active-PvP restriction by default. Guild halls and PvP
  outposts are supported, but availability during a PvP match needs a separate
  fairness review. The review must prove that the UI reveals only information
  the stock client already gives that player.
- Require exact hashes, exact function signatures and operands, unique matches,
  bounded reads, sequence-protected publication, and feature-local fail-closed
  behavior, as the cooldown observer does.

The research output should first be a proof report and read-only diagnostics.
Only after live evidence confirms semantics should a new UI or durable setting
be proposed.
