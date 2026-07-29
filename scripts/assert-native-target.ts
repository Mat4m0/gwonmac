import releaseTargetsJson from "../release-targets.json" with { type: "json" };
import { pathToFileURL } from "node:url";
import {
  parseReleaseTargets,
  releaseTargetById,
} from "../src/shared/release-targets.js";

export function assertNativeTarget(
  targetId: string,
  platform = process.platform,
  arch = process.arch,
): void {
  const target = releaseTargetById(
    parseReleaseTargets(releaseTargetsJson),
    targetId,
  );
  if (platform !== target.platform || arch !== target.arch) {
    throw new Error(
      `${targetId} requires ${target.platform}/${target.arch}, got ${platform}/${arch}`,
    );
  }
}

const targetId = process.argv[2];
if (
  targetId !== undefined
  && process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url
) {
  assertNativeTarget(targetId);
  process.stdout.write(`${targetId}: ${process.platform}/${process.arch}\n`);
}
