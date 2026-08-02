// Three schedulers spend the ceiling on requests in flight to ArenaNet — the
// chunk store and the patch client in the main process, the snapshot image
// reader in the renderer — and they import one declaration. This is the scan
// that keeps it one: a fourth const named for the same budget is what a reader
// would take for the ceiling and what a scheduler would then spend twice.
//
// The renderer's import is the fragile half, and its second test is here for
// that reason. `src/shared` reaches the renderer only through the named
// allowlist in src/main/protocol.ts; a value import of a module outside it
// typechecks, lints, passes every unit test, and 404s when the launcher runs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ARENANET_REQUEST_CEILING } from "../../src/shared/contracts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const OWNER = "src/shared/contracts.ts";

// Names such a ceiling plausibly takes, bound to the value it has. The name
// half is deliberately broad, because what this must catch is the constant
// someone declares next under whatever name reads naturally to them. The value
// half keeps an unrelated bound of some other size out of it: a second copy of
// *this* ceiling is 8, and a copy that is not 8 already disagrees with a
// scheduler test that pins the behaviour.
const CEILING_DECLARATION =
  /^\s*(?:export\s+)?const\s+([A-Za-z0-9_]*(?:JOBS|REQUESTS|CONCURRENCY|CEILING|PARALLEL)[A-Za-z0-9_]*)\s*=\s*8\s*;/gmu;

const sources = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter((file) => /^src\/.+\.(?:m|c)?ts$/u.test(file))
  .filter((file) => existsSync(path.join(root, file)));

const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("no second declaration of the ceiling exists", () => {
  const declarations = sources.flatMap((file) => {
    const text = read(file);
    return [...text.matchAll(CEILING_DECLARATION)].map((match) => ({
      file,
      name: match[1]!,
    }));
  });

  assert.deepEqual(
    declarations,
    [{ file: OWNER, name: "ARENANET_REQUEST_CEILING" }],
    "a second request ceiling was declared; the one above is the whole set",
  );
});

test("the renderer's scheduler can load the module that declares it", () => {
  const scheduler = read("src/renderer/image-source.ts");
  assert.match(
    scheduler,
    /^import \{\n\s*ARENANET_REQUEST_CEILING,/mu,
    "src/renderer/image-source.ts no longer imports the ceiling as a value",
  );

  const allowlist = /const RENDERER_SHARED_MODULES = new Set\(\[([^\]]*)\]\)/u
    .exec(read("src/main/protocol.ts"));
  assert.ok(allowlist, "src/main/protocol.ts no longer declares the allowlist");
  assert.ok(
    allowlist[1]!.includes('"contracts.js"'),
    "gw://app/shared/contracts.js is no longer served to the renderer",
  );
});

test("eight is what ArenaNet's shared infrastructure is owed", () => {
  // Conduct toward infrastructure every installation shares, so lowering it is
  // a decision and raising it is a defect.
  assert.equal(ARENANET_REQUEST_CEILING, 8);
});
