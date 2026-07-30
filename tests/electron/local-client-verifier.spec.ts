import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";

const fixture = fileURLToPath(
  new URL("./fixtures/local-verifier-app", import.meta.url),
);
const electronPath = path.resolve(
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);

test("isolates an unknown client decision and reuses its exact-hash cache", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gw-local-verifier-"));
  const wasmPath = path.join(root, "unknown.wasm");
  const cachePath = path.join(root, "verification.json");
  // The smallest valid module has none of the certified shapes. That is useful:
  // the IPC path must return a safe negative decision rather than crash.
  const wasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  const sha256 = createHash("sha256").update(wasm).digest("hex");
  await writeFile(wasmPath, wasm);

  const run = async () => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") {
        env[key] = value;
      }
    }
    const application = await electron.launch({
      cwd: path.resolve("."),
      args: [fixture, wasmPath, cachePath, sha256],
      executablePath: electronPath,
      env,
    });
    try {
      await expect.poll(
        () => outcome(application),
        { timeout: 10_000 },
      ).not.toBeNull();
      return await outcome(application);
    } finally {
      await application.close();
    }
  };

  try {
    const first = await run();
    expect(first).toMatchObject({
      source: "process",
      result: {
        officialSha256: sha256,
        templateSaveBuild: null,
        enhancementBuild: null,
        reasons: ["template-shape-changed"],
      },
    });
    expect((await stat(cachePath)).mode & 0o777).toBe(0o600);

    const second = await run();
    expect(second).toMatchObject({
      source: "cache",
      result: { officialSha256: sha256 },
    });
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toHaveProperty(
      "checksum",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function outcome(application: ElectronApplication): Promise<unknown> {
  return application.evaluate(
    () => (
      globalThis as typeof globalThis & {
        localVerifierOutcome?: unknown;
      }
    ).localVerifierOutcome ?? null,
  );
}
