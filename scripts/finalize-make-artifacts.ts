import type { ForgeMakeResult } from "@electron-forge/shared-types";
import { rename } from "node:fs/promises";
import path from "node:path";
import {
  releaseTargetFilename,
  type ReleaseTarget,
  type ReleaseTargetsDocument,
} from "../src/shared/release-targets.js";

function primaryArtifact(
  result: ForgeMakeResult,
  target: ReleaseTarget,
): string {
  const extension = target.format === "zip"
    ? ".zip"
    : target.format === "squirrel"
      ? ".exe"
      : ".deb";
  const matches = result.artifacts.filter((artifact) =>
    artifact.toLowerCase().endsWith(extension)
  );
  if (matches.length !== 1) {
    throw new Error(
      `${target.id} produced ${matches.length} primary ${extension} artifacts`,
    );
  }
  return matches[0]!;
}

export async function finalizeMakeArtifacts(
  results: ForgeMakeResult[],
  document: ReleaseTargetsDocument,
  version: string,
): Promise<ForgeMakeResult[]> {
  for (const result of results) {
    const targets = document.targets.filter((target) =>
      target.platform === result.platform && target.arch === result.arch
    );
    if (targets.length !== 1) {
      throw new Error(
        `make result has no canonical target: ${result.platform}/${result.arch}`,
      );
    }
    const target = targets[0]!;
    const source = primaryArtifact(result, target);
    const destination = path.join(
      path.dirname(source),
      releaseTargetFilename(target, version),
    );
    if (source !== destination) await rename(source, destination);
    result.artifacts = result.artifacts.map((artifact) =>
      artifact === source ? destination : artifact
    );
  }
  return results;
}
