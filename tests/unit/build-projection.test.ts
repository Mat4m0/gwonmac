import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  existingTemplateNames,
  publishBuildTemplate,
  templateFileName,
  uniqueTemplateName,
} from "../../src/renderer/build-projection.ts";
import { buildId, type Build } from "../../src/shared/builds/library.ts";
import { decodeSkillTemplate } from "../../src/shared/builds/skill-template.ts";

const template = decodeSkillTemplate("OwAU0Kn8Q4FgMjrUgtEA3TnA");
assert.ok(template);
const build: Build = {
  ...template,
  id: buildId("projection-test"),
  name: "Fresh Monk",
  tags: [],
  notes: "",
  favourite: false,
  lastUsed: null,
  parent: null,
  origin: null,
};

describe("build template projection", () => {
  it("sanitises a display name without turning separators into directories", () => {
    assert.equal(templateFileName("  .Roj\\Way: support  "), "RojWay support");
    assert.equal(templateFileName("... <>"), null);
  });

  it("never overwrites a template that already exists", () => {
    assert.equal(uniqueTemplateName(["Monk"], "Monk"), "Monk (2)");
    assert.equal(uniqueTemplateName(["Monk", "Monk (2)"], "Monk"), "Monk (3)");
  });

  it("recognises only skill-template files in the game directory", () => {
    assert.deepEqual(existingTemplateNames({
      readdir: () => [".", "..", "Monk.txt", "README", "Other.TXT"],
      writeFile() {},
      syncfs(_populate, callback) { callback(); },
    }), ["Monk", "Other"]);
  });

  it("writes the bare code owner-only and persists it before reporting success", async () => {
    const writes: unknown[][] = [];
    let synced = false;
    const runtime = globalThis as typeof globalThis & { FS?: unknown };
    const previous = runtime.FS;
    runtime.FS = {
      readdir: () => [".", "..", "Fresh Monk.txt"],
      writeFile: (...args: unknown[]) => writes.push(args),
      syncfs: (_populate: false, callback: (error?: unknown) => void) => {
        synced = true;
        callback();
      },
    };
    try {
      assert.deepEqual(await publishBuildTemplate(build), {
        fileName: "Fresh Monk (2).txt",
        location: "Templates/Skills",
      });
    } finally {
      runtime.FS = previous;
    }
    assert.equal(synced, true);
    assert.deepEqual(writes, [[
      "app:/Templates/Skills/Fresh Monk (2).txt",
      "OwAU0Kn8Q4FgMjrUgtEA3TnA",
      { mode: 0o600 },
    ]]);
  });
});
