// "You can retheme it" is the kind of claim that is true on the day it is
// written and false three components later. One hardcoded `oklch(66% 0.11 76)`
// in a hover state is invisible in review, survives every visual check, and
// then a player picks Jade and one button stays brass.
//
// So the claim is enforced rather than asserted. Neither `ui/components.css`
// nor the two stylesheets that consume it may contain a colour or a corner —
// every one has to resolve through a variable declared in `ui/tokens.css`.
// That is what makes `--ui-radius: 0` square the whole interface instead of
// most of it.
//
// The test also runs the other way: a token nothing reads is dead weight in
// the one file people open to find out what they are allowed to change.
//
//   node --import ./scripts/ts-hook.mjs --experimental-strip-types --test \
//     tests/unit/the-ui-system-has-one-place-to-change-a-colour.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const TOKENS = "src/shared/ui/tokens.css";

/** Every stylesheet that is downstream of the tokens, and so may not hold a
 *  literal. The Tools workbench is on the list for the same reason the
 *  Settings dialog is: two surfaces of one product cannot each own a palette. */
const CONSUMERS = [
  "src/shared/ui/components.css",
  "src/renderer/harness.css",
  "apps/tools/src/styles.css",
];

const tokens = readFileSync(TOKENS, "utf8");
const consumers = CONSUMERS.map(
  (path) => [path, readFileSync(path, "utf8")] as const,
);

/** Strip comments, so prose about `oklch(20% …)` is not read as a declaration. */
const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `--ui-…` declared on the left of a colon in tokens.css. */
function declaredTokens(): Set<string> {
  const names = new Set<string>();
  for (const match of code(tokens).matchAll(/(--ui-[a-z0-9-]+)\s*:/g)) {
    names.add(match[1]!);
  }
  return names;
}

/** Every `var(--ui-…)` reference in a stylesheet. */
function referenced(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of code(css).matchAll(/var\((--ui-[a-z0-9-]+)/g)) {
    names.add(match[1]!);
  }
  return names;
}

test("no component decides a colour for itself", () => {
  const offenders: string[] = [];
  for (const [path, css] of consumers) {
    code(css)
      .split("\n")
      .forEach((line, index) => {
        // Hex literals, and the functional notations that would smuggle one
        // past a hex check. `color-mix` is allowed because its arguments are
        // themselves checked by this same sweep.
        const hex = line.match(/#[0-9a-fA-F]{3,8}\b/);
        const fn = line.match(/\b(rgba?|hsla?|oklch|lab|lch)\(/);
        if (hex || fn) offenders.push(`${path}:${index + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(
    offenders,
    [],
    `every colour must resolve through a token:\n${offenders.join("\n")}`,
  );
});

test("no component decides a corner for itself", () => {
  const offenders: string[] = [];
  for (const [path, css] of consumers) {
    code(css)
      .split("\n")
      .forEach((line, index) => {
        // Every radius declaration on the line, not just the first: a rule
        // written on one line would otherwise hide behind its neighbour.
        for (const match of line.matchAll(/border(?:-[a-z]+)*-radius\s*:([^;}]*)/g)) {
          // `0` is a real answer — a tab's bottom corners are square by
          // design, and that is shape rather than a themeable length.
          if (/\b\d+(\.\d+)?(px|rem|em|%)/.test(match[1]!)) {
            offenders.push(`${path}:${index + 1}: ${match[0]!.trim()}`);
          }
        }
      });
  }
  assert.deepEqual(
    offenders,
    [],
    `border-radius must come from --ui-radius:\n${offenders.join("\n")}`,
  );
});

test("no consumer invents a stacking order", () => {
  // Two surfaces that each pick their own z-index is how a toast ends up
  // behind the panel it is reporting on. The scale is in tokens.css.
  const offenders: string[] = [];
  for (const [path, css] of consumers) {
    code(css)
      .split("\n")
      .forEach((line, index) => {
        const match = line.match(/z-index\s*:\s*(-?\d+)/);
        // -1 and 1 park the on-screen-keyboard fields behind and in front of
        // the canvas. They are not a layer in the interface's own stack.
        if (match && Math.abs(Number(match[1])) > 1) {
          offenders.push(`${path}:${index + 1}: ${line.trim()}`);
        }
      });
  }
  assert.deepEqual(
    offenders,
    [],
    `z-index must come from the --ui-z-* scale:\n${offenders.join("\n")}`,
  );
});

test("each theme defines the whole family, not just an accent", () => {
  // A partial theme is worse than no theme: it inherits half a palette from
  // the default and produces a combination nobody designed.
  // Colour families only. `--ui-line-height` and `--ui-text-shadow` start with
  // the same words but are type and elevation, which no theme redefines.
  const themed = [...declaredTokens()].filter(
    (name) =>
      /^--ui-(base|raised|well|hover|selected|line|text|accent|frame|outline|focus)\b/
        .test(name)
      && !/^--ui-(line-height|text-shadow|accent-fill)$/.test(name),
  );
  assert.ok(themed.length >= 15, "a theme is more than one colour");

  for (const theme of ["steel", "jade"]) {
    const block = code(tokens).match(
      new RegExp(`\\[data-ui-theme="${theme}"\\]\\s*\\{([^}]*)\\}`),
    );
    assert.ok(block, `${theme} is declared`);
    const missing = themed.filter(
      (name) =>
        !new RegExp(`${name}\\s*:`).test(block[1]!)
        // Derived from the theme's own values, so a theme must not restate it.
        && !new RegExp(`${name}\\s*:`).test(derivedBlock()),
    );
    assert.deepEqual(missing, [], `${theme} must set: ${missing.join(", ")}`);
  }
});

/** The second `:root` block: values composed from the theme's own tokens. */
function derivedBlock(): string {
  const blocks = [...code(tokens).matchAll(/:root\s*\{([^}]*)\}/g)];
  return blocks.slice(1).map((match) => match[1]!).join("\n");
}

test("every token a stylesheet uses is actually declared", () => {
  const declared = declaredTokens();
  const missing: string[] = [];
  for (const [path, css] of [...consumers, [TOKENS, tokens] as const]) {
    for (const name of referenced(css)) {
      // `--ui-profession` and `--swatch` are set by a data attribute at the
      // point of use, not declared as a theme value.
      if (name === "--ui-profession") continue;
      if (!declared.has(name)) missing.push(`${path}: ${name}`);
    }
  }
  assert.deepEqual(missing, [], `undeclared tokens: ${missing.join(", ")}`);
});

test("every token declared is actually read", () => {
  // The token file is the retheming documentation. A variable nothing reads is
  // a promise to a reader that changing it will do something.
  const used = new Set([
    ...consumers.flatMap(([, css]) => [...referenced(css)]),
    ...referenced(tokens),
  ]);
  const unused = [...declaredTokens()].filter((name) => !used.has(name));
  assert.deepEqual(unused, [], `declared but never read: ${unused.join(", ")}`);
});

test("no token reference carries a leftover alpha suffix", () => {
  // `#f3dd9d1a` is a colour with an alpha pair on the end. Substituting the
  // six-digit part for a token leaves `var(--ui-accent)1a`, which is not a
  // colour — the declaration is dropped and the rule silently loses its
  // background. It renders as "nothing happened", which is the hardest kind of
  // CSS bug to see. The fix is `color-mix()`, which is themeable anyway.
  const offenders: string[] = [];
  for (const [path, css] of [...consumers, [TOKENS, tokens] as const]) {
    for (const match of code(css).matchAll(/var\(--ui-[a-z0-9-]+\)[0-9a-fA-F]{2}/g)) {
      offenders.push(`${path}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("the derived radii really derive, so a theme cannot half-round", () => {
  const body = code(tokens);
  for (const name of ["--ui-radius-sm", "--ui-radius-lg"]) {
    const line = body.match(new RegExp(`${name}\\s*:([^;]*);`));
    assert.ok(line, `${name} is declared`);
    assert.match(
      line[1]!,
      /var\(--ui-radius\)/,
      `${name} must be computed from --ui-radius, not restated`,
    );
  }
});
