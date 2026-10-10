/** Chat reminders: warn once a minute before, report a real run-out, stay quiet otherwise. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  observeAlcohol, observeConsumables, reminderLine, wantsReminder,
  type AlcoholObservation, type AlcoholWatch, type ConsumableWatch, type EffectObservation, type ReminderEvent,
} from "../../src/shared/reminders.js";

const CELERITY = 2522, GRAIL = 2521, CUPCAKE = 1945, LUCKY_AURA = 1927, MINUTE = 60_000, THIRTY = 30 * MINUTE;
const at = (gameTimer: number, ...effects: [number, number, number?][]): EffectObservation => ({
  status: "ready", gameTimer,
  effects: effects.map(([skillId, appliedAtGameMs, durationMs = THIRTY]) => ({ skillId, appliedAtGameMs, durationMs })),
});
function run(...observations: EffectObservation[]) {
  let watch: ConsumableWatch = new Map();
  const events: string[] = [];
  for (const observation of observations) {
    const result = observeConsumables(watch, observation);
    watch = result.watch;
    events.push(...result.events.map(event => `${event.kind}:${event.name}`));
  }
  return events;
}
const drink = (gameTimer: number, remainingMs: number): AlcoholObservation => ({ status: "ready", gameTimer, remainingMs });
function runAlcohol(...observations: AlcoholObservation[]) {
  let watch: AlcoholWatch = null;
  const lines: string[] = [];
  for (const observation of observations) {
    const result = observeAlcohol(watch, observation);
    watch = result.watch;
    lines.push(...result.events.map(reminderLine));
  }
  return lines;
}

test("each consumable warns once a minute before and once when it runs out", () => {
  assert.deepEqual(run(
    at(1_000, [CELERITY, 1_000], [GRAIL, 1_000]),
    at(1_000 + THIRTY - 2 * MINUTE, [CELERITY, 1_000], [GRAIL, 1_000]),
    at(1_000 + THIRTY - MINUTE, [CELERITY, 1_000], [GRAIL, 1_000]),
    at(1_000 + THIRTY - 30_000, [CELERITY, 1_000], [GRAIL, 1_000]),
    at(1_000 + THIRTY + 200),
    at(1_000 + THIRTY + 5_000),
  ), ["warning:Essence of Celerity", "warning:Grail of Might", "ended:Essence of Celerity", "ended:Grail of Might"]);
  assert.deepEqual(run(at(THIRTY - 10_000, [CELERITY, 0]), at(THIRTY, [CELERITY, 0]), at(THIRTY + 100, [CELERITY, 0]), at(THIRTY + 200)),
    ["warning:Essence of Celerity", "ended:Essence of Celerity"], "a run-out seen while the record is still present is reported once");
});

test("refreshing restarts reminders; early removal and loading stay quiet", () => {
  assert.deepEqual(run(
    at(THIRTY - 30_000, [CELERITY, 0]),
    at(THIRTY - 20_000, [CELERITY, THIRTY - 20_000]),
    at(2 * THIRTY - 30_000, [CELERITY, THIRTY - 20_000]),
  ), ["warning:Essence of Celerity", "warning:Essence of Celerity"], "a refreshed consumable warns again before its new end");
  assert.deepEqual(run(at(0, [CELERITY, 0]), at(10 * MINUTE)), [], "removed with time left is not a run-out");
  assert.deepEqual(run(at(THIRTY - 30_000, [GRAIL, 0]), { status: "waiting" }, at(THIRTY - 20_000, [GRAIL, 0])),
    ["warning:Grail of Might"], "a loading screen neither repeats nor invents reminders");
  assert.deepEqual(run(at(THIRTY - 30_000, [LUCKY_AURA, 0])), [], "Lucky Aura is not a tracked Lunar effect");
  assert.deepEqual(run(at(THIRTY - 30_000, [CELERITY, 0], [CELERITY, THIRTY - 40_000])), [], "a fresher instance keeps it alive");
});

test("alcohol warns about its estimate, re-arms after another drink, and ignores a cleared estimate", () => {
  assert.deepEqual(runAlcohol(drink(0, 3 * MINUTE), drink(2 * MINUTE, MINUTE), drink(2 * MINUTE + 59_000, 1_000), drink(3 * MINUTE, 0)),
    ["Alcohol wears off in about 1 minute.", "Alcohol has worn off."]);
  assert.deepEqual(runAlcohol(drink(0, 50_000), drink(10_000, 3 * MINUTE), drink(130_000, MINUTE)),
    ["Alcohol wears off in about 1 minute.", "Alcohol wears off in about 1 minute."], "another drink re-arms the warning");
  assert.deepEqual(runAlcohol(drink(0, 3 * MINUTE), drink(1_000, 0)), [], "a character change clears the estimate without a line");
});

test("options pick groups and timing; lines read plainly", () => {
  const options = { cons: true, pcons: false, alcohol: true, beforeEnd: true, atEnd: false };
  const event = (kind: ReminderEvent["kind"], group: ReminderEvent["group"]): ReminderEvent => ({ kind, group, name: "x", remainingMs: 0 });
  assert.deepEqual([event("warning", "cons"), event("warning", "pcons"), event("ended", "cons"), event("warning", "alcohol")]
    .map(value => wantsReminder(options, value)), [true, false, false, true]);
  const cupcake = observeConsumables(new Map(), at(THIRTY - 12_400, [CUPCAKE, 0])).events[0]!;
  assert.equal(cupcake.group, "pcons");
  assert.equal(reminderLine(cupcake), "Birthday Cupcake ends in 13 seconds.");
  assert.equal(reminderLine({ kind: "ended", group: "cons", name: "Grail of Might", remainingMs: 0 }), "Grail of Might has run out.");
});
