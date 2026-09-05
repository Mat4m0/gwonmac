# Controlled-player effect observation

This is the evidence ledger for the read-only player-effect capability. Reference
repositories are hypotheses. Runtime authority comes only from the exact client
proof and is withdrawn when any required relationship changes.

## Current boundary

- Official client SHA-256: `1eb07332632e2fca8aabf5baa14fa1a1e6a2a59ec7134dfb8f6231d924c9fd7b`
- Post-template SHA-256: `484f7f20691c912c372b7e265a1cc4a4d26b37bfbd52c838b3137d5f29b67d3b`
- Build ID: `514880306`
- Transform profile: `features-1fff`
- Derived output SHA-256: `2a04001b9757da959051cd3d739c58c30220829c191ec3b57c794c8663dd4484`
- Policy: controlled player, PvE, read-only, no packet interception, no generic
  memory reader, and no duration prediction.

`pnpm certification verify` independently proved the player-effect lane on this
installed client together with the existing cooldown and party capabilities.
Previous live sessions proved finite, refreshed, long, maintained, loading, and
party-lifecycle behavior on earlier exact client generations. Those observations
guided this implementation but do not certify the current hash.

## Proved layout

```text
GameContext + 0x2c -> WorldContext
WorldContext + 0x508 -> Array<AgentEffects>
AgentEffects stride 0x24
  +0x00 agentId
  +0x14 Array<Effect>
Effect stride 0x18
  +0x00 skillId
  +0x04 attributeLevel
  +0x08 effectId
  +0x0c maintainerAgentId
  +0x10 durationSeconds (finite f32)
  +0x14 appliedAtGameMs
```

The exact add, renew, remove, and precise-timer functions resolve uniquely.
Dirty messages `0x10000055`, `0x10000056`, `0x10000057`, and `0x10000141`
only request reconciliation. The collection is still the source of truth. The
kernel performs a bounded reconciliation at least every 30 ticks and publishes
timer heartbeats every six ticks (about 10 Hz).

## Runtime contract

- Maximum 64 effect records. Overflow withdraws the whole snapshot.
- `effectId` identifies a record; `skillId` identifies the stock icon.
- Duration `0` is indefinite or unknown and must not display a countdown.
- Remaining time uses unsigned game-timer subtraction, including wrap.
- Loading, PvP, malformed arrays, invalid fields, torn publications, and stale
  state publish no usable effects.
- Repeated skill IDs are preserved as evidence. They are not claimed to stack,
  and the user interface must not show an `xN` multiplier.

## Feedback loop

```text
reference hypothesis
-> exact offline locator
-> mutation/refusal tests
-> compiled Rust/WASM memory fixture
-> operator-assisted live checkpoints
-> compare transition
-> refine or withdraw
```

The unpackaged `effect-observer` scenario shows a small in-game click-through
panel and retains bounded JSON in ignored `test-results/enhancements-live/`.
It captures baseline, finite effect, refresh, expiry, maintained/indefinite, and
two heartbeat samples for each step. It exposes only the typed effect projection
and cannot send input or game commands.

## Scope decisions

- Skill cooldowns remain the existing independent slot-recharge capability.
- Existing bounded party identity is enough for later lightweight party
  awareness; party-member effect collections need their own proof.
- Native Effects-icon geometry and the player-facing overlay are the next layer,
  not hidden in this observation commit.
- Enemy timers and cast events remain unproved. Agent flags such as “hexed” or
  “conditioned” are not exact skill-and-duration authority.
