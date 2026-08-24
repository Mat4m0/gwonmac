# Skill cooldown observation and display

This feature is display-only. It reads Guild Wars' player skill recharge state,
publishes one bounded eight-slot record, and draws text over the already
certified skill-slot rectangles. It does not activate, intercept, remap, or send
gameplay input.

## Research leads

The native projects explain the likely model, but they do not certify this
client build:

- Local `GWToolboxpp/GWToolboxdll/Widgets/SkillbarWidget.cpp:141-155` formats
  recharge values, hides zero and values above 1,800,000 ms, uses a decimal
  threshold, and optionally rounds whole seconds upward. Lines 212-258 read the
  player's eight slots. Lines 261-307 center outlined text in each observed
  skill frame.
- Local `GWCA/Include/GWCA/GameEntities/Skill.h:80-105` documents an eight-slot
  row: a 0xbc-byte `Skillbar`, 0x14-byte `SkillbarSkill` records, and the
  recharge timestamp at slot offset 0x08.
- Local `GWCA/Source/Skill.cpp:9-12` computes remaining recharge as
  `recharge - MemoryMgr::GetSkillTimer()`.
- Local `GWCA/Source/SkillbarMgr.cpp:636-649` chooses the row whose `agent_id`
  equals the player agent ID.
- Local `GWCA/Source/MemoryMgr.cpp:8-29` and
  `GWCA/Include/GWCA/Managers/MemoryMgr.h:7-21` describe the precise native
  skill timer. GWonMac does not copy that native pointer scan.
- Local `GWCA/Include/GWCA/Packets/StoC.h:577-583` and `:1004-1009` document
  recharge and recharged packet shapes. GWonMac does not add a packet hook.

Toolbox effect monitoring is a separate data domain. See
[Future effect and debuff research](future-effect-durations.md).

## Exact JSPi proof

The certified ArenaNet module is identified by SHA-256
`b8cc509714b82b69fdfd79a26ba257aa4c9ef23d90bca9dfcbbd044e371cfb17`.
The feature proof is owned by
[`enhancement-skill-cooldown-proof.ts`](../src/main/certification/enhancement-skill-cooldown-proof.ts):

- Function 8704 is the unique `(i32, i32, i32) -> i32` body with SHA-256
  `de894c4032f9c9cf7a50a8f36ad1174446ead7246bf9ae830f43d8e45eb0d697`.
- Function 249 is the unique `() -> i32` body with SHA-256
  `f2b448b590efb575ca868617b0a41d544971b29ecec04a69247f3a2f7210e773`.
- Exact operands in the reviewed reader prove the 0xbc row stride, eight-slot
  bound, 0x14 slot stride, total recharge address, and direct call to the
  precise timer. Combining that with the independently certified `skills`
  offset proves recharge at slot offset 0x08.
- The transformation rechecks both body hashes and the exact timer call site
  before it can redirect the reviewed tick path. A mismatch refuses only the
  cooldown capability.

The exact build record is in
[`enhancement-builds.ts`](../src/main/certification/enhancement-builds.ts), and
the transformation checks are in
[`enhancement-transform.ts`](../src/main/certification/enhancement-transform.ts).
Mutation tests independently alter the reader bound and timer operand and prove
that cooldown certification withdraws while the other Tools capabilities stay
available.

## Runtime boundary

[`skill_cooldowns.rs`](../src/companion-kernel/skill_cooldowns.rs) owns native
collection. It resolves the certified player, selects exactly one matching bar,
caches stable player/bar identity, reads exactly eight timestamps on ordinary
ticks, rejects duplicates and invalid layouts, and refuses recharge values over
1,800,000 ms. Loading, PvP, missing, ambiguous, wrapped, or malformed state
publishes no cooldown data.

The shared record is fixed at 60 bytes and uses an odd/even publication
sequence. The renderer reads the sequence before and after the payload and
withdraws torn or stale publications. Geometry and recharge data remain
separate until the presentation coordinator in
[`skill-overlays-installation.ts`](../src/renderer/skill-overlays-installation.ts)
joins their lifecycles. Both HUDs use the single coordinate conversion in
[`skill-slot-projection.ts`](../src/renderer/skill-slot-projection.ts), and
[`skill-cooldown-overlay-consumer.ts`](../src/renderer/skill-cooldown-overlay-consumer.ts)
joins the two complete eight-slot records.

Text updates are bounded by the formatter's visible output. Above three seconds
the view changes only when the upward-rounded whole second changes. Below three
seconds it changes only when the upward-rounded tenth changes. Ready skills
have no label. The complete overlay hides when either source is unavailable,
stale, malformed, loading, or denied by the existing Tools/PvE policy.

## Presentation and remaining acceptance

The HUD and Settings preview share
[`skill-cooldown-view.ts`](../src/renderer/skill-cooldown-view.ts), including
the extracted `Guild Wars Original Display` font, outline, shadow, optical
offset, scale, formatter, and color tokens. The one canonical setting accepts
red, cream, gold, blue, or an exact six-digit custom RGB value.

[`skill-cooldown-visual.ts`](../scripts/skill-cooldown-visual.ts) creates the
required duration/color/size/key-coexistence matrix at 1x, 1.5x, and 2x. It can
place the view over a real native skill crop and writes reference, rendered,
and difference images. This remains a calibration aid, not live acceptance.

The only unresolved acceptance item is live visual and lifecycle verification.
It requires the current worktree build running with Guild Wars, followed by a
review of the final screenshot. Synthetic output must not close that item.
