/**
 * The offline visual-stage analyzer: exact pixel metrics, lossless diffs, and
 * a conservative attribution boundary without automatic blame.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import {
  isRuntimeDiagnosticState,
  withCapture,
  validateCapture,
} from "./common.js";

const input = process.argv[2];
if (!input) {
  console.error("usage: pnpm diagnostics:visual <capture.zip> [output-directory]");
  process.exitCode = 2;
} else {
  const archive = path.resolve(input);
  const output = path.resolve(
    process.argv[3]
      ?? path.join(path.dirname(archive), `${path.basename(archive, path.extname(archive))}-visual-analysis`),
  );
  await withCapture(archive, async (capture) => {
    const errors = validateCapture(capture);
    if (errors.length) throw new Error(errors.join("; "));
    await mkdir(output, { recursive: true });

    const comparisons = [];
    for (const [leftName, rightName] of [
      ["webgl", "offscreen"],
      ["offscreen", "canvas"],
    ] as const) {
      const leftBytes = capture.visualStages?.[leftName];
      const rightBytes = capture.visualStages?.[rightName];
      if (!leftBytes || !rightBytes) {
        comparisons.push({ left: leftName, right: rightName, status: "missing" });
        continue;
      }
      const left = PNG.sync.read(Buffer.from(leftBytes));
      const right = PNG.sync.read(Buffer.from(rightBytes));
      if (left.width !== right.width || left.height !== right.height) {
        comparisons.push({
          left: leftName,
          right: rightName,
          status: "dimension-mismatch",
          leftDimensions: { width: left.width, height: left.height },
          rightDimensions: { width: right.width, height: right.height },
        });
        continue;
      }
      const diff = new PNG({ width: left.width, height: left.height });
      const mismatchedPixels = pixelmatch(
        left.data,
        right.data,
        diff.data,
        left.width,
        left.height,
        { threshold: 0.1 },
      );
      let exactMismatchPixels = 0;
      let maximumChannelDifference = 0;
      for (let pixel = 0; pixel < left.width * left.height; pixel++) {
        let differs = false;
        for (let channel = 0; channel < 4; channel++) {
          const index = pixel * 4 + channel;
          const difference = Math.abs(left.data[index]! - right.data[index]!);
          if (difference) differs = true;
          maximumChannelDifference = Math.max(maximumChannelDifference, difference);
        }
        if (differs) exactMismatchPixels++;
      }
      const totalPixels = left.width * left.height;
      const mismatchRatio = mismatchedPixels / totalPixels;
      const diffName = `diff-${leftName}-to-${rightName}.png`;
      await writeFile(path.join(output, diffName), PNG.sync.write(diff));
      comparisons.push({
        left: leftName,
        right: rightName,
        status: "compared",
        dimensions: { width: left.width, height: left.height },
        mismatchedPixels,
        exactMismatchPixels,
        totalPixels,
        mismatchRatio,
        maximumChannelDifference,
        material: mismatchRatio >= 0.001,
        diff: diffName,
      });
    }

    const firstMaterial = comparisons.find((entry) =>
      entry.status === "compared" && entry.material);
    const classification = firstMaterial?.left === "webgl"
      ? "webgl-to-offscreen-divergence"
      : firstMaterial?.left === "offscreen"
        ? "offscreen-to-presented-divergence"
        : comparisons.every((entry) => entry.status === "compared")
          ? "presentation-stages-match"
          : "insufficient-comparable-stages";
    const runtime = isRuntimeDiagnosticState(capture.runtimeState)
      ? capture.runtimeState
      : null;
    const activeRuntime = runtime?.status === "active" ? runtime : null;
    const snapshotFailures = capture.eventLog
      ? /"(?:snapshot\.readFailed|snapshot\.rangeFailed)"/u.test(capture.eventLog)
      : null;
    const officialRawEvidence = Boolean(
      activeRuntime
      && activeRuntime.artifactKind === "official"
      && (activeRuntime.diagnosticProfile === "official-baseline"
        || activeRuntime.diagnosticProfile === "direct-canvas")
      && capture.visualStages?.webgl,
    );
    const upstreamOfPresentationCandidate = officialRawEvidence
      && snapshotFailures === false
      && classification === "presentation-stages-match";
    const result = {
      formatVersion: 1,
      archive,
      threshold: 0.1,
      materialMismatchRatio: 0.001,
      classification,
      comparisons,
      snapshotFailures,
      officialRawEvidence,
      upstreamOfPresentationCandidate,
      arenaNetAttributionReady: false,
      humanReviewRequired: true,
    };
    await writeFile(
      path.join(output, "visual-analysis.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    if (upstreamOfPresentationCandidate) {
      await writeFile(
        path.join(output, "triage-summary.md"),
        `# Guild Wars visual corruption triage\n\n`
          + `This capture used untouched official client artifacts, and the captured presentation stages do not materially diverge. `
          + `A person must still confirm that the raw WebGL image contains the reported defect.\n\n`
          + `Official WASM SHA-256: ${String(activeRuntime?.officialWasmSha256 ?? "unknown")}\n\n`
          + `This is an upstream-of-presentation candidate, not ArenaNet attribution. The evidence cannot by itself distinguish ArenaNet client logic, game data, Chromium WebGL, or the GPU driver.\n`,
      );
    }
    console.log(`classification: ${classification}`);
    for (const comparison of comparisons) {
      if (comparison.status !== "compared") {
        console.log(`${comparison.left} -> ${comparison.right}: ${comparison.status}`);
      } else {
        const ratio = comparison.mismatchRatio ?? 0;
        console.log(
          `${comparison.left} -> ${comparison.right}: `
            + `${(ratio * 100).toFixed(4)}% mismatched`,
        );
      }
    }
    console.log(`analysis: ${path.join(output, "visual-analysis.json")}`);
  });
}
