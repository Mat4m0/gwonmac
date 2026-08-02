// The one producer of build/certificates/feed.json, the certificate feed
// snapshot bundled inside the application.
//
// The TypeScript tables under src/main/certification stay the authoring source:
// the isolated proof is compiled against them and cannot read a file. This
// writes the derived copy, so an entry is still added in exactly one place.
//
// It reads the source rather than build/main's compiled copy for the reason
// scripts/generate-preload.ts gives: an input that depends on a build step lets
// a stale build/ produce a stale artifact.
//
// The round trip is checked here rather than only in the unit suite. These are
// the bytes a signature would cover and the bytes a reader parses, so a table
// this schema cannot express canonically has to fail the build that ships it.
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  bundledCertificateFeed,
  parseCertificateFeed,
  serializeCertificateFeed,
} from "../src/main/certification/certificate-feed.js";

export const OUTPUT = "build/certificates/feed.json";

export function generate(): Uint8Array {
  const bytes = serializeCertificateFeed(bundledCertificateFeed());
  const reread = serializeCertificateFeed(parseCertificateFeed(bytes));
  if (Buffer.compare(Buffer.from(bytes), Buffer.from(reread)) !== 0) {
    throw new Error(
      "the bundled certificate feed does not survive its own parser unchanged",
    );
  }
  return bytes;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  mkdirSync("build/certificates", { recursive: true });
  writeFileSync(OUTPUT, generate());
  console.log(`generated certificate feed -> ${OUTPUT}`);
}
