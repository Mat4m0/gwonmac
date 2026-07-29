// Pause a real writer after its temporary file has been flushed and before
// rename. The parent uses a platform-native termination helper; the child does
// not assume that SIGKILL exists.
import { open, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { writeAtomic } from "../../src/main/core/atomic-file.js";

const [target, ready] = process.argv.slice(2);
if (!target || !ready) throw new Error("target and ready paths are required");

const probe = await open(target, "r");
const proto = Object.getPrototypeOf(probe) as {
  sync: (this: FileHandle) => Promise<void>;
};
await probe.close();
const original = proto.sync;
proto.sync = async function pauseAfterSync(this: FileHandle): Promise<void> {
  await original.call(this);
  if ((await this.stat()).isFile()) {
    await writeFile(ready, "ready");
    await new Promise<never>(() => undefined);
  }
};

await writeAtomic(target, '{"replacement":true}');
