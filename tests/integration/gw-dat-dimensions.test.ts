import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { nativeExecutableName } from "../../src/main/core/paths.js";

const run = promisify(execFile);
const root = process.cwd();
const MAX_COMPRESSED_BYTES = 1024 * 1024;

test(
  "the archive decoder refuses oversized stdin without waiting for EOF",
  async () => {
    const decoder = spawn(path.join(
      root,
      "build/native",
      nativeExecutableName("gw-dat-decode", process.platform),
    ), [], {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    // The expected early exit can close the pipe while Node still has bytes
    // buffered. The process exit below is the assertion this test owns.
    decoder.stdin.on("error", () => undefined);
    decoder.stdin.write(Buffer.alloc(MAX_COMPRESSED_BYTES + 1));

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const [code, signal] = await Promise.race([
        once(decoder, "close"),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            decoder.kill();
            reject(new Error("the archive decoder waited for stdin EOF"));
          }, 2_000);
        }),
      ]);
      assert.equal(signal, null);
      assert.equal(code, 2);
    } finally {
      clearTimeout(timer);
      if (decoder.exitCode === null && decoder.signalCode === null) decoder.kill();
    }
  },
);

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
