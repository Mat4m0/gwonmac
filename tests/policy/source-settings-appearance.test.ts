// Reads repository text, and says so in its filename. The appearance
// vocabularies exist twice by necessity, not by choice: `UI_THEMES` and
// `UI_DENSITIES` are values in `contracts.ts`, and the same names are `<option>`
// elements in `index.html`. `settings.ts` is a classic script — index.html loads
// it without `type="module"`, so it holds no runtime import and cannot compare
// the two itself. This file is that comparison.
//
// The way the drift fails is quiet from the code's side and loud from the
// player's: an option offered in the dialog that `parseSettings` does not know
// is chosen, sent, refused, and surfaces as "Settings could not be saved" with
// nothing in the interface explaining why. A missing option is worse — a value
// already in a profile that the dialog cannot show or restore.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UI_DENSITIES, UI_THEMES } from "../../src/shared/contracts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The `value` of every `<option>` inside the named `<select>`. */
function optionValues(html: string, selectName: string): string[] {
  const select = new RegExp(
    `<select\\b[^>]*\\bname\\s*=\\s*["']${selectName}["'][^>]*>([\\s\\S]*?)</select>`,
    "iu",
  ).exec(html);
  assert.ok(select, `index.html has no <select name="${selectName}">`);
  return [...select[1]!.matchAll(/<option\b[^>]*\bvalue\s*=\s*["']([^"']*)["']/giu)]
    .map((option) => option[1]!);
}

test("the appearance dialog offers exactly the vocabularies the contract defines", async () => {
  const html = await readFile(path.join(root, "src/renderer/index.html"), "utf8");

  assert.deepEqual(
    optionValues(html, "uiTheme"),
    [...UI_THEMES],
    "the theme options must match UI_THEMES, in the contract's order",
  );
  assert.deepEqual(
    optionValues(html, "uiDensity"),
    [...UI_DENSITIES],
    "the density options must match UI_DENSITIES, in the contract's order",
  );
});

/**
 * `main` refuses an out-of-range appearance value rather than clamping it, so
 * the slider's own bounds are the only thing standing between a drag and a
 * failed save. They are asserted against the numbers in `parseSettings` rather
 * than against literals repeated here, so the pair cannot be changed apart.
 */
test("each appearance slider is bounded exactly as parseSettings requires", async () => {
  const html = await readFile(path.join(root, "src/renderer/index.html"), "utf8");
  const settings = await readFile(
    path.join(root, "src/main/core/settings.ts"),
    "utf8",
  );

  for (const field of ["uiPanelOpacity", "uiBorderWidth", "uiRadius"]) {
    const input = new RegExp(
      `<input\\b[^>]*\\bname\\s*=\\s*["']${field}["'][^>]*>`,
      "iu",
    ).exec(html);
    assert.ok(input, `index.html has no range input for ${field}`);
    const attribute = (name: string) => {
      const found = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "iu")
        .exec(input[0]);
      assert.ok(found, `${field}'s input has no ${name}`);
      return found[1]!;
    };
    assert.equal(attribute("type"), "range", `${field} must be a range input`);

    // `asBoundedInteger(src.<field>, "<field>", <min>, <max>)`, however it is
    // wrapped across lines.
    const bounds = new RegExp(
      `asBoundedInteger\\(\\s*src\\.${field},\\s*"${field}",\\s*(\\d+),\\s*(\\d+),?\\s*\\)`,
      "u",
    ).exec(settings);
    assert.ok(bounds, `settings.ts does not bound ${field} via asBoundedInteger`);

    assert.equal(attribute("min"), bounds[1], `${field}'s min must match main`);
    assert.equal(attribute("max"), bounds[2], `${field}'s max must match main`);
    assert.equal(
      attribute("step"),
      "1",
      `${field} is validated as an integer, so its step must be 1`,
    );
  }
});
