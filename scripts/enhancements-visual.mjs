import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const fixture = process.argv.slice(2).find((value) => value !== "--") ?? "target";
if (!["map", "target"].includes(fixture)) {
  console.error(`unknown Enhancement visual fixture: ${fixture}`);
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "test-results", "enhancements-visual");
const output = path.join(outputDir, `${fixture}.png`);
const fixtureUrl = new URL(
  `?fixture=${fixture}`,
  pathToFileURL(path.join(root, "scripts", "enhancements-visual", "index.html")),
);

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 720, height: 480 },
    deviceScaleFactor: 2,
  });
  await page.goto(fixtureUrl.href);
  await page.locator("body[data-ready='true']").waitFor();
  await page.locator("#enhancement").screenshot({ path: output });
  console.log(JSON.stringify({ fixture, screenshot: output }));
} finally {
  await browser.close();
}
