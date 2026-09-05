# Controlled-player effect timers

Effect Timers is a PvE-only, display-only Tool. It reads exact duration records
that Guild Wars already holds for the controlled player and draws remaining time
over the corresponding stock Effects icons. It does not predict effects, create
synthetic effects, handle input, or expose generic game memory.

## Certified data boundary

Player records and icon geometry are independent capabilities. The player
snapshot publishes at most 64 normalized records containing effect ID, skill ID,
attribute level, maintainer agent ID, duration, and application time. Effect ID
identifies one instance; skill ID identifies the stock icon. The observation
keeps duplicate instances intact.

The geometry snapshot locates one unique visible Effects parent using its exact
certified frame hash. It matches descendants using the certified `skillId + 4`
child ID relationship and publishes at most 64 validated rectangles. The kernel
fully audits stable frames every 30 ticks and publishes heartbeats every six
ticks. Missing or intentionally hidden stock icons simply receive no overlay.

Both snapshots use fixed-size, sequence-protected ABI records. They withdraw on
loading, PvP, stale or torn reads, malformed collections, ambiguous frames,
invalid rectangles, or unsupported clients. Neither snapshot publishes pointers.

## Presentation

The renderer joins the two complete snapshots only at the presentation edge.
For repeated records with one skill ID it shows the longest finite remaining
duration. It does not show a multiplier because reapplication normally refreshes
an effect instead of stacking it. Indefinite or unknown durations show no number.

- More than 99 seconds: upward-rounded minutes, such as `2m`.
- Three through 99 seconds: upward-rounded whole seconds.
- Under three seconds: upward-rounded tenths.
- Under five seconds: amber; under two seconds: muted red; otherwise cream.

The overlay is pointer-transparent and has no command or gameplay-input path.
The setting is off by default under **Settings → Tools → Effect Timers**.

## Evidence and acceptance

The exact-client proof owns the player effect collection, precise timer call,
Effects frame initializer, frame constructor relationship, and child ID formula.
Mutation fixtures must make each capability withdraw independently. Synthetic
kernel tests cover finite, indefinite, duplicate, renewed, removed, wrapped,
loading, PvP, malformed, clipped, ambiguous, and stale states.

The unpackaged `effect-observer` scenario is the patch-day semantic check. Its
click-through checkpoints record two consecutive player and icon snapshots in
`test-results/enhancements-live/effect-observer.json`. The developer-only run
also records the existing certified party projection through solo, hero-added,
and hero-removed checkpoints. This correlates stable party agent identities for
later research; it does not add party effects to the player capability.

Static proof and synthetic tests make the build eligible for live testing.
Release acceptance still needs a Developer Build session that visually confirms
a finite effect, refresh, natural expiry, an indefinite or maintained effect,
and travel/loading withdrawal.

Party awareness and hostile-agent effects remain separate authority decisions.
They must not reuse this player's capability or infer exact durations from broad
condition/hex state flags. See [Future effect and debuff research](future-effect-durations.md).
