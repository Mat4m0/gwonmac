// Redistribution policy: every shipped font is an unmodified, pinned OFL face
// and its complete license travels beside it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the bundled fonts are pinned and carry their OFL licenses", () => {
  const fontDirectory = path.join(root, "src/renderer/fonts");
  assert.deepEqual(
    readdirSync(fontDirectory).sort(),
    ["COPYING-QUALITYPE", "QTFrizQuad.otf"],
  );
  const font = readFileSync(path.join(fontDirectory, "QTFrizQuad.otf"));
  assert.equal(
    createHash("sha256").update(font).digest("hex"),
    "ecde72ff2f34841942c2043837310cac9354713e28e854e3938eaef16d6d39b2",
  );
  const license = readFileSync(
    path.join(fontDirectory, "COPYING-QUALITYPE"),
    "utf8",
  );
  assert.match(license, /Copyright \(c\) 1992 QualiType/);
  assert.match(license, /SIL OPEN FONT LICENSE[\s\S]*Version 1\.1/);
  const css = readFileSync(path.join(root, "src/renderer/loading.css"), "utf8");
  assert.match(css, /font-family: "QTFrizQuad"/);
  assert.match(css, /url\("fonts\/QTFrizQuad\.otf"\)/);

  const rootPackage = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { devDependencies: Record<string, string> };
  const toolsPackage = JSON.parse(
    readFileSync(path.join(root, "apps/tools/package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  assert.equal(rootPackage.devDependencies["@fontsource-variable/inter"], "5.3.0");
  assert.equal(toolsPackage.dependencies["@fontsource-variable/inter"], "5.3.0");

  const interDirectory = path.join(root, "node_modules/@fontsource-variable/inter");
  const expectedHashes = new Map([
    ["files/inter-cyrillic-ext-wght-normal.woff2", "ca157063339ac4ad418f214f3abfed119b0798ab4d377386ce5c9e5a7a435ebd"],
    ["files/inter-cyrillic-wght-normal.woff2", "71d5ee93cc1e9f1d520a3a8b66456de18c7879d8df09d57fcd2eaff75fef0075"],
    ["files/inter-greek-ext-wght-normal.woff2", "6e9e020a25f9b56d418f2c085b1d3c09725a4da23fe693a5b463064606732190"],
    ["files/inter-greek-wght-normal.woff2", "1be3448e292fbf05ffe176fe1e43f135013d50b1e7d324ad1a558f623d3bb6f6"],
    ["files/inter-latin-ext-wght-normal.woff2", "34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956"],
    ["files/inter-latin-wght-normal.woff2", "3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62"],
    ["files/inter-vietnamese-wght-normal.woff2", "5c66f9e07e90c6d4ac4922cc68d60de26c17b1858e677fb5e603fce3952b3ff2"],
  ]);
  for (const [relative, expected] of expectedHashes) {
    const bytes = readFileSync(path.join(interDirectory, relative));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, relative);
  }
  const interCss = readFileSync(path.join(interDirectory, "wght.css"), "utf8");
  assert.match(interCss, /font-family: 'Inter Variable'/);
  assert.match(interCss, /font-weight: 100 900/);
  const interLicense = readFileSync(path.join(interDirectory, "LICENSE"), "utf8");
  assert.match(interLicense, /Copyright 2016 The Inter Project Authors/);
  assert.match(interLicense, /SIL OPEN FONT LICENSE Version 1\.1/);

  const copyRenderer = readFileSync(path.join(root, "scripts/copy-renderer.mjs"), "utf8");
  for (const relative of expectedHashes.keys()) assert.match(copyRenderer, new RegExp(relative));
  assert.match(copyRenderer, /\["wght\.css", "fonts\/inter\.css"\]/);
  assert.match(copyRenderer, /\["LICENSE", "fonts\/COPYING-INTER"\]/);
});
