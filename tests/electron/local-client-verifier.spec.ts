import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("re-verifies an unknown exact hash in an isolated process", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gw-local-verifier-"));
  const wasmPath = path.join(root, "unknown.wasm");
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
      args: [fixture, "client", wasmPath, sha256],
      executablePath: electronPath,
      env,
    });
    try {
      await expect.poll(
        () => completed(application),
        { timeout: 10_000 },
      ).toBe(true);
      return await outcome(application);
    } finally {
      await application.close();
    }
  };

  try {
    const first = await run();
    expect(first).toMatchObject({
      officialSha256: sha256,
      fileVerdict: {
        status: "refused",
        inputSha256: sha256,
        reason: "template-shape-changed",
      },
      templateSaveBuild: null,
      enhancementBuild: null,
      reasons: ["enhancement-layout-changed"],
    });

    // A second launch must re-read the bytes. Profile state cannot preserve the
    // first positive answer after the official artifact no longer matches.
    await writeFile(wasmPath, Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 1));
    const second = await run();
    expect(second).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses an unknown native callback inside the isolated process", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gw-double-click-verifier-"));
  const wasmPath = path.join(root, "unknown.wasm");
  const wasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  const sha256 = createHash("sha256").update(wasm).digest("hex");
  await writeFile(wasmPath, wasm);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
    ),
  );
  const application = await electron.launch({
    cwd: path.resolve("."),
    args: [fixture, "native-double-click", wasmPath, sha256],
    executablePath: electronPath,
    env,
  });
  try {
    await expect.poll(() => completed(application), { timeout: 10_000 }).toBe(true);
    expect(await outcome(application)).toBeNull();
  } finally {
    await application.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses changed 4 GB glue inside the isolated process", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gw-extended-memory-verifier-"));
  const jsPath = path.join(root, "Gw.jspi.js");
  const wasmPath = path.join(root, "Gw.jspi.wasm");
  const js = "var getHeapMax = () => 2147483648;";
  const wasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  const digest = (value: Uint8Array | string) =>
    createHash("sha256").update(value).digest("hex");
  await Promise.all([writeFile(jsPath, js), writeFile(wasmPath, wasm)]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
    ),
  );
  const application = await electron.launch({
    cwd: path.resolve("."),
    args: [
      fixture,
      "extended-memory",
      jsPath,
      digest(js),
      wasmPath,
      digest(wasm),
    ],
    executablePath: electronPath,
    env,
  });
  try {
    await expect.poll(() => completed(application), { timeout: 10_000 }).toBe(true);
    expect(await outcome(application)).toBeNull();
  } finally {
    await application.close();
    await rm(root, { recursive: true, force: true });
  }
});

function completed(application: ElectronApplication): Promise<boolean> {
  return application.evaluate(
    () => Boolean(
      (
        globalThis as typeof globalThis & {
          localVerifierCompleted?: boolean;
        }
      ).localVerifierCompleted,
    ),
  );
}

function outcome(application: ElectronApplication): Promise<unknown> {
  return application.evaluate(
    () => (
      globalThis as typeof globalThis & {
        localVerifierOutcome?: unknown;
      }
    ).localVerifierOutcome ?? null,
  );
}
