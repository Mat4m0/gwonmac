import releaseTargetsJson from "../release-targets.json" with { type: "json" };
import { pathToFileURL } from "node:url";
import {
  parseReleaseTargets,
  type ReleasePlatform,
  type ReleaseTargetsDocument,
} from "../src/shared/release-targets.js";

const RUNNERS: Record<ReleasePlatform, string> = {
  darwin: "macos-15",
  win32: "windows-2022",
  linux: "ubuntu-24.04",
};

export interface ReleaseMatrixEntry {
  readonly targetId: string;
  readonly platform: ReleasePlatform;
  readonly arch: "arm64" | "x64";
  readonly runner: string;
}

export function releaseTargetMatrix(
  document: ReleaseTargetsDocument,
): { readonly include: readonly ReleaseMatrixEntry[] } {
  return {
    include: document.targets.map((target) => ({
      targetId: target.id,
      platform: target.platform,
      arch: target.arch,
      runner: RUNNERS[target.platform],
    })),
  };
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.stdout.write(
    JSON.stringify(releaseTargetMatrix(parseReleaseTargets(releaseTargetsJson))),
  );
}
