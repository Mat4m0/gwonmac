import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("the Secret portal helper is an x86_64 Linux build");
}

const flags = spawnSync("pkg-config", ["--cflags", "--libs", "gio-unix-2.0"], {
  encoding: "utf8",
});
if (flags.status !== 0) {
  throw new Error(flags.stderr || "gio-unix-2.0 development files are required");
}
mkdirSync("build/native", { recursive: true });
const result = spawnSync("c++", [
  "-std=c++20",
  "-O2",
  "-fPIE",
  "-pie",
  "-fstack-protector-strong",
  "-D_FORTIFY_SOURCE=3",
  "-Wall",
  "-Wextra",
  "-Werror",
  "src/native/linux-secret-portal/main.cpp",
  "-o",
  "build/native/gw-secret-portal",
  ...flags.stdout.trim().split(/\s+/u),
  "-Wl,-z,relro,-z,now",
], { stdio: "inherit" });
if (result.status !== 0) throw new Error("Secret portal helper build failed");
