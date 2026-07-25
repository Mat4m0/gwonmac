import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

rmSync("build", { recursive: true, force: true });

for (const [command, args] of [
  [process.execPath, ["node_modules/typescript/bin/tsc"]],
  [
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.renderer.json"],
  ],
  [process.execPath, ["scripts/copy-renderer.mjs"]],
]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
