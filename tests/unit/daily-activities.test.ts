/**
 * Pins the daily rotations to rows copied from the Guild Wars Wiki "Daily
 * activities" table (https://wiki.guildwars.com/wiki/Daily_activities) and to
 * dated entries on each rotation's cycles page. The wrong behaviour this
 * catches is an off-by-one anchor or reset hour that shifts every activity by a
 * day.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyDayAt, dailyDaysFrom } from "../../src/shared/daily-activities.js";

const titles = (at: string): string[] =>
  dailyDayAt(new Date(at)).activities.map((activity) => activity.title);

// Column order: Mission, Bounty, Combat, Vanquish, Shining Blade, Vanguard, Sandford.
// Instants are 18:00 UTC, two hours after the 16:00 reset of the table's date.
const wikiRows: readonly [string, readonly string[]][] = [
  ["2026-10-30T18:00:00Z", ["Gate of Pain", "Frostmaw the Kinslayer", "Codex Arena", "Maishang Hills", "Insatiable Vakar", "Farmer Hamnet", "Worn Belts"]],
  ["2026-11-03T18:00:00Z", ["Gyala Hatchery", "TPS Regulator Golem", "Heroes' Ascent", "Minister Cho's Estate", "Cerris", "Bandits", "Red Iris Flowers"]],
  ["2026-11-04T18:00:00Z", ["Abaddon's Gate", "Plague of Destruction", "Guild Versus Guild", "Mehtani Keys", "Sarnia the Red-Handed", "Utini Wupwup", "Enchanted Lodestones"]],
  ["2026-12-02T18:00:00Z", ["D'Alessio Seaboard", "Justiciar Thommis", "Guild Versus Guild", "The Shattered Ravines", "Calamitous", "Ascalonian Noble", "Worn Belts"]],
  ["2026-12-25T18:00:00Z", ["G.O.L.E.M.", "Fronis Irontoe", "Codex Arena", "Wajjun Bazaar", "Lev the Condemned", "Countess Nadya", "Red Iris Flowers"]],
  ["2027-01-10T18:00:00Z", ["Jennur's Horde", "The Darknesses", "Fort Aspenwood", "Traveler's Vale", "Maximilian the Meticulous", "Farmer Hamnet", "Unnatural Seeds"]],
];

test("each wiki row gives every category in its order with its label", () => {
  for (const [at, expected] of wikiRows) assert.deepEqual(titles(at), expected, at);
  assert.deepEqual(
    dailyDayAt(new Date("2026-11-03T18:00:00Z")).activities.map(({ category, label }) => [category, label]),
    [
      ["zaishenMission", "Zaishen Mission"],
      ["zaishenBounty", "Zaishen Bounty"],
      ["zaishenCombat", "Zaishen Combat"],
      ["zaishenVanquish", "Zaishen Vanquish"],
      ["shiningBlade", "Shining Blade"],
      ["vanguardQuest", "Vanguard Quest"],
      ["nicholasSandford", "Nicholas Sandford"],
    ],
  );
});

test("quests change at 16:00 UTC, one minute apart lands on different days", () => {
  const before = dailyDayAt(new Date("2026-11-03T15:59:00Z"));
  const after = dailyDayAt(new Date("2026-11-03T16:00:00Z"));
  assert.equal(before.startsAt.toISOString(), "2026-11-02T16:00:00.000Z");
  assert.equal(before.endsAt.toISOString(), "2026-11-03T16:00:00.000Z");
  assert.equal(after.startsAt.toISOString(), "2026-11-03T16:00:00.000Z");
  assert.equal(after.endsAt.toISOString(), "2026-11-04T16:00:00.000Z");
  // Wiki rows "2 November 2026" and "3 November 2026", without the Sandford column.
  assert.deepEqual(before.activities.slice(0, 6).map((a) => a.title), ["Jennur's Horde", "The Greater Darkness", "Alliance Battles", "Icedome", "Valis the Rampant", "Footman Tate"]);
  assert.deepEqual(after.activities.slice(0, 6).map((a) => a.title), ["Gyala Hatchery", "TPS Regulator Golem", "Heroes' Ascent", "Minister Cho's Estate", "Cerris", "Bandits"]);
});

test("Nicholas Sandford changes at 07:00 UTC while the quests keep their day", () => {
  const before = dailyDayAt(new Date("2026-11-03T06:59:00Z"));
  const after = dailyDayAt(new Date("2026-11-03T07:00:00Z"));
  assert.equal(before.startsAt.getTime(), after.startsAt.getTime());
  assert.equal(before.activities[6]?.title, "Skale Fins");
  assert.equal(after.activities[6]?.title, "Red Iris Flowers");
});

test("dailyDaysFrom walks consecutive days from the day containing the instant", () => {
  const days = dailyDaysFrom(new Date("2026-11-03T20:00:00Z"), 3);
  assert.deepEqual(days.map((day) => day.startsAt.toISOString()), ["2026-11-03T16:00:00.000Z", "2026-11-04T16:00:00.000Z", "2026-11-05T16:00:00.000Z"]);
  assert.deepEqual(days.map((day) => day.endsAt.toISOString()), ["2026-11-04T16:00:00.000Z", "2026-11-05T16:00:00.000Z", "2026-11-06T16:00:00.000Z"]);
  assert.deepEqual(days[0]?.activities, dailyDayAt(new Date("2026-11-03T20:00:00Z")).activities);
  // Wiki rows 4 and 5 November 2026.
  assert.deepEqual(days[1]?.activities.map((a) => a.title), wikiRows[2]?.[1]);
  assert.deepEqual(days[2]?.activities.map((a) => a.title), ["The Frost Gate", "The Darknesses", "Codex Arena", "Sacnoth Valley", "Destor the Truth Seeker", "Ascalonian Noble", "Skeletal Limbs"]);
  assert.deepEqual(dailyDaysFrom(new Date("2026-11-03T20:00:00Z"), 0), []);
});

test("rotations wrap and extend to instants far from their anchors", () => {
  // Cycles pages: Augury Rock 2011-03-03 and again 2011-05-11 (69 days), Droajam
  // 2009-06-11 and 2009-08-16 (66 days), Jaya Bluffs 2017-02-15 and 2017-11-14
  // (136 days), Grawl Necklace 2026-07-01 and 2026-08-22 (52 days).
  assert.equal(titles("2011-03-03T16:00:00Z")[0], "Augury Rock");
  assert.equal(titles("2011-03-03T15:59:00Z")[0], "The Frost Gate");
  assert.equal(titles("2011-05-11T18:00:00Z")[0], "Augury Rock");
  assert.equal(titles("2009-06-11T16:00:00Z")[1], "Droajam, Mage of the Sands");
  assert.equal(titles("2009-08-16T18:00:00Z")[1], "Droajam, Mage of the Sands");
  assert.equal(titles("2017-02-15T18:00:00Z")[3], "Jaya Bluffs");
  assert.equal(titles("2017-11-14T18:00:00Z")[3], "Jaya Bluffs");
  assert.equal(titles("2026-07-01T07:00:00Z")[6], "Grawl Necklaces");
  assert.equal(titles("2026-08-22T07:00:00Z")[6], "Grawl Necklaces");
  // Combat repeats every 28 days: 29 October 2026 is the Jade Quarry of 26 November.
  assert.equal(titles("2026-10-29T18:00:00Z")[2], "Jade Quarry");
});
