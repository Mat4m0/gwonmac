import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const EXACT_FAST_PATHS = new Set([
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/dependabot.yml",
  ".github/workflows/vercel-preview.yml",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "PRODUCT.md",
  "README.md",
  "SECURITY.md",
  "tests/website-smoke.ts",
]);

const EXACT_WEBSITE_PATHS = new Set([
  ".github/workflows/pr-package.yml",
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/ci-impact.ts",
  "scripts/ts-hook.mjs",
  "scripts/ts-resolve.mjs",
  "src/shared/project-identity.ts",
  "src/shared/release.ts",
  "tests/unit/ci-impact.test.ts",
  "tests/helpers/child-process.ts",
  "tests/website-smoke.ts",
]);

const WEBSITE_MANIFESTS = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

function isWellFormedRepositoryPath(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function isFastOnlyPath(path: string): boolean {
  if (EXACT_FAST_PATHS.has(path)) return true;
  if (path.startsWith("docs/")) return true;
  if (path.startsWith(".github/ISSUE_TEMPLATE/")) return true;

  if (path.startsWith("apps/website/")) {
    const basename = path.slice(path.lastIndexOf("/") + 1);
    return !WEBSITE_MANIFESTS.has(basename);
  }

  return false;
}

/** True unless every changed path is proved independent of the desktop app. */
export function requiresRuntimeVerification(paths: readonly string[]): boolean {
  return (
    paths.length === 0 ||
    paths.some(
      (path) => !isWellFormedRepositoryPath(path) || !isFastOnlyPath(path),
    )
  );
}

/** True when the changed paths can affect the separately built website. */
export function requiresWebsiteVerification(paths: readonly string[]): boolean {
  return paths.some(
    (path) =>
      !isWellFormedRepositoryPath(path)
      || EXACT_WEBSITE_PATHS.has(path)
      || path.startsWith("apps/website/"),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = readFileSync(0, "utf8").split("\0").filter(Boolean);
  process.stdout.write(
    `runtime=${requiresRuntimeVerification(paths)}\n`
    + `website=${requiresWebsiteVerification(paths)}\n`,
  );
}
