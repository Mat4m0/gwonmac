import assert from "node:assert/strict";
import test from "node:test";
import { requiresRuntimeVerification } from "../../scripts/ci-impact.ts";

test("proved documentation and website-only changes use the fast gate", () => {
  const fastPaths = [
    "README.md",
    "docs/release-verification.md",
    ".github/ISSUE_TEMPLATE/bug.yml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/dependabot.yml",
    ".github/workflows/website.yml",
    ".github/workflows/vercel-preview.yml",
    "apps/website/app.vue",
    "apps/website/server/api/releases/latest.get.ts",
    "tests/website-smoke.ts",
  ];

  for (const path of fastPaths) {
    assert.equal(requiresRuntimeVerification([path]), false, path);
  }
  assert.equal(requiresRuntimeVerification(fastPaths), false);
});

test("runtime, packaging, dependency, and unknown changes use the full gate", () => {
  const runtimePaths = [
    "src/main/main.ts",
    "src/shared/release.ts",
    "apps/tools/src/host.ts",
    "src/companion-kernel/abi.rs",
    "tests/electron/app.spec.ts",
    "package.json",
    "pnpm-lock.yaml",
    "apps/website/package.json",
    "forge.config.ts",
    "scripts/build.mjs",
    ".github/workflows/macos-verify.yml",
    ".github/workflows/pr-package.yml",
    ".github/workflows/release.yml",
    ".github/workflows/client-recertification.yml",
    "LICENSE",
    "THIRD-PARTY-NOTICES.md",
    "unknown-root-file.txt",
  ];

  assert.equal(requiresRuntimeVerification([]), true);
  for (const path of runtimePaths) {
    assert.equal(requiresRuntimeVerification([path]), true, path);
  }
  assert.equal(
    requiresRuntimeVerification(["docs/user-guide.md", "src/main/main.ts"]),
    true,
  );
});

test("malformed paths fail closed", () => {
  for (const path of [
    "/absolute.md",
    "docs\\windows.md",
    "docs/../src/main.ts",
    "docs//guide.md",
    "./README.md",
  ]) {
    assert.equal(requiresRuntimeVerification([path]), true, path);
  }
});
