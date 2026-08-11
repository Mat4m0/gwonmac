// Fault injection for the orphan sweep. Run as a child process by
// tests/unit/atomic-file.test.ts: publish a document with `writeAtomic`, then
// SIGKILL this process from inside the temp file's `fsync` — after every byte
// is durable and before `rename` can promote it. That is the exact instant a
// crash leaves an orphan, and killing for real is the only way to prove what
// `writeAtomic` actually leaves on disk rather than assuming its temp-file
// naming.
//
// argv[2] is the target path. Its parent directory must already exist; the
// directory handle is opened only to reach `FileHandle.prototype`.
import { open, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { writeAtomic } from "../../src/main/core/atomic-file.js";

const target = process.argv[2];
if (target === undefined) {
  throw new Error("usage: kill-mid-atomic-write <target path>");
}

const probe = await open(dirname(target), "r");
// `Object.getPrototypeOf` returns `any`; the annotation is what recovers the
// method signatures this patch has to preserve.
const handlePrototype: FileHandle = Object.getPrototypeOf(probe);
await probe.close();

const realSync = handlePrototype.sync;
handlePrototype.sync = async function killAfterTheTempFileIsDurable(
  this: FileHandle,
) {
  await realSync.call(this);
  process.kill(process.pid, "SIGKILL");
  // SIGKILL cannot be observed, but it is not instantaneous either; never
  // resolve, so nothing can reach the rename if the signal is slow to land.
  await new Promise(() => {});
};

await writeAtomic(target, "the replacement that never arrives");
