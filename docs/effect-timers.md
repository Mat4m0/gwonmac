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
Records with an original duration of 3,600 seconds or more also show no number.
This hides long placeholders such as Displacement without hiding ordinary
spirit timers or changing the native icon. The cutoff uses original duration,
so an old placeholder cannot become a countdown later.

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

## Alcohol Timer

Alcohol Timer is a separate, optional PvE Tool. It observes the certified native
post-processing notification without changing the message or the game's visual
effects. The proof fixes the tint/intensity payload and its level conversion.
A changed producer or dispatch destination withdraws this capability.

The kernel estimates one minute per alcohol level. Native updates correct the
countdown; increases preserve the remainder of the current minute. The timer
starts unknown until a notification arrives. Enabling it while already drunk
can therefore leave it hidden until the next update. Salad notifications are
ignored. The shared lunar/Brandy notification is ambiguous: level five is
accepted only after a Brandy level-four notification. This conservative filter
can omit an ambiguous drink. It never triggers automatic consumption.

Same-character loading hides the readout while its deadline continues. Logout,
character changes, unsupported regions, or disabling the Tool clear the estimate.
No alcohol state is saved to disk.

The renderer places a small beer icon and `m:ss` near the game viewport’s
top-left corner by default, below one standard Effects row. Its position stays
fixed when Effects icons appear, disappear, or move.
The readout turns amber in the last 15 seconds and disappears at zero. There
are no sounds or animations. Locked mode passes all pointer input to the game.

Enable **Settings → Tools → Alcohol Timer**, then select **Adjust position**.
An unlocked placeholder permits adjustment while sober. Drag the readout and
select its lock, or focus it and use arrows, Shift+arrows, and Enter. Escape,
lost pointer capture, or window blur cancels a drag. **Reset position** restores
the initial placement and lock. Like the chat icon, dragging picks the nearest
game-window corner and saves its horizontal and vertical pixel distances.
Resizing preserves those distances, clamped inside a smaller viewport without
overwriting the saved gaps. Locking does not change the readout’s size or position;
its lock control appears on the left when the right edge has no room. The
preference is shared by the launcher's game windows. Earlier developer-build
offsets convert once at their current visible position when geometry is available.

Automated evidence covers native countdown corrections, clock wrap, identity
changes, notification rejection, snapshot validation, dragging, cancellation,
locking, saved offsets, and launcher controls. A Developer Build still needs
live QA for real drink types, map travel, visual alignment, and input feel.
