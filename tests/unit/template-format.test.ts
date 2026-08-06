// The text rules a build template import and export both depend on. The module
// is imported and executed, not read as text: every case here is a shape a real
// Guild Wars install or a real forum post produces, and the ones that look
// pedantic — a BOM, an NFD name, a trailing newline — are each a way the client
// silently refuses a file that looks correct in a text editor.

import assert from "node:assert/strict";
import { test } from "node:test";

import { TEMPLATE_CEILINGS } from "../../src/shared/contracts.js";
import {
  combineParses,
  decodeTemplateText,
  namePrefixFromRelativePath,
  isTemplateCode,
  parseTemplateSource,
  sanitiseTemplateName,
  sourceNameFromFileName,
  templateKind,
  templateRelativePath,
} from "../../src/renderer/template-format.js";

const SKILLS = "OQCiUyo8AkVwR4KMMGAAAEAA";
const EQUIPMENT = "Pk5hbug2fkaiklWVqQhyI90YjyIBLziyIBTpgyIBr7hyIbB";

const utf8 = (text: string) => new TextEncoder().encode(text).buffer;

test("recognises the two template kinds and nothing else", () => {
  assert.equal(isTemplateCode(SKILLS), true);
  assert.equal(isTemplateCode(EQUIPMENT), true);
  assert.equal(templateKind(SKILLS), "skills");
  assert.equal(templateKind(EQUIPMENT), "equipment");

  // A leading character that is neither type, a code too short to be one, and
  // a character outside the alphabet.
  assert.equal(isTemplateCode("QQCiUyo8AkVwR4KMMGAAAEAA"), false);
  assert.equal(isTemplateCode("OQCi"), false);
  assert.equal(isTemplateCode("OQCiUyo8AkVwR4KMMGAAAE=="), false);
  assert.equal(isTemplateCode(""), false);
});

test("reads the file the game itself writes", () => {
  // One code, no trailing newline, name carried by the filename. The folder it
  // came from survives in the name, never as a directory: defect 8 in
  // internal/upstream/upstream-defects.md is that the client's scan never
  // enumerates a subdirectory, so a template placed in one is never listed.
  const parse = parseTemplateSource(SKILLS, {
    sourceName: sourceNameFromFileName("Shockaxe.txt"),
    namePrefix: "Warrior",
  });
  assert.deepEqual(parse.candidates, [
    { kind: "skills", folder: null, name: "Warrior - Shockaxe", code: SKILLS },
  ]);
  assert.equal(parse.skipped["no-code"], 0);
  assert.equal(parse.autoNamed, 0);
});

test("every import lands where the client will actually look", () => {
  const parses = [
    parseTemplateSource(SKILLS, { sourceName: "A", namePrefix: "Warrior" }),
    parseTemplateSource(SKILLS, { sourceName: "B", namePrefix: null }),
    parseTemplateSource(`C\t${EQUIPMENT}`, { sourceName: "list", namePrefix: "PvP" }),
  ];
  for (const candidate of combineParses(parses).candidates) {
    assert.equal(candidate.folder, null, candidate.name);
  }
});

test("a trailing newline does not change the file's meaning", () => {
  const parse = parseTemplateSource(`${SKILLS}\r\n`, {
    sourceName: "Shockaxe",
    namePrefix: null,
  });
  assert.equal(parse.candidates.length, 1);
  assert.equal(parse.candidates[0]?.code, SKILLS);
});

test("reads every form a shared build arrives in", () => {
  const text = [
    `Bare line`,
    SKILLS,
    `Tabbed\t${SKILLS}`,
    `Colon: ${SKILLS}`,
    `[Forum Build;${SKILLS}] and [Second;${EQUIPMENT}]`,
    `nothing useful here`,
  ].join("\n");
  const parse = parseTemplateSource(text, { sourceName: "MyBuilds", namePrefix: null });

  assert.deepEqual(
    parse.candidates.map((candidate) => candidate.name),
    ["MyBuilds 1", "Tabbed", "Colon", "Forum Build", "Second"],
  );
  // "Bare line" and "nothing useful here" hold no code.
  assert.equal(parse.skipped["no-code"], 2);
  assert.equal(parse.autoNamed, 1);
  assert.equal(parse.candidates.at(-1)?.kind, "equipment");
});

test("codes with no name are named after the file they came from", () => {
  const parse = parseTemplateSource([SKILLS, SKILLS, SKILLS].join("\n"), {
    sourceName: "Pasted",
    namePrefix: null,
  });
  assert.deepEqual(
    parse.candidates.map((candidate) => candidate.name),
    ["Pasted 1", "Pasted 2", "Pasted 3"],
  );
  assert.equal(parse.autoNamed, 3);
});

test("text with no origin still names what it imports", () => {
  // The clipboard has no filename to borrow, and a code the player cannot see
  // in a list is a code they cannot delete either.
  const parse = parseTemplateSource([SKILLS, EQUIPMENT].join("\n"), {
    sourceName: null,
    namePrefix: null,
  });
  assert.deepEqual(
    parse.candidates.map((candidate) => candidate.name),
    ["Template 1", "Template 2"],
  );
});

test("keeps a profession pair readable and refuses what the client refuses", () => {
  assert.equal(sanitiseTemplateName("Me/E Domination"), "Me-E Domination");
  assert.equal(sanitiseTemplateName("W\\Mo Sword"), "W-Mo Sword");
  assert.equal(sanitiseTemplateName("Wammo, PvE"), "Wammo PvE");
  assert.equal(sanitiseTemplateName("Build v1.2"), "Build v1 2");
  assert.equal(sanitiseTemplateName("Who? <Me> \"quoted\" | piped *star*"), "Who Me quoted piped star");
  assert.equal(sanitiseTemplateName("  spaced  out  "), "spaced out");
  assert.equal(sanitiseTemplateName("..."), "");
});

test("a name is never long enough to vanish from the client's listing", () => {
  const name = sanitiseTemplateName("W".repeat(400));
  assert.equal(name.length, TEMPLATE_CEILINGS.nameLength);
  // The client's record is WCHAR name[260] and it drops entries at or past it,
  // so the filename this becomes must still fit.
  assert.ok(`${name}.txt`.length < 260);
});

test("one name has one spelling", () => {
  // macOS hands back NFD where the game wrote NFC; two spellings would import
  // as a visible duplicate of the same build.
  const composed = "Café Build";
  const decomposed = "Café Build";
  assert.notEqual(composed, decomposed);
  assert.equal(sanitiseTemplateName(decomposed), composed);
});

test("counts the names it had to adjust", () => {
  const parse = parseTemplateSource(
    [`Me/E Domination\t${SKILLS}`, `Clean Name\t${SKILLS}`].join("\n"),
    { sourceName: "list", namePrefix: null },
  );
  assert.equal(parse.renamed, 1);
});

test("decodes a file however Windows wrote it", () => {
  assert.equal(decodeTemplateText(utf8(SKILLS)), SKILLS);

  const withUtf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(SKILLS)]);
  assert.equal(decodeTemplateText(withUtf8Bom.buffer), SKILLS);

  const utf16le = [0xff, 0xfe];
  for (const character of SKILLS) utf16le.push(character.charCodeAt(0), 0);
  assert.equal(decodeTemplateText(new Uint8Array(utf16le).buffer), SKILLS);

  const utf16be = [0xfe, 0xff];
  for (const character of SKILLS) utf16be.push(0, character.charCodeAt(0));
  assert.equal(decodeTemplateText(new Uint8Array(utf16be).buffer), SKILLS);
});

test("a byte order mark never reaches the code", () => {
  // Decoded as content, a BOM lands inside the code and the client answers
  // "does not appear to be valid" — round 8 of the investigation log.
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(SKILLS)]);
  const parse = parseTemplateSource(decodeTemplateText(withBom.buffer), {
    sourceName: "Shockaxe",
    namePrefix: null,
  });
  assert.equal(parse.candidates.length, 1);
  assert.equal(parse.candidates[0]?.code, SKILLS);
});

test("lands the same templates wherever the player started the picker", () => {
  // webkitRelativePath always begins with the directory that was selected.
  assert.equal(namePrefixFromRelativePath("Skills/Warrior/Shockaxe.txt"), "Warrior");
  assert.equal(namePrefixFromRelativePath("Skills/Shockaxe.txt"), null);
  assert.equal(namePrefixFromRelativePath("Templates/Skills/Shockaxe.txt"), null);
  assert.equal(
    namePrefixFromRelativePath("Guild Wars/Templates/Skills/Warrior/Shockaxe.txt"),
    "Warrior",
  );
  assert.equal(namePrefixFromRelativePath("MyBuilds/Shockaxe.txt"), null);
  assert.equal(namePrefixFromRelativePath("MyBuilds/Farming/Shockaxe.txt"), "Farming");
  assert.equal(namePrefixFromRelativePath("Shockaxe.txt"), null);
});

test("a picked path cannot name a folder outside the mount", () => {
  // Only the last surviving segment is ever used, and it is sanitised, so the
  // answer is always one plain folder name or none — never a path. A traversal
  // segment sanitises to nothing and so lands at the type root.
  assert.equal(namePrefixFromRelativePath("root/../Shockaxe.txt"), null);
  assert.equal(namePrefixFromRelativePath("root/./Shockaxe.txt"), null);
  assert.equal(namePrefixFromRelativePath("/etc/passwd"), null);

  for (const hostile of [
    "root/../../etc/Shockaxe.txt",
    "root/a/../../../../../../Shockaxe.txt",
    "root/..\\..\\Windows/Shockaxe.txt",
    "root/sub/../other/Shockaxe.txt",
  ]) {
    const folder = namePrefixFromRelativePath(hostile);
    if (folder === null) continue;
    assert.doesNotMatch(folder, /[/\\]/, hostile);
    assert.notEqual(folder, "..", hostile);
    assert.notEqual(folder, ".", hostile);
  }
});

test("bounds one gesture rather than one file", () => {
  const one = parseTemplateSource(SKILLS, { sourceName: "a", namePrefix: null });
  const many = Array.from({ length: TEMPLATE_CEILINGS.entries + 5 }, () => one);
  const combined = combineParses(many);
  assert.equal(combined.candidates.length, TEMPLATE_CEILINGS.entries);
  assert.equal(combined.skipped["too-many"], 5);
});

test("a Windows collection keeps its organisation in the only place the client shows", () => {
  const inFolder = parseTemplateSource(SKILLS, {
    sourceName: "Shockaxe",
    namePrefix: "Warrior",
  });
  assert.equal(inFolder.candidates[0]?.name, "Warrior - Shockaxe");

  // A prefix that sanitises to nothing leaves the name alone rather than
  // producing a leading separator.
  const unusable = parseTemplateSource(SKILLS, {
    sourceName: "Shockaxe",
    namePrefix: "...",
  });
  assert.equal(unusable.candidates[0]?.name, "Shockaxe");
});

test("writes the layout it reads", () => {
  assert.equal(
    templateRelativePath({ kind: "skills", folder: null, name: "Shockaxe", code: SKILLS }),
    "Skills/Shockaxe.txt",
  );
  assert.equal(
    templateRelativePath({ kind: "skills", folder: "Warrior", name: "Shockaxe", code: SKILLS }),
    "Skills/Warrior/Shockaxe.txt",
  );
  assert.equal(
    templateRelativePath({ kind: "equipment", folder: null, name: "PvP", code: EQUIPMENT }),
    "Equipment/PvP.txt",
  );
});

test("an export round-trips through the importer unchanged", () => {
  const original = parseTemplateSource(
    [`Me-E Domination\t${SKILLS}`, `PvP Set\t${EQUIPMENT}`].join("\n"),
    { sourceName: "list", namePrefix: null },
  ).candidates;

  const reread = original.map((candidate) => {
    const path = templateRelativePath(candidate);
    // What the exporter wrote is exactly what a picker hands back: the code as
    // the whole file, and the path as webkitRelativePath under a chosen root.
    const parse = parseTemplateSource(candidate.code, {
      sourceName: sourceNameFromFileName(path.split("/").at(-1) ?? ""),
      namePrefix: namePrefixFromRelativePath(`Guild Wars Build Templates/${path}`),
    });
    return parse.candidates[0];
  });

  // Everything an import produces sits at the type root, so the round trip is
  // exact. A template the *game* put in a subfolder exports with that folder
  // and re-imports with it folded into the name — structure is lost, which is
  // the price of defect 8 and is stated in the user guide.
  assert.deepEqual(reread, original);
});
