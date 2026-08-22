import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const run = promisify(execFile);
const root = process.cwd();

test(
  "the texture decoder refuses unsafe dimensions before decompression",
  { skip: process.platform !== "darwin" },
  async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "gwonmac-atex-test-"));
    const executable = path.join(temporary, "gw-dat-dimensions");
    try {
      await run(
        "xcrun",
        [
          "clang++",
          "-std=c++20",
          "-fsanitize=address,undefined",
          "-fno-omit-frame-pointer",
          "-D__int64=long long",
          "-Wno-multichar",
          "-Isrc/native/gw-dat",
          "tests/native/gw-dat-dimensions.cpp",
          "src/native/gw-dat/vendor/gwdat/AtexReader.cpp",
          "-o",
          executable,
        ],
        { cwd: root },
      );
      const result = await run(executable);
      assert.equal(result.stderr, "");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
