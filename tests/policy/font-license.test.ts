// Redistribution policy: exactly one font ships, it is the unmodified QT Friz
// Quad face pinned by SHA-256, and its SIL OFL 1.1 notice travels beside it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the only bundled font is the pinned OFL-licensed QT Friz Quad", () => {
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
});
