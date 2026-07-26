import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { PatchClient, type FetchLike } from "../../src/main/core/patch-client.js";
import {
  readPublishedClientManifest,
  verifyPublishedClientArtifacts,
} from "../../src/main/core/published-client.js";
import { AppError } from "../../src/shared/errors.js";

const CHUNK_SIZE = 64;
const PATCH_ROOT = "https://patch.invalid";
const SIZES = {
  "Gw.jspi.js": 96,
  "Gw.jspi.wasm": 128,
  "version.json": 16,
  "Gw.snapshot": 200,
} as const;

const scratchDirs: string[] = [];

after(async () => {
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gw-patch-client-"));
  scratchDirs.push(dir);
  return dir;
}

/** Deterministic pseudo-random bytes, so every chunk in a fixture is distinct. */
function fileContent(tag: string, size: number): Buffer {
  const out = Buffer.alloc(size);
  let block = createHash("md5").update(tag).digest();
  for (let i = 0; i < size; i++) {
    if (i > 0 && i % block.length === 0) block = createHash("md5").update(block).digest();
    out[i] = block[i % block.length]!;
  }
  return out;
}

interface Fixture {
  manifest: string;
  chunks: Map<string, Buffer>;
  contents: Record<string, Buffer>;
}

/**
 * A flat patch manifest with the three client artifacts and the snapshot.
 * `revision` changes only `Gw.jspi.js`, so a second update rebuilds that one
 * artifact and hard-links the other two out of the installed generation.
 */
function fixture(revision: number): Fixture {
  const chunks = new Map<string, Buffer>();
  const contents: Record<string, Buffer> = {};
  const files = Object.entries(SIZES).map(([name, size]) => {
    const content = fileContent(name === "Gw.jspi.js" ? `${name}#${revision}` : name, size);
    contents[name] = content;
    const chunkHashes: string[] = [];
    for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
      const part = content.subarray(offset, Math.min(offset + CHUNK_SIZE, size));
      const hash = createHash("md5").update(part).digest("hex");
      chunks.set(hash, Buffer.from(part));
      chunkHashes.push(hash);
    }
    return { name, size, chunkHashes };
  });
  return {
    manifest: JSON.stringify({ compressionMode: "none", chunkSize: CHUNK_SIZE, files }),
    chunks,
    contents,
  };
}

function serve(
  source: Fixture,
  onChunk?: (signal: AbortSignal | undefined) => Promise<void>,
): FetchLike {
  return async (url, init) => {
    if (url === `${PATCH_ROOT}/manifest.json`) {
      return { status: 200, body: new TextEncoder().encode(source.manifest) };
    }
    await onChunk?.(init?.signal);
    const chunk = source.chunks.get(url.slice(PATCH_ROOT.length + 1, -".bin".length));
    return chunk
      ? { status: 200, body: new Uint8Array(chunk) }
      : { status: 404, body: new Uint8Array() };
  };
}

interface Install {
  artifacts: string;
  chunks: string;
  client(
    source: Fixture,
    onChunk?: (signal: AbortSignal | undefined) => Promise<void>,
  ): PatchClient;
}

async function install(): Promise<Install> {
  const root = await scratch();
  const artifacts = join(root, "artifacts");
  const chunks = join(root, "chunks");
  return {
    artifacts,
    chunks,
    client: (source, onChunk) =>
      new PatchClient({
        artifactsDir: artifacts,
        chunksDir: chunks,
        patchRoot: PATCH_ROOT,
        fetch: serve(source, onChunk),
      }),
  };
}

async function installedVerifies(artifacts: string): Promise<boolean | null> {
  return verifyPublishedClientArtifacts(
    artifacts,
    await readPublishedClientManifest(join(artifacts, "manifest.json")),
  );
}

/**
 * A storage layer that loses bytes while reporting success: the write of
 * `target` into a file that already has content lands one byte short but still
 * returns `bytesWritten === length`. `writeAll` cannot see this — it was told
 * every byte landed — so the assembled artifact is silently truncated and then
 * durably committed. Only reading the stage back before the swap catches it.
 *
 * The `size > 0` guard keeps the fault on the artifact assembly loop: a chunk
 * published by `writeAtomicInDir` is written to a freshly created empty temp
 * file, an artifact chunk after the first is not.
 */
async function withLossyWrite<T>(
  target: Buffer,
  run: () => Promise<T>,
): Promise<{ result: PromiseSettledResult<T>; faults: number }> {
  const probe = await open(join(await scratch(), "probe"), "w");
  const proto = Object.getPrototypeOf(probe) as {
    write: (
      this: FileHandle,
      data: Uint8Array,
      offset: number,
      length: number,
    ) => Promise<{ bytesWritten: number }>;
  };
  await probe.close();
  const original = proto.write;
  let faults = 0;
  proto.write = async function lossy(
    this: FileHandle,
    data: Uint8Array,
    offset: number,
    length: number,
  ): Promise<{ bytesWritten: number }> {
    const matches =
      length === target.byteLength &&
      target.equals(Buffer.from(data.buffer, data.byteOffset + offset, length));
    if (matches && (await this.stat()).size > 0) {
      faults += 1;
      await original.call(this, data, offset, length - 1);
      return { bytesWritten: length };
    }
    return original.call(this, data, offset, length);
  };
  try {
    const [result] = await Promise.allSettled([run()]);
    return { result: result!, faults };
  } finally {
    proto.write = original;
  }
}

describe("patch-client update", () => {
  it("publishes a generation whose artifacts match the manifest beside them", async () => {
    const target = await install();
    const source = fixture(1);
    const result = await target.client(source).update();

    assert.equal(result.published, true);
    assert.equal(result.candidate, false);
    assert.equal(result.blocked, false);
    assert.equal(await installedVerifies(target.artifacts), true);
    for (const name of ["Gw.jspi.js", "Gw.jspi.wasm", "version.json"] as const) {
      assert.deepEqual(await readFile(join(target.artifacts, name)), source.contents[name]);
    }
    assert.equal(existsSync(`${target.artifacts}.next`), false);
    assert.equal(existsSync(`${target.artifacts}.previous`), false);
  });

  it("leaves an alpha-published generation installed instead of re-staging it", async () => {
    const target = await install();
    const source = fixture(1);
    await target.client(source).update();

    // Strip both markers, leaving the two documents exactly as v0.0.1-alpha.1
    // published them. This is the case that matters: the alpha's installed
    // client must keep running, not be re-staged behind a candidate flag.
    for (const name of ["manifest.json", "snapshot-metadata.json"]) {
      const file = join(target.artifacts, name);
      const { formatVersion, ...bare } = JSON.parse(
        await readFile(file, "utf8"),
      ) as Record<string, unknown>;
      assert.equal(formatVersion, 1, `${name} was published without a marker`);
      await writeFile(file, JSON.stringify(bare));
    }
    const installed = await readFile(join(target.artifacts, "Gw.jspi.js"));

    const result = await target.client(source).update();

    assert.equal(result.published, false, "an alpha generation was re-published");
    assert.equal(result.candidate, false);
    assert.equal(existsSync(`${target.artifacts}.previous`), false);
    assert.deepEqual(await readFile(join(target.artifacts, "Gw.jspi.js")), installed);
    // Nothing rewrote the bare documents either: read old, write new, and the
    // write only happens when there is something to publish.
    assert.equal(
      "formatVersion" in
        (JSON.parse(
          await readFile(join(target.artifacts, "manifest.json"), "utf8"),
        ) as Record<string, unknown>),
      false,
    );
  });

  it("republishes a snapshot index whose format it cannot read", async () => {
    const target = await install();
    const source = fixture(1);
    await target.client(source).update();

    const file = join(target.artifacts, "snapshot-metadata.json");
    const index = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...index, formatVersion: 2 }));

    const result = await target.client(source).update();

    assert.equal(result.published, true, "an unreadable index was trusted");
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), index);
    assert.equal(await installedVerifies(target.artifacts), true);
  });

  it("promotes nothing when assembly silently truncates an artifact", async () => {
    const target = await install();
    const source = fixture(1);
    // The tail chunk of Gw.jspi.js: the artifact loses its last byte.
    const tail = Buffer.from(source.contents["Gw.jspi.js"]!.subarray(CHUNK_SIZE));

    const { result, faults } = await withLossyWrite(tail, () => target.client(source).update());

    assert.equal(faults, 1, "the lossy write did not fire on the assembly loop");
    assert.equal(result.status, "rejected");
    const error = (result as PromiseRejectedResult).reason as AppError;
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "artifact_unverified");
    assert.equal(existsSync(target.artifacts), false, "a truncated generation was promoted");
    assert.equal(existsSync(`${target.artifacts}.next`), false);
  });

  it("keeps the installed generation when a staged artifact changes under it", async () => {
    const target = await install();
    const first = fixture(1);
    await target.client(first).update();

    // Gw.jspi.wasm is unchanged between revisions, so the update hard-links the
    // installed copy into the stage after checking it. Corrupt that copy once
    // the check is behind us: the pre-swap verification is the only thing left
    // that can notice.
    const second = fixture(2);
    const wasm = join(target.artifacts, "Gw.jspi.wasm");
    let corrupted = false;
    const client = target.client(second, async () => {
      if (corrupted) return;
      corrupted = true;
      const bytes = await readFile(wasm);
      bytes[0] ^= 0xff;
      await writeFile(wasm, bytes);
    });

    await assert.rejects(
      () => client.update(),
      (error: unknown) =>
        error instanceof AppError && error.code === "artifact_unverified",
    );
    assert.equal(corrupted, true, "the fault never ran");
    assert.deepEqual(
      await readFile(join(target.artifacts, "Gw.jspi.js")),
      first.contents["Gw.jspi.js"],
      "the installed generation was replaced by an unverified one",
    );
    assert.equal(existsSync(`${target.artifacts}.next`), false);
    assert.equal(existsSync(`${target.artifacts}.previous`), false);
  });

  it("aborts a slow preparation without moving the installed generation", async () => {
    const target = await install();
    const first = fixture(1);
    await target.client(first).update();
    const installed = await readFile(join(target.artifacts, "Gw.jspi.js"));

    let started!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const second = fixture(2);
    const controller = new AbortController();
    const client = target.client(second, async (signal) => {
      started();
      await new Promise<never>((_resolve, reject) => {
        const rejectAborted = () => reject(signal?.reason);
        if (signal?.aborted) {
          rejectAborted();
        } else {
          signal?.addEventListener("abort", rejectAborted, { once: true });
        }
      });
    });

    const update = client.update({ signal: controller.signal });
    await fetchStarted;
    const reason = new AppError(
      "download_stopped",
      "controlled test interruption",
    );
    controller.abort(reason);
    let deadline: ReturnType<typeof setTimeout>;
    const outcome = await Promise.race([
      update.then(
        () => "resolved" as const,
        (error: unknown) => error,
      ),
      new Promise<"timed-out">((resolve) => {
        deadline = setTimeout(() => resolve("timed-out"), 1_000);
      }),
    ]);
    clearTimeout(deadline!);

    assert.equal(outcome, reason);
    assert.deepEqual(
      await readFile(join(target.artifacts, "Gw.jspi.js")),
      installed,
    );
    assert.equal(existsSync(`${target.artifacts}.next`), false);
    assert.equal(existsSync(`${target.artifacts}.previous`), false);
  });

  it("still swaps in a verified replacement and keeps the rollback target", async () => {
    const target = await install();
    const first = fixture(1);
    await target.client(first).update();

    const second = fixture(2);
    const result = await target.client(second).update();

    assert.equal(result.published, true);
    assert.equal(result.candidate, true);
    assert.equal(await installedVerifies(target.artifacts), true);
    assert.deepEqual(
      await readFile(join(target.artifacts, "Gw.jspi.js")),
      second.contents["Gw.jspi.js"],
    );
    assert.equal(existsSync(join(target.artifacts, ".candidate.json")), true);
    assert.equal(
      await installedVerifies(`${target.artifacts}.previous`),
      true,
      "the rollback target must survive the swap",
    );
    assert.equal(existsSync(`${target.artifacts}.next`), false);
  });
});
