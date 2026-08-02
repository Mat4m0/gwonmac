import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { releaseAssetUrl } from "../src/shared/project-identity.js";
import {
  formatReleaseVersion,
  parseReleaseVersion,
} from "../src/shared/release.js";

export function releaseManifest(options: {
  version: string;
  tag: string;
  zipName: string;
  publishedAt: string;
}): string {
  const parsed = parseReleaseVersion(options.version);
  if (
    !parsed
    || formatReleaseVersion(parsed) !== options.version
    || options.tag !== `v${options.version}`
  ) {
    throw new Error("release version and tag do not match");
  }
  if (
    path.basename(options.zipName) !== options.zipName
    || !options.zipName.endsWith(".zip")
  ) {
    throw new Error("release ZIP name is invalid");
  }
  const publishedAt = new Date(options.publishedAt);
  if (Number.isNaN(publishedAt.valueOf())) {
    throw new Error("release publication timestamp is invalid");
  }
  const url = releaseAssetUrl(options.tag, options.zipName);
  return `${JSON.stringify({
    url,
    name: `Guild Wars Reforged v${options.version}`,
    version: options.version,
    tag: options.tag,
    pub_date: publishedAt.toISOString(),
    notes: "",
  }, null, 2)}\n`;
}

async function main(): Promise<void> {
  const [version, tag, zipName, publishedAt, output] = process.argv.slice(2);
  if (!version || !tag || !zipName || !publishedAt || !output) {
    throw new Error(
      "usage: release-manifest <version> <tag> <zip-name> <published-at> <output>",
    );
  }
  await writeFile(
    output,
    releaseManifest({ version, tag, zipName, publishedAt }),
    { encoding: "utf8", mode: 0o600 },
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
