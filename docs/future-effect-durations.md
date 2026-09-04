# Future research: party and hostile effects

Exact controlled-player effect timers are now a separate certified Tool; see
[Controlled-player effect timers](effect-timers.md). This document owns only the
remaining party-awareness and hostile-agent questions. Recharge state answers
when a skill can be used again and remains a different capability.

## Evidence and open questions

Toolbox's player-effect reader in local
`GWToolboxpp/GWToolboxdll/Widgets/SkillbarWidget.cpp:157-257` helped establish
the controlled-player hypothesis, but it does not prove party or hostile-agent
semantics. Its choice not to treat a skill typed as a hex as a friendly player
effect is one reason these wider surfaces must remain separate.

Those sources are leads only. Before implementation, exact JSPi proof must
answer:

1. Do other rows in the certified collection map completely and uniquely to
   current party members, including heroes and henchmen?
2. Which party fields prove effect identity, source/target agent, duration,
   start timestamp, removal, death, travel, and roster changes?
3. Which condition, hex, and other debuff facts are actually exposed to the
   local player, especially in PvP?
4. Does hostile state expose exact stock-visible skill and duration data, or
   only broad flags such as “hexed” and “conditioned”?
5. Which reviewed functions update or consume each candidate field in the exact
   client?

## Remaining capability split

- Keep controlled-player records and presentation decisions inside their existing
  certified boundary; do not broaden it to party or hostile agents.
- Treat party effects and hostile-agent debuffs as separate capabilities. Do
  not infer them from skill-bar recharge or animation state.
- Keep the present PvP-map restriction and Guild Hall exception by default.
  Any future availability on another PvP map needs a separate fairness review.
  The review must prove that the UI reveals only information the stock client
  already gives that player.
- Require exact hashes, exact function signatures and operands, unique matches,
  bounded reads, sequence-protected publication, and feature-local fail-closed
  behavior, as the cooldown observer does.

The research output should first be a proof report and read-only diagnostics.
Only after live evidence confirms semantics should a new UI or durable setting
be proposed.
