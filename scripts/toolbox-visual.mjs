import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const fixture = process.argv.slice(2).find((value) => value !== "--") ?? "target";
if (!["map", "target"].includes(fixture)) {
  console.error(`unknown Toolbox visual fixture: ${fixture}`);
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "test-results", "toolbox-visual");
const output = path.join(outputDir, `${fixture}.png`);
const profile = await mkdtemp(path.join(tmpdir(), "gw-toolbox-visual-"));
const env = {
  ...process.env,
  GW_OFFLINE_SHELL: "1",
  GW_TOOLBOX_FIXTURE: fixture,
};
delete env.ELECTRON_RUN_AS_NODE;

let app;
try {
  app = await electron.launch({
    cwd: root,
    args: [".", `--user-data-dir=${profile}`],
    env,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(
    () => window.gwToolboxState?.status === "ready",
  );
  await page.waitForTimeout(800);
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path: output });
  console.log(JSON.stringify({ fixture, screenshot: output }));
} finally {
  await app?.close().catch(() => undefined);
  await rm(profile, { recursive: true, force: true });
}
