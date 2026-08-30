import assert from "node:assert/strict";
import test from "node:test";
import {
  closedCharacterProbeFailureCode,
  projectCharacterProbeLiveResult,
} from "../../scripts/enhancements-live/result.js";
import {
  createCharacterListProbeReader,
  installCharacterListProbe,
} from "../../src/renderer/character-list-probe.js";

const ROOT_POINTER = 0x5a75e8;
const ROOT_COUNT = 0x5a75f0;
const SELECTED_NAME = 0x5a7760;
const RECORD_BYTES = 0x84;
const NAME_OFFSET = 0x18;
const SUMMARY_OFFSET = 0x40;
const ARRAY = 0x10_0000;
const SECOND_ARRAY = 0x11_0000;

type CharacterFixture = Readonly<{
  name: string;
  profession?: number;
  secondaryProfession?: number;
  campaign?: number;
  level?: number;
  map?: number;
  pvp?: number;
}>;

function writeName(view: DataView, pointer: number, value: string): void {
  for (let index = 0; index < 20; index += 1) {
    view.setUint16(pointer + index * 2, value.charCodeAt(index) || 0, true);
  }
}

function writeCharacters(
  view: DataView,
  characters: readonly CharacterFixture[],
  pointer = ARRAY,
): void {
  view.setUint32(ROOT_POINTER, pointer, true);
  view.setUint32(ROOT_COUNT, characters.length, true);
  characters.forEach((character, index) => {
    const record = pointer + index * RECORD_BYTES;
    view.setUint32(record + 4, 33, true);
    view.setUint32(record + 8, index + 1, true);
    view.setUint32(record + 12, 0x1234_0000 + index, true);
    writeName(view, record + NAME_OFFSET, character.name);
    const summary = record + SUMMARY_OFFSET;
    view.setUint16(summary, 8, true);
    view.setUint16(summary + 2, character.map ?? 55, true);
    view.setUint32(summary + 8, (character.profession ?? 3) << 20, true);
    view.setUint16(
      summary + 28,
      (character.campaign ?? 2)
        | ((character.level ?? 20) << 4)
        | ((character.pvp ?? 0) << 9)
        | ((character.secondaryProfession ?? 0) << 10),
      true,
    );
  });
}

function fixture(characters: readonly CharacterFixture[] = []) {
  const memory = new WebAssembly.Memory({ initial: 100 });
  const view = new DataView(memory.buffer);
  if (characters.length > 0) writeCharacters(view, characters);
  const read = createCharacterListProbeReader({ memory });
  return { memory, view, read };
}

test("reports an uninitialized list without reading records", () => {
  const { read } = fixture();
  assert.deepEqual(read(), {
    schema: 2,
    status: "absent",
    reason: "not-initialized",
    observation: 1,
    stableRootReads: 1,
    revision: 0,
    transition: "initial",
    count: 0,
    selectedIndex: null,
    selectedIdentity: "none",
    fields: {
      names: false,
      primaryProfession: false,
      secondaryProfession: false,
      characterIdentity: false,
      characterType: false,
      campaign: false,
      level: false,
      currentMapId: false,
    },
    ranges: {
      primaryProfession: null,
      secondaryProfession: null,
      campaign: null,
      level: null,
      currentMapId: null,
    },
  });
});

test("publishes only bounded aggregate fields after three stable root reads", () => {
  const { memory, view, read } = fixture([
    { name: "Alice Example", profession: 3, secondaryProfession: 4, campaign: 2, level: 20, map: 55 },
    { name: "Bob Example", profession: 8, secondaryProfession: 0, campaign: 4, level: 17, map: 194 },
  ]);
  writeName(view, SELECTED_NAME, "Bob Example");
  const before = new Uint8Array(memory.buffer).slice();
  assert.equal(read().status, "warming");
  assert.equal(read().status, "warming");
  const projection = read();
  assert.equal(projection.status, "ready");
  assert.equal(projection.count, 2);
  assert.equal(projection.selectedIndex, 1);
  assert.deepEqual(projection.ranges.primaryProfession, { min: 3, max: 8 });
  assert.deepEqual(projection.ranges.secondaryProfession, { min: 0, max: 4 });
  assert.equal(projection.fields.characterIdentity, true);
  assert.deepEqual(projection.ranges.campaign, { min: 2, max: 4 });
  assert.deepEqual(projection.ranges.level, { min: 17, max: 20 });
  assert.deepEqual(projection.ranges.currentMapId, { min: 55, max: 194 });
  const serialized = JSON.stringify(projection);
  assert.doesNotMatch(serialized, /Alice|Bob|pointer|record|email|uuid|search|0x/iu);
  assert.deepEqual(new Uint8Array(memory.buffer), before);
});

test("fails closed for count and record ranges", () => {
  const { view, read } = fixture();
  view.setUint32(ROOT_POINTER, ARRAY, true);
  view.setUint32(ROOT_COUNT, 65, true);
  assert.equal(read().reason, "count-out-of-range");
  view.setUint32(ROOT_POINTER, 0xffff_fffc, true);
  view.setUint32(ROOT_COUNT, 1, true);
  assert.equal(read().reason, "array-out-of-range");
});

test("fails closed for duplicate names and invalid format-8 fields", () => {
  const duplicate = fixture([{ name: "Same Name" }, { name: "Same Name" }]);
  assert.equal(duplicate.read().reason, "name-duplicate");

  const duplicateIdentity = fixture([{ name: "First Name" }, { name: "Second Name" }]);
  for (let offset = 0; offset < 16; offset += 4) {
    duplicateIdentity.view.setUint32(
      ARRAY + RECORD_BYTES + 8 + offset,
      duplicateIdentity.view.getUint32(ARRAY + 8 + offset, true),
      true,
    );
  }
  assert.equal(duplicateIdentity.read().reason, "record-invalid");

  const invalidField = fixture([{ name: "Valid Name", profession: 11 }]);
  assert.equal(invalidField.read().reason, "field-out-of-range");

  const invalidSecondary = fixture([{ name: "Valid Name", secondaryProfession: 11 }]);
  assert.equal(invalidSecondary.read().reason, "field-out-of-range");

  const invalidSummary = fixture([{ name: "Valid Name" }]);
  invalidSummary.view.setUint32(ARRAY + 4, 0, true);
  assert.equal(invalidSummary.read().reason, "record-invalid");

  const legacySummary = fixture([{ name: "Valid Name" }]);
  legacySummary.view.setUint16(ARRAY + SUMMARY_OFFSET, 7, true);
  assert.equal(legacySummary.read().reason, "summary-invalid");
});

test("warms again after root replacement and clears stale identity", () => {
  const { view, read } = fixture([{ name: "First Character" }]);
  writeName(view, SELECTED_NAME, "First Character");
  read();
  read();
  assert.equal(read().status, "ready");

  writeCharacters(view, [{ name: "First Character" }], SECOND_ARRAY);
  const replaced = read();
  assert.equal(replaced.status, "warming");
  assert.equal(replaced.stableRootReads, 1);
  assert.equal(replaced.transition, "changed");

  view.setUint32(ROOT_POINTER, 0, true);
  view.setUint32(ROOT_COUNT, 0, true);
  const cleared = read();
  assert.equal(cleared.status, "absent");
  assert.equal(cleared.transition, "cleared");
  assert.equal(cleared.selectedIndex, null);
});

test("refuses a selected name that is absent from the stable list", () => {
  const { view, read } = fixture([{ name: "Known Character" }]);
  writeName(view, SELECTED_NAME, "Different Character");
  assert.equal(read().reason, "selected-identity-invalid");
});

test("the persisted live result drops generic gameplay and private diagnostics", () => {
  const genericResult = {
    scenario: "character-list",
    supported: true,
    buildId: 3_759_047_528,
    installation: 1,
    map: { id: 55, player: { id: 1234 } },
    target: { id: 5678 },
    accountEmail: "private@example.test",
    rawRecord: "Alice Example",
    pointer: "0x123456",
  };
  const result = projectCharacterProbeLiveResult(genericResult, {
    phases: [{ status: "ready", count: 2 }],
  }, 0);

  assert.deepEqual(result, {
    scenario: "character-list",
    supported: true,
    buildId: 3_759_047_528,
    installation: 1,
    rendererErrorCount: 0,
    evidence: { phases: [{ status: "ready", count: 2 }] },
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /Alice|private@example|pointer|record|player|target|0x/iu,
  );
});

test("character-probe startup failures collapse to closed privacy-safe codes", () => {
  assert.equal(
    closedCharacterProbeFailureCode(new Error("Electron exited before connection (1/null)")),
    "app-exited-before-debugger",
  );
  assert.equal(
    closedCharacterProbeFailureCode(new Error("private account text and /private/path")),
    "runner-internal",
  );
  assert.equal(
    closedCharacterProbeFailureCode(new Error("enhancement_transform")),
    "client-enhancement_transform",
  );
});

test("installation is exact-build-only and disposal withdraws the reader", () => {
  const memory = new WebAssembly.Memory({ initial: 100 });
  assert.equal(installCharacterListProbe(memory, 3_759_047_527), null);
  const installed = installCharacterListProbe(memory, 3_759_047_528);
  assert.ok(installed);
  installed.dispose();
  assert.equal(installed.read().reason, "probe-unavailable");
});
