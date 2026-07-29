// Reads the product and roadmap documents, and says so in its filename.
//
// Cross-platform work used to be forbidden by PRODUCT.md while its
// implementation plan asked agents to build it. That contradiction is a
// repository-policy failure: an agent following the nearer product document
// would correctly refuse the plan. These assertions keep one approved
// direction while also preventing roadmap targets from being advertised as
// current downloads before their executable gates exist.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("the product approves the multi-OS direction without claiming it already ships", () => {
  const product = read("PRODUCT.md");
  const readme = read("README.md");

  assert.match(
    product,
    /Windows 11 x64 and Ubuntu 24\.04 x64\s+are approved targets/,
  );
  assert.match(product, /public product is currently macOS-only/);
  assert.doesNotMatch(product, /\*\*No Windows or Linux build\.\*\*/);

  assert.match(readme, /current downloadable product is still the Apple Silicon macOS/);
  assert.match(readme, /not\s+yet supported downloads/);
  assert.doesNotMatch(readme, /Download for Windows|Download for Linux/);
});

test("profiles never weaken the permanent account and input refusals", () => {
  const product = read("PRODUCT.md");
  const agents = read("AGENTS.md");

  assert.match(product, /\*\*No automation, ever\.\*\*/);
  assert.match(product, /\*\*No credential catalog\.\*\*/);
  assert.match(product, /\*\*No input broadcasting or multibox automation\.\*\*/);
  assert.match(product, /One physical input reaches one focused\s+game window/);
  assert.match(agents, /A renderer never selects its profile identity/);
  assert.match(agents, /Input broadcasting,[\s\S]*packaged automation remain forbidden/);
});

test("future support claims remain behind named executable gates", () => {
  const internals = read("docs/internals.md");
  const specification = read("plans/multi-os/spec.md");

  assert.match(internals, /Approved multi-OS claims that are not public yet/);
  assert.match(internals, /Windows 11 x64 is supported[\s\S]*MOS-B01/);
  assert.match(internals, /Two profiles can run independently[\s\S]*MOS-S02/);
  for (const acceptance of [
    "MOS-B01",
    "MOS-B02",
    "MOS-C01",
    "MOS-R01",
    "MOS-S02",
    "MOS-F02",
  ]) {
    assert.match(specification, new RegExp(`\\| ${acceptance} \\|`));
  }
});
