import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });

test("Tools features consume Reka behavior through the shared Vue UI layer", () => {
  const offenders = walk("apps/tools/src")
    .filter((file) => /\.(?:ts|vue)$/u.test(file))
    .filter((file) => !file.startsWith(path.join("apps/tools/src", "ui") + path.sep))
    .filter((file) => /from\s+["']reka-ui["']/u.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("feature styles cannot reintroduce the retired selection recipes", () => {
  const forbidden = [
    "--ui-selected",
    "--ui-row-fill",
    "--ui-shadow-row-selected",
  ];
  const offenders: string[] = [];
  for (const file of walk("apps/tools/src").filter((entry) => entry.endsWith(".css"))) {
    const source = readFileSync(file, "utf8");
    for (const token of forbidden) {
      if (source.includes(token)) offenders.push(`${file}: ${token}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("shared motion transitions only transform or opacity", () => {
  const sources = [
    "src/shared/ui/components.css",
    ...walk("apps/tools/src").filter((entry) => entry.endsWith(".css")),
  ];
  const offenders: string[] = [];
  for (const file of sources) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
    for (const match of css.matchAll(/transition\s*:\s*([^;]+);/gu)) {
      const declaration = match[1]!;
      const properties = declaration
        .replace(/(?:cubic-bezier|linear)\([^)]*\)/gu, "easing")
        .split(",")
        .map((part) => part.trim().split(/\s+/u)[0]);
      if (properties.some((property) => property !== "transform" && property !== "opacity" && property !== "none")) {
        offenders.push(`${file}: transition: ${declaration.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("the single-weight Guild Wars face is never synthetically emboldened", () => {
  const css = readFileSync("src/shared/ui/tokens.css", "utf8");
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/u)?.[1] ?? "";
  assert.match(root, /font-synthesis-weight:\s*none;/u);
  assert.match(root, /--ui-font-weight-medium:\s*400;/u);
  assert.match(root, /--ui-font-weight-semibold:\s*400;/u);
  assert.match(root, /--ui-font-weight-bold:\s*400;/u);
  assert.doesNotMatch(css, /font-synthesis-weight:\s*auto;/u);
});

// The launcher shell outside Settings, which keeps the --settings-* set it shares with the game's Hub.
const launcherShellStyles = () => [
  "apps/launcher/src/style.css",
  ...walk("apps/launcher/src")
    .filter((file) => file.endsWith(".vue") && !/Settings|Preview|Control/u.test(path.basename(file))),
].map((file) => {
  const source = readFileSync(file, "utf8");
  const css = file.endsWith(".vue") ? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gu)].map((match) => match[1]).join("\n") : source;
  return { file, css: css.replace(/\/\*[\s\S]*?\*\//gu, "") };
});

test("launcher shell colours come only from the design tokens in :root", () => {
  const offenders = launcherShellStyles().flatMap(({ file, css }) =>
    [...css.replace(/:root\s*\{[^}]*\}/gu, "").matchAll(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/giu)]
      .map((match) => `${file}: ${match[0]}`));
  assert.deepEqual(offenders, []);
});

test("every custom property the launcher shell reads is defined", () => {
  const defined = new Set(["apps/launcher/src/style.css", "apps/launcher/src/settings-view.css"]
    .flatMap((file) => [...readFileSync(file, "utf8").matchAll(/(--[\w-]+)\s*:/gu)].map((match) => match[1])));
  const offenders = launcherShellStyles().flatMap(({ file, css }) =>
    [...css.matchAll(/var\((--[\w-]+)/gu)].map((match) => match[1]!).filter((name) => !defined.has(name)).map((name) => `${file}: ${name}`));
  assert.deepEqual(offenders, []);
});
