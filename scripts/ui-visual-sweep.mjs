// A visual sweep over the design system, for eyes rather than for CI.
//
// The unit test proves no component owns a colour. It cannot prove the result
// looks like one interface. This drives the gallery and the Tools workbench
// through the whole preference range a player can actually reach — the
// extremes and default of panel opacity — screenshots each, and reports any
// layout fault a machine can see: a surface
// that scrolls sideways, content clipped by its own container, a control
// shorter than the touch target, a panel corner the frame does not reach.
//
//   node scripts/ui-visual-sweep.mjs [--out DIR] [--url URL]
//
// Expects `pnpm --filter @gwonmac/tools-ui dev` on 127.0.0.1:4179.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** @typedef {{where: string, kind: string, element: string, detail: string}} Finding */

const args = process.argv.slice(2);
/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};

const outDir = path.resolve(flag("out", "/tmp/ui-sweep"));
const toolsUrl = flag("url", "http://127.0.0.1:4179/");
const galleryUrl = pathToFileURL(path.resolve("docs/ui-gallery.html")).href;

const OPACITIES = [
  { name: "minimum", value: 0.65 },
  { name: "default", value: 0.94 },
  { name: "opaque", value: 1 },
];

/**
 * Apply exactly what `src/renderer/appearance.ts` applies.
 * @param {import("@playwright/test").Page} page
 * @param {number} opacity
 */
async function applyAppearance(page, opacity) {
  await page.evaluate(
    (opacity) => {
      const root = document.documentElement;
      root.style.setProperty("--ui-panel-opacity", String(opacity));
      // The gallery draws its own controls; keep them honest so a screenshot
      // never captions itself with the values it is not showing.
      /** @type {{gwSyncGalleryControls?: () => void}} */ (
        /** @type {unknown} */ (window)
      ).gwSyncGalleryControls?.();
    },
    opacity,
  );
  await page.waitForTimeout(60);
}

/**
 * Faults a machine can see without knowing what the design should look like.
 * @param {import("@playwright/test").Page} page
 * @param {string} label
 * @returns {Promise<Finding[]>}
 */
async function audit(page, label) {
  return page.evaluate((label) => {
    /** @type {Finding[]} */
    const problems = [];
    const seen = new Set();
    /** @param {Element} el */
    const name = (el) => {
      const cls = [...el.classList].filter((c) => c.startsWith("ui-") || c.length < 24);
      return `${el.tagName.toLowerCase()}${cls.length ? `.${cls.join(".")}` : ""}`;
    };
    /** @param {Element} el */
    const hasScrollingDescendant = (el) =>
      [...el.querySelectorAll("*")].some((/** @type {Element} */ child) => {
        const overflow = getComputedStyle(child).overflowY;
        return (
          ["auto", "scroll"].includes(overflow)
          && child.scrollHeight - child.clientHeight > 1
        );
      });
    /** @param {string} kind @param {Element} el @param {string} detail */
    const note = (kind, el, detail) => {
      const key = `${kind}|${name(el)}|${detail}`;
      if (seen.has(key)) return;
      seen.add(key);
      problems.push({ where: label, kind, element: name(el), detail });
    };

    for (const el of document.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) continue;

      // Sideways scroll is never intentional in this product: every pane is a
      // column of full-width things.
      if (
        el.scrollWidth - el.clientWidth > 1
        && ["auto", "scroll"].includes(style.overflowX)
      ) {
        note("scrolls-sideways", el, `${el.scrollWidth} > ${el.clientWidth}`);
      }

      // Content taller than a container that hides the excess: a filter row
      // cut in half reads as a rendering fault, not as a boundary.
      //
      // Two things are not that. Clipping is the entire job of a
      // visually-hidden label. And a container that delegates scrolling to a
      // descendant still reports that descendant's overflow as its own
      // `scrollHeight`, so a correctly-built panel with a scrolling body would
      // otherwise be reported as clipping every time its body had content.
      if (
        style.overflowY === "hidden"
        && el.scrollHeight - el.clientHeight > 1
        && el.clientHeight > 0
        && !el.classList.contains("ui-sr-only")
        && !hasScrollingDescendant(el)
      ) {
        note("clips-content", el, `${el.scrollHeight} > ${el.clientHeight}`);
      }

      // A themed surface must never fall back to the UA's transparent default
      // and show whatever is behind it raw.
      if (
        el.classList.contains("ui-frame")
        && style.backgroundColor === "rgba(0, 0, 0, 0)"
        && !style.backgroundImage.includes("gradient")
      ) {
        note("no-fill", el, "frame has no background");
      }
    }

    // Every interactive control carries a usable hit target.
    for (const el of document.querySelectorAll(
      ".ui-button, .ui-tab, .ui-segment label, .ui-segment button, .ui-rail button, .ui-chip",
    )) {
      const box = el.getBoundingClientRect();
      if (box.height > 0 && box.height < 18) {
        note("tiny-target", el, `${Math.round(box.height)}px tall`);
      }
    }

    // The frame ring has to exist wherever a panel claims one.
    for (const el of document.querySelectorAll(".ui-frame")) {
      const ring = getComputedStyle(el, "::after");
      if (ring.content === "none") note("no-ring", el, "::after missing");
    }

    if (document.scrollingElement) {
      const doc = document.scrollingElement;
      if (doc.scrollWidth - doc.clientWidth > 1) {
        problems.push({
          where: label,
          kind: "page-scrolls-sideways",
          element: "document",
          detail: `${doc.scrollWidth} > ${doc.clientWidth}`,
        });
      }
    }
    return problems;
  }, label);
}

const browser = await chromium.launch();
/** @type {Finding[]} */
const findings = [];

/**
 * @param {string} pageUrl
 * @param {string} tag
 * @param {(page: import("@playwright/test").Page) => Promise<void>} [prepare]
 */
async function sweep(pageUrl, tag, prepare) {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1000 },
    colorScheme: "dark",
  });
  await page.goto(pageUrl, { waitUntil: "networkidle" });
  if (prepare) await prepare(page);

  for (const opacity of OPACITIES) {
    await applyAppearance(page, opacity.value);
    const label = `${tag}/${opacity.name}`;
    findings.push(...(await audit(page, label)));
    await page.screenshot({
      path: path.join(outDir, `${label.replaceAll("/", "__")}.png`),
      fullPage: false,
    });
  }
  await page.close();
}

await mkdir(outDir, { recursive: true });
await sweep(galleryUrl, "gallery");
await sweep(toolsUrl, "tools", async (page) => {
  await page.waitForSelector("#app[data-ready=true]", { timeout: 15_000 });
});
await sweep(toolsUrl, "tools-build", async (page) => {
  await page.waitForSelector("#app[data-ready=true]", { timeout: 15_000 });
  await page.getByRole("tab", { name: /Builds/ }).click();
  await page.getByRole("button", { name: /Word of Healing.*Mo\/Me/ }).first().click();
});

await browser.close();
await writeFile(
  path.join(outDir, "findings.json"),
  `${JSON.stringify(findings, null, 2)}\n`,
);

const byKind = new Map();
for (const problem of findings) {
  byKind.set(problem.kind, (byKind.get(problem.kind) ?? 0) + 1);
}
console.log(`screenshots + findings -> ${outDir}`);
if (!findings.length) console.log("no layout faults found");
for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind}: ${count}`);
  for (const problem of findings.filter((p) => p.kind === kind).slice(0, 6)) {
    console.log(`    ${problem.where}  ${problem.element}  ${problem.detail}`);
  }
}
process.exitCode = findings.length ? 1 : 0;
