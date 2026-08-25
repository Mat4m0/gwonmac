// Both interface styles are one system. One hardcoded colour in a
// component is invisible in review and becomes an accidental second style.
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
//   node --import ./scripts/ts-hook.mjs --test \
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
  "src/renderer/settings.css",
  "apps/tools/src/styles.css",
  "apps/tools/src/styles/base-shell.css",
  "apps/tools/src/styles/library.css",
  "apps/tools/src/styles/build.css",
  "apps/tools/src/styles/catalogue.css",
  "apps/tools/src/styles/team.css",
  "apps/tools/src/styles/trade.css",
];

/**
 * Surfaces that belong on `CONSUMERS` and are not there yet, each with the
 * reason. The renderer/game overlays predate the token system and still carry
 * literals; re-pointing them is its own visual change.
 *
 * The staleness test below is what stops this being a quiet exemption: the day
 * one of these files stops holding a literal, it fails here until it is moved
 * up into `CONSUMERS`, where the real rule applies.
 */
const NOT_YET_TOKENISED = ["src/renderer/harness.css"];

const tokens = readFileSync(TOKENS, "utf8");
const consumers = CONSUMERS.map(
  (path) => [path, readFileSync(path, "utf8")] as const,
);

/** Strip comments, so prose about `oklch(20% …)` is not read as a declaration. */
const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Settings includes deliberately literal Guild Wars swatches and icon art.
 * Exempt only those marked fragments, never their surrounding layout. */
const DOMAIN_ARTWORK =
  /\/\* ui-policy-domain-artwork:start[^]*?ui-policy-domain-artwork:end \*\//gu;
const paletteCode = (path: string, css: string): string => {
  if (path !== "src/renderer/settings.css") return code(css);
  const artwork = [...css.matchAll(DOMAIN_ARTWORK)];
  if (artwork.length !== 2) {
    throw new Error(`expected two Settings domain-artwork fragments, found ${artwork.length}`);
  }
  const withoutArtwork = css.replace(DOMAIN_ARTWORK, "");
  return code(withoutArtwork);
};

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
    paletteCode(path, css)
      .split("\n")
      .forEach((line, index) => {
        // Hex literals, functional colour notations, and local mixes all
        // create feature-owned paint. Mixtures belong in the shared
        // projection/component layer where every surface gets the same state.
        const hex = line.match(/#[0-9a-fA-F]{3,8}\b/);
        const fn = line.match(/\b(rgba?|hsla?|oklch|lab|lch)\(/);
        const mix = path !== "src/shared/ui/components.css" && line.match(/\bcolor-mix\(/);
        if (hex || fn || mix) offenders.push(`${path}:${index + 1}: ${line.trim()}`);
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
    paletteCode(path, css)
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

test("style projections stay in tokens and consumers do not branch", () => {
  const selectors = [...code(tokens).matchAll(/:root\[data-ui-style="([^"]+)"\]/gu)]
    .map((match) => match[1]);
  assert.deepEqual(selectors, ["obsidian"]);
  for (const [, css] of consumers) {
    assert.doesNotMatch(code(css), /\[data-ui-(?:style|theme|density)=/u);
  }
});

test("persistent interaction states do not leak into neutral controls", () => {
  const components = readFileSync("src/shared/ui/components.css", "utf8");
  const toolsShell = readFileSync("apps/tools/src/styles/base-shell.css", "utf8");
  const rule = (source: string, selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u"))?.[1] ?? "";
  };

  assert.match(rule(components, ".ui-button"), /var\(--ui-command-fill\)/u);
  assert.match(rule(components, '.ui-button[data-variant="primary"]'), /var\(--ui-primary-fill\)/u);
  assert.doesNotMatch(rule(components, ".ui-button[data-icon]"), /--ui-shadow-selected/u);
  assert.doesNotMatch(rule(components, ".ui-slot"), /--ui-shadow-selected/u);
  assert.doesNotMatch(rule(toolsShell, ".window-brand"), /--ui-shadow-selected/u);
  assert.match(
    rule(components, '.ui-tab[aria-selected="true"]'),
    /inset 0 -2px 0 var\(--ui-selection-marker\)/u,
  );
  assert.match(rule(components, '.ui-button[data-variant="quiet"]'), /background: transparent/u);
  assert.doesNotMatch(rule(components, '.ui-row'), /--ui-row-fill/u);
});

test("shared interaction feedback owns disabled, active, and error presentation", () => {
  const components = code(readFileSync("src/shared/ui/components.css", "utf8"));
  const catalogue = code(readFileSync("apps/tools/src/styles/catalogue.css", "utf8"));
  const build = code(readFileSync("apps/tools/src/styles/build.css", "utf8"));

  for (const selector of [
    '.ui-button[aria-disabled="true"]',
    ".ui-input:disabled",
    ".ui-segment button:disabled",
    ".ui-tab:disabled",
    '.ui-row[aria-disabled="true"]',
    'button.ui-chip[aria-disabled="true"]',
  ]) {
    assert.ok(components.includes(selector), `${selector} has shared disabled feedback`);
  }
  for (const selector of [
    ".ui-segment button:active:not(:disabled)",
    ".ui-tab:active:not(:disabled)",
    '.ui-row:active:not([aria-disabled="true"])',
  ]) {
    assert.ok(components.includes(selector), `${selector} has pointer feedback`);
  }
  assert.match(components, /\.ui-field-error\s*\{/u);
  assert.doesNotMatch(catalogue, /\.field-error\s*\{/u);
  assert.doesNotMatch(build, /\.authoring-tabs > button:focus-visible\s*\{/u);
  assert.match(components, /\.ui-frame :where\([^}]*\):focus-visible\s*\{/u);
});

test("every token a stylesheet uses is actually declared", () => {
  const declared = declaredTokens();
  const missing: string[] = [];
  for (const [path, css] of [...consumers, [TOKENS, tokens] as const]) {
    for (const name of referenced(css)) {
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
    ...NOT_YET_TOKENISED.flatMap((path) => [...referenced(readFileSync(path, "utf8"))]),
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

test("the measured Guild Wars radii are fixed in the token source", () => {
  const body = code(tokens);
  for (const name of ["--ui-radius", "--ui-radius-sm", "--ui-radius-lg", "--ui-radius-swell"]) {
    const line = body.match(new RegExp(`${name}\\s*:([^;]*);`));
    assert.ok(line, `${name} is declared`);
    assert.match(line[1]!, /\d+px/u, `${name} is a measured fixed length`);
  }
});

test("a not-yet-tokenised surface is still not tokenised", () => {
  // An exemption nobody rechecks becomes permission. Each entry has to still
  // need the exemption: once a file resolves every colour through a token, it
  // belongs on CONSUMERS, and this fails until someone moves it.
  for (const path of NOT_YET_TOKENISED) {
    const css = code(readFileSync(path, "utf8"));
    assert.ok(
      /#[0-9a-fA-F]{3,8}\b/.test(css) || /\b(rgba?|hsla?|oklch|lab|lch)\(/.test(css),
      `${path} no longer holds a literal colour — move it to CONSUMERS`,
    );
  }
});
