// The sentences the Build Templates pane says. They are pure functions so they
// can be executed here rather than asserted about, and the one that matters
// most is the least obvious: the client caches its template scan, so an import
// that does not name Refresh List reads to the player as an import that did
// nothing.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeExport,
  describeImported,
  describeRescue,
  describeStranded,
  describePreview,
  describeSkips,
  describeStored,
} from "../../src/renderer/template-pane.js";
import type { TemplateParse } from "../../src/renderer/template-format.js";
import type { ImportPlan } from "../../src/renderer/template-store.js";

const SKILLS = "OQCiUyo8AkVwR4KMMGAAAEAA";
const EQUIPMENT = "Pk5hbug2fkaiklWVqQhyI90YjyIBLziyIBTpgyIBr7hyIbB";

const skill = (name: string) =>
  ({ kind: "skills", folder: null, name, code: SKILLS }) as const;
const equipment = (name: string) =>
  ({ kind: "equipment", folder: null, name, code: EQUIPMENT }) as const;

const plan = (over: Partial<ImportPlan> = {}): ImportPlan => ({
  writes: [],
  already: 0,
  taken: 0,
  replaced: 0,
  full: 0,
  unsafe: 0,
  ...over,
});

const parse = (over: Partial<TemplateParse> = {}): TemplateParse => ({
  candidates: [],
  skipped: { "no-code": 0, "too-many": 0 },
  renamed: 0,
  autoNamed: 0,
  ...over,
});

test("counts what is saved, in whichever kinds exist", () => {
  assert.equal(describeStored([]), "No templates saved yet.");
  assert.equal(describeStored([skill("A")]), "1 skill template saved.");
  assert.equal(describeStored([skill("A"), skill("B")]), "2 skill templates saved.");
  assert.equal(describeStored([equipment("A")]), "1 equipment template saved.");
  assert.equal(
    describeStored([skill("A"), skill("B"), equipment("C")]),
    "2 skill templates and 1 equipment template saved.",
  );
});

test("says what an import would do before it does it", () => {
  assert.equal(describePreview(plan()), "Nothing new to import.");
  assert.equal(
    describePreview(plan({ writes: [skill("A"), equipment("B")] })),
    "1 skill template and 1 equipment template will be imported.",
  );
});

test("explains a difference between what was picked and what will land", () => {
  assert.equal(describeSkips(plan(), parse()), "");

  const text = describeSkips(
    plan({ already: 12, taken: 2, full: 1, unsafe: 1 }),
    parse({ skipped: { "no-code": 5, "too-many": 0 }, renamed: 3, autoNamed: 1 }),
  );
  assert.match(text, /^Skipped or adjusted: /);
  assert.match(text, /12 already saved/);
  assert.match(text, /2 would replace a different build/);
  assert.match(text, /550 templates/);
  assert.match(text, /1 name the game cannot use/);
  assert.match(text, /5 lines with no template code/);
  assert.match(text, /1 code with no name/);
  assert.match(text, /3 names adjusted to characters Guild Wars accepts/);
  assert.ok(text.endsWith("."));
});

test("a zero bucket contributes no clause", () => {
  assert.equal(
    describeSkips(plan({ already: 1 }), parse()),
    "Skipped or adjusted: 1 already saved.",
  );
});

test("a finished import names the in-game action that reveals it", () => {
  // The client returns early from its scan when state is already set, so the
  // files are there and the list is not. Refresh List is what clears it.
  const text = describeImported(43);
  assert.match(text, /^Imported 43 templates\./);
  assert.match(text, /Refresh List/);

  assert.match(describeImported(1), /^Imported 1 template\./);
  assert.equal(describeImported(0), "Nothing was imported.");
});

test("names the state the game offers no way out of", () => {
  assert.equal(
    describeStranded(1),
    "1 template is saved in a folder Guild Wars cannot read, so it is not listed in game.",
  );
  assert.match(describeStranded(3), /^3 templates are saved/);
});

test("a rescue reports what moved, what did not, and how to see it", () => {
  const moved = describeRescue({ moved: 2, blocked: 0 });
  assert.match(moved, /^Moved 2 templates to the top level\./);
  assert.match(moved, /Refresh List/);

  const partial = describeRescue({ moved: 1, blocked: 2 });
  assert.match(partial, /Moved 1 template/);
  assert.match(partial, /2 templates could not be moved/);
  assert.match(partial, /unchanged/);

  // Nothing moved means nothing to refresh, so the instruction is not offered.
  const none = describeRescue({ moved: 0, blocked: 1 });
  assert.doesNotMatch(none, /Refresh List/);
  assert.equal(describeRescue({ moved: 0, blocked: 0 }), "Nothing to move.");
});

test("an export says what it wrote, and a cancel says nothing at all", () => {
  assert.equal(
    describeExport({ status: "written", count: 2 }),
    "Exported 2 templates.",
  );
  assert.equal(describeExport({ status: "cancelled" }), null);

  const failed = describeExport({ status: "failed", errorCode: "disk_full" });
  assert.ok(failed);
  assert.match(failed, /free disk space/i);
  // The player's saved templates are untouched by a failed export, and the
  // sentence has to say so rather than leave them wondering.
  assert.match(
    describeExport({ status: "failed", errorCode: "unknown" }) ?? "",
    /unchanged/,
  );
});
