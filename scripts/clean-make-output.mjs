import { rmSync } from "node:fs";

rmSync(new URL("../out/make", import.meta.url), {
  recursive: true,
  force: true,
});
