import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cartographyReachabilityKernelRustcArgs } from "./build.mjs";
import { validateCartographyReachabilityKernelContract } from
  "./cartography-reachability-kernel-contract.mjs";
import {
  ARTIFACT,
  LOADER,
  reachabilitySha256,
  verifySealedReachabilityLoader,
} from
  "./seal-cartography-reachability-kernel.mjs";

const artifact = readFileSync(ARTIFACT);
validateCartographyReachabilityKernelContract(artifact);
const digest = reachabilitySha256(artifact);
const loader = readFileSync(LOADER, "utf8");
verifySealedReachabilityLoader(loader, digest);

const scratch = mkdtempSync(path.join(tmpdir(), "gw-reachability-kernel-"));
try {
  const rebuilt = path.join(scratch, "kernel.wasm");
  const result = spawnSync("rustc", cartographyReachabilityKernelRustcArgs(rebuilt), {
    stdio: "inherit",
  });
  assert.equal(result.status, 0, "reachability kernel rebuild failed");
  const rebuiltBytes = readFileSync(rebuilt);
  validateCartographyReachabilityKernelContract(rebuiltBytes);
  assert.deepEqual(rebuiltBytes, artifact, "reachability kernel is not reproducible");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`verified Cartography reachability kernel ${digest}`);
