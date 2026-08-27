/** Repository policy for the signed release and static update-feed workflows. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
type Manifest = { scripts?: Record<string, string> };
const json = (file: string): Manifest => JSON.parse(read(file));
const script = (name: string): string => {
  const command = json("package.json").scripts?.[name];
  assert.ok(typeof command === "string", `package.json defines no ${name} script`);
  return command;
};

test("release workflow stages and publishes one tested, attested package version", () => {
  const workflow = read(".github/workflows/release.yml");
  const feedWorkflow = read(".github/workflows/update-feeds.yml");
  const verification = read(".github/workflows/macos-verify.yml");
  assert.match(workflow, /uses: \.\/\.github\/workflows\/macos-verify\.yml/);
  assert.match(
    workflow,
    /source:[\s\S]*outputs:[\s\S]*steps\.release-source\.outputs\.version[\s\S]*name: Resolve and validate the release source[\s\S]*SOURCE_BRANCH: \$\{\{ github\.ref_name \}\}[\s\S]*SOURCE_TYPE: \$\{\{ github\.ref_type \}\}[\s\S]*\^release\/\[0-9\]\{4\}/,
  );
  assert.match(workflow, /verify:\n {4}needs: source/);
  assert.match(workflow, /release-build:\n {4}needs: \[source, verify\]/);
  assert.match(verification, /runs-on: macos-15/);
  assert.match(verification, /test "\$\(uname -m\)" = "arm64"/);
  assert.match(workflow, /test "\$\(uname -m\)" = "arm64"/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
  assert.match(
    workflow,
    /release_line="\$\{version%%-\*\}"[\s\S]*\$SOURCE_BRANCH" == release\/\*[\s\S]*\$\{SOURCE_BRANCH#release\/\}" != "\$release_line"[\s\S]*does not match package version/,
  );
  assert.match(
    workflow,
    /release-build:[\s\S]*bundle-version: \$\{\{ needs\.source\.outputs\.bundle-version \}\}[\s\S]*version: \$\{\{ needs\.source\.outputs\.version \}\}/,
  );
  assert.match(workflow, /git\/ref\/tags\/\$TAG/);
  assert.match(
    workflow,
    /name: Refuse a version that already shipped[\s\S]*?already published; bump the version in package\.json[\s\S]*?- run: pnpm install --frozen-lockfile/,
  );
  assert.doesNotMatch(workflow, /pnpm version|date -u/);
  assert.match(
    workflow,
    /name: Smoke-test signed release candidate[\s\S]*?GW_PACKAGE_INTENT: release[\s\S]*?run: \|[\s\S]*?pnpm test:packaged[\s\S]*?tests\/client-artifact\/client-chain-qualification\.test\.ts/,
  );
  assert.doesNotMatch(
    read("tests/packaged-smoke.ts"),
    /forge\.config/,
    "post-signing smoke must not reload credential-bearing packaging config",
  );
  assert.match(
    workflow,
    /name: Prove signed Data Protection Keychain continuity without signing secrets[\s\S]*?GW_SIGNED_APP_PATH: \$\{\{ steps\.assets\.outputs\.app \}\}[\s\S]*?GW_SIGNED_REPLACEMENT_APP_PATH: \$\{\{ steps\.runtime-fixture\.outputs\.replacement \}\}[\s\S]*?run: pnpm test:signed-keychain/,
  );
  assert.match(
    json("package.json").scripts?.["test:signed-keychain"] ?? "",
    /tests\/signed-keychain-runtime\.ts/,
  );
  assert.match(workflow, /shasum -a 256 -c SHA256SUMS\.txt/);
  assert.match(workflow, /anchore\/sbom-action@/);
  assert.match(workflow, /format: spdx-json/);
  assert.match(workflow, /actions\/attest@/);
  assert.match(
    workflow,
    /id: release-state[\s\S]*echo "sbom=\$sbom" >> "\$GITHUB_OUTPUT"/,
  );
  assert.match(
    workflow,
    /sbom-path: \$\{\{ steps\.release-state\.outputs\.sbom \}\}/,
  );
  assert.doesNotMatch(workflow, /sbom-path: [^\n]*\*/);
  assert.match(workflow, /artifact-metadata: write/);
  assert.match(verification, /actions\/dependency-review-action@/);
  assert.ok(
    verification.indexOf("actions/dependency-review-action@") <
      verification.indexOf("pnpm install --frozen-lockfile"),
  );
  assert.match(verification, /run: pnpm audit --audit-level=high/);
  const releaseBuild = workflow.slice(
    workflow.indexOf("  release-build:"),
    workflow.indexOf("\n  stage-release:"),
  );
  const releaseStage = workflow.slice(
    workflow.indexOf("\n  stage-release:"),
    workflow.indexOf("\n  release:"),
  );
  const releasePublish = workflow.slice(
    workflow.indexOf("\n  release:"),
    workflow.indexOf("\n  publish-update-feeds:"),
  );
  const updateFeedCall = workflow.slice(
    workflow.indexOf("\n  publish-update-feeds:"),
  );
  const updateFeedBuild = feedWorkflow.slice(
    feedWorkflow.indexOf("\n  build:"),
    feedWorkflow.indexOf("\n  deploy:"),
  );
  const updateFeedDeploy = feedWorkflow.slice(
    feedWorkflow.indexOf("\n  deploy:"),
  );
  assert.match(releaseBuild, /permissions:[\s\S]{0,80}contents: read/);
  assert.match(
    releaseBuild,
    /name: Download the current ArenaNet client generation[\s\S]*pnpm client:official --download/,
  );
  assert.match(
    releaseBuild,
    /name: Qualify the exact ArenaNet client before packaging[\s\S]*certification\.js verify[\s\S]*certification\.js double-click[\s\S]*pnpm test:client-artifact[\s\S]*pnpm memory:qualify:4gb/,
  );
  assert.ok(
    releaseBuild.indexOf("Qualify the exact ArenaNet client before packaging")
      < releaseBuild.indexOf("Build, sign, notarize, and staple application"),
  );
  assert.match(
    releaseBuild,
    /name: Refuse a client generation that changed during qualification[\s\S]*test "\$current" = "\$QUALIFIED_GENERATION"/,
  );
  assert.doesNotMatch(releaseBuild, /id-token: write|contents: write/);
  assert.match(releaseBuild, /actions\/upload-artifact@/);
  assert.match(releaseStage, /actions\/download-artifact@/);
  assert.match(
    releaseBuild,
    /release-assets-name: \$\{\{ steps\.release-artifact\.outputs\.name \}\}[\s\S]*name=release-assets-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT[\s\S]*name: \$\{\{ steps\.release-artifact\.outputs\.name \}\}/,
  );
  assert.match(
    releaseStage,
    /name: \$\{\{ needs\.release-build\.outputs\.release-assets-name \}\}/,
  );
  assert.doesNotMatch(
    releaseStage,
    /release-assets-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(
    releaseStage,
    /- name: Attest ZIP provenance\n {8}uses: actions\/attest@[0-9a-f]{40}[^\n]*\n {8}with:\n {10}subject-path: release-assets\/\*\.zip\n\n {6}- name: Attest ZIP SBOM\n {8}uses: actions\/attest@[0-9a-f]{40}[^\n]*\n {8}with:\n {10}subject-path: release-assets\/\*\.zip\n {10}sbom-path: \$\{\{ steps\.release-state\.outputs\.sbom \}\}\n\n {6}- name: Attest DMG provenance\n {8}uses: actions\/attest@[0-9a-f]{40}[^\n]*\n {8}with:\n {10}subject-path: release-assets\/\*\.dmg/,
  );
  assert.equal(releaseStage.match(/actions\/attest@/gu)?.length, 3);
  assert.doesNotMatch(releaseStage, /--draft=false/);
  assert.match(releasePublish, /gh release download/);
  assert.doesNotMatch(
    releasePublish,
    /actions\/download-artifact|actions\/attest|pnpm install|pnpm make|pnpm test|gh release create/,
  );
  assert.match(releasePublish, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(
    releasePublish,
    /EXPECTED_CLIENT_GENERATION:[^\n]+client-generation[\s\S]*scripts\/official-client\.ts[\s\S]*test "\$current_client_generation" = "\$EXPECTED_CLIENT_GENERATION"[\s\S]*gh release edit "\$TAG"/,
  );
  const signingMaterialRemovedAt = releaseBuild.indexOf(
    "security delete-keychain \"$APPLE_KEYCHAIN\"\n          rm -f",
  );
  assert.ok(signingMaterialRemovedAt > 0);
  assert.ok(
    releaseBuild.indexOf("name: Prepare signed Keychain replacement fixture")
      < signingMaterialRemovedAt,
  );
  assert.match(
    releaseBuild,
    /ditto "\$app" "\$replacement"[\s\S]*?rm "\$replacement\/Contents\/Resources\/distribution-channel\.json"[\s\S]*?scripts\/sign-distribution-app\.ts/,
  );
  assert.ok(
    signingMaterialRemovedAt
      < releaseBuild.indexOf("name: Prepare checksum-pinned release assets"),
  );
  assert.ok(
    signingMaterialRemovedAt < releaseBuild.indexOf("uses: anchore/sbom-action@"),
  );
  assert.ok(
    signingMaterialRemovedAt
      < releaseBuild.indexOf("name: Handoff verified release assets"),
  );
  assert.doesNotMatch(
    releaseBuild.slice(0, signingMaterialRemovedAt),
    /pnpm test:packaged|pnpm test:signed-keychain|pnpm test:stable-beta-roundtrip/,
  );
  const runtimeWithoutSigningSecrets = releaseBuild.slice(signingMaterialRemovedAt);
  assert.match(
    runtimeWithoutSigningSecrets,
    /run: \|[\s\S]*?pnpm test:packaged[\s\S]*?client-chain-qualification\.test\.ts/,
  );
  assert.match(
    runtimeWithoutSigningSecrets,
    /GW_SIGNED_REPLACEMENT_APP_PATH:[^\n]+runtime-fixture\.outputs\.replacement/,
  );
  assert.match(
    runtimeWithoutSigningSecrets,
    /APPLE_PROVISIONING_PROFILE="\$stable_app\/Contents\/embedded\.provisionprofile"[\\\s]+pnpm verify:signed-app "\$stable_app"/,
  );
  assert.match(
    runtimeWithoutSigningSecrets,
    /unset GH_TOKEN[\s\S]*pnpm test:stable-beta-roundtrip/,
  );

  // A dry run is only evidence about the real build if it is the real build
  // minus every GitHub mutation. Both mutation jobs are skipped whole; no
  // build or package-verification step may branch around work for a dry run.
  // The build records what it produced where skipped jobs cannot hide it.
  assert.match(workflow, /workflow_dispatch:\n {4}inputs:\n {6}dry_run:/);
  assert.match(releaseStage, /stage-release:\n {4}if: \$\{\{ !inputs\.dry_run \}\}/);
  assert.match(releasePublish, /release:\n {4}if: \$\{\{ !inputs\.dry_run \}\}/);
  assert.equal(workflow.match(/if: [^\n]*dry_run/gu)?.length, 2);
  assert.match(
    releaseBuild,
    /name: Summarize built and verified assets[\s\S]*?cat "\$ASSET_DIR\/SHA256SUMS\.txt"[\s\S]*?>> "\$GITHUB_STEP_SUMMARY"/,
  );

  assert.match(workflow, /--prerelease --latest=false/);
  assert.doesNotMatch(workflow, /SIGNED_BETA_UPDATE_PROVEN/);
  assert.match(workflow, /\*-alpha\.\*/);
  assert.match(workflow, /name: Prove beta data returns to latest Stable/);
  assert.match(workflow, /stable_zip_name="Guild-Wars-Reforged-\$\{stable_version\}-macOS-arm64\.zip"/);
  assert.match(workflow, /gh attestation verify "\$stable_zip"/);
  assert.match(workflow, /pnpm verify:signed-app "\$stable_app"/);
  assert.match(workflow, /GW_STABLE_VERSION="\$stable_version"/);
  assert.match(workflow, /pnpm test:stable-beta-roundtrip/);
  assert.match(
    script("test:stable-beta-roundtrip"),
    /verify-stable-beta-roundtrip\.ts/,
  );
  assert.match(workflow, /--draft --generate-notes/);
  assert.match(
    releaseStage,
    /name: Prepare machine-owned Verification record[\s\S]*scripts\/release-verification-record\.ts stage/,
  );
  assert.match(workflow, /--json isDraft --jq '\.isDraft'\)" != "true"/);
  assert.match(
    workflow,
    /draft_target="\$\(gh release view[\s\S]*--json targetCommitish --jq '\.targetCommitish'\)"[\s\S]*if \[ "\$draft_target" != "\$GITHUB_SHA" \]; then[\s\S]*Delete the obsolete unpublished draft before retrying/,
  );
  assert.match(
    workflow,
    /name: Create complete draft release\n {8}if: steps\.release-state\.outputs\.create == 'true'/,
  );
  assert.equal(
    workflow.match(/if: steps\.release-state\.outputs\.create == 'true'/gu)
      ?.length,
    1,
  );
  assert.match(
    releaseStage,
    /outputs:\n {6}checksums-sha256: \$\{\{ steps\.draft\.outputs\.checksums-sha256 \}\}/,
  );
  assert.match(
    releaseStage,
    /name: Verify exact remote draft[\s\S]*cmp release-assets\/SHA256SUMS\.txt "\$remote\/SHA256SUMS\.txt"[\s\S]*echo "checksums-sha256=\$checksums_sha256" >> "\$GITHUB_OUTPUT"/,
  );
  assert.match(
    releasePublish,
    /needs: \[release-build, stage-release\][\s\S]{0,100}environment: release/,
  );
  assert.match(
    releasePublish,
    /EXPECTED_CHECKSUMS_SHA256: \$\{\{ needs\.stage-release\.outputs\.checksums-sha256 \}\}/,
  );
  assert.match(
    releasePublish,
    /EXPECTED_WORKFLOW_URL: \$\{\{ needs\.stage-release\.outputs\.workflow-url \}\}/,
  );
  assert.match(
    releasePublish,
    /--json body,isDraft,isPrerelease,targetCommitish[\s\S]*isDraft'[\s\S]*isPrerelease'[\s\S]*targetCommitish'/,
  );
  assert.match(
    releasePublish,
    /awk '\{\$1=""; sub\(\/\^\[\[:space:\]\]\+\/, ""\); print\}'[\s\S]*echo SHA256SUMS\.txt[\s\S]*find "\$remote" -maxdepth 1 -type f -exec basename \{\} \\;[\s\S]*cmp "\$expected_assets" "\$actual_assets"/,
  );
  assert.match(
    releasePublish,
    /actual_checksums_sha256[\s\S]*EXPECTED_CHECKSUMS_SHA256[\s\S]*body_file="\$RUNNER_TEMP\/release-body\.md"[\s\S]*scripts\/release-verification-record\.ts publish/,
  );
  assert.match(
    releaseBuild,
    /hdiutil attach[\s\S]*diff -qr[\s\S]*Guild Wars Reforged\.app[\s\S]*hdiutil detach/,
  );
  assert.match(releasePublish, /gh release edit "\$TAG"[\s\S]*--draft=false/);
  assert.match(updateFeedCall, /needs: release/);
  assert.match(updateFeedCall, /uses: \.\/\.github\/workflows\/update-feeds\.yml/);
  assert.match(updateFeedCall, /contents: read/);
  assert.match(updateFeedCall, /pages: write/);
  assert.match(updateFeedCall, /id-token: write/);
  assert.match(feedWorkflow, /workflow_call:[\s\S]*workflow_dispatch:/);
  assert.match(
    feedWorkflow,
    /workflow_dispatch:\n {4}inputs:\n {6}bootstrap:[\s\S]*default: false/,
  );
  assert.match(feedWorkflow, /permissions:\n {2}contents: read/);
  assert.match(updateFeedBuild, /gh api --paginate --slurp/);
  assert.match(updateFeedBuild, /scripts\/update-feeds\.ts/);
  assert.match(updateFeedBuild, /if \[ "\$BOOTSTRAP" = "true" \]/);
  assert.match(
    read("scripts/update-feeds.ts"),
    /assertFeedsDoNotMoveBackward\(feeds, previous\)/,
  );
  assert.match(updateFeedBuild, /actions\/configure-pages@[0-9a-f]{40}/);
  assert.match(updateFeedBuild, /actions\/upload-pages-artifact@[0-9a-f]{40}/);
  assert.doesNotMatch(updateFeedBuild, /contents: write|pages: write|id-token: write/);
  assert.match(updateFeedDeploy, /needs: build/);
  assert.match(updateFeedDeploy, /pages: write/);
  assert.match(updateFeedDeploy, /id-token: write/);
  assert.match(updateFeedDeploy, /environment:\n {6}name: github-pages/);
  assert.match(updateFeedDeploy, /actions\/deploy-pages@[0-9a-f]{40}/);
  assert.match(updateFeedDeploy, /Verify the public channel documents/);
  assert.match(updateFeedDeploy, /test "\$actual" = "\$expected"/);
  assert.match(workflow, /RELEASES\.json/);
  assert.match(workflow, /\*\.zip \*\.dmg RELEASES\.json \*\.spdx\.json/);
  assert.match(
    workflow,
    /gh release create "\$TAG" "\$\{args\[@\]\}" release-assets\/\*/,
  );
});
