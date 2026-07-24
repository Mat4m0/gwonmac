import { rmSync } from "node:fs";

rmSync(new URL("../out", import.meta.url), {
  recursive: true,
  force: true,
});
