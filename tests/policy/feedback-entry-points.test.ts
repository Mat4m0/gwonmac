import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const templateDirectory = ".github/ISSUE_TEMPLATE";

test("bug and feature intake stays short, structured, and issue-backed", () => {
  const bug = read(`${templateDirectory}/bug-report.yml`);
  assert.match(bug, /labels:\n {2}- bug/u);
  assert.match(bug, /id: behavior[\s\S]*required: true/u);
  assert.match(bug, /id: reproduction/u);
  assert.match(bug, /id: diagnostics/u);
  assert.doesNotMatch(bug, /id: (?:area|mac)/u);

  const feature = read(`${templateDirectory}/feature-request.yml`);
  assert.match(feature, /labels:\n {2}- enhancement/u);
  assert.match(feature, /id: request[\s\S]*required: true/u);
  assert.match(feature, /id: motivation/u);

  const config = read(`${templateDirectory}/config.yml`);
  assert.match(config, /blank_issues_enabled: false/u);
  assert.match(config, /name: Questions and support/u);
  assert.doesNotMatch(config, /Questions and ideas/u);
});

test("public bug and feature links name issue templates that exist", () => {
  const publicSources = [
    "README.md",
    "docs/user-guide.md",
    "src/shared/contracts.ts",
    "apps/website/app/pages/index.vue",
    "apps/website/content/en/1.docs/1.guides/1.install.md",
    "apps/website/content/en/1.docs/1.guides/6.troubleshooting.md",
    "apps/website/content/de/1.dokumentation/1.anleitungen/1.installation.md",
    "apps/website/content/de/1.dokumentation/1.anleitungen/6.fehlerbehebung.md",
  ];
  const templates = publicSources.flatMap((file) =>
    [...read(file).matchAll(/template=([a-z0-9-]+\.yml)/gu)]
      .map((match) => match[1]!),
  );

  assert.ok(templates.includes("bug-report.yml"));
  assert.ok(templates.includes("feature-request.yml"));
  for (const template of templates) {
    assert.ok(
      existsSync(path.join(root, templateDirectory, template)),
      `public link names missing issue template ${template}`,
    );
  }
});
