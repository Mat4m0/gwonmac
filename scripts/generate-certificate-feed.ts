// The one producer of a certificate feed document: the snapshot bundled inside
// the application, and the candidate a publication signs. They are the same
// derivation from the same tables at a different `sequence`, which is what lets
// a published feed be reproduced from the tree alone and compared byte for byte.
//
// The TypeScript tables under src/main/certification stay the authoring source:
// the isolated proof is compiled against them and cannot read a file. This
// writes the derived copy, so an entry is still added in exactly one place.
//
// It reads the source rather than build/main's compiled copy for the reason
// scripts/generate-preload.ts gives: an input that depends on a build step lets
// a stale build/ produce a stale artifact. Its whole import graph is this
// repository's own modules and Node builtins, so a reproduction needs a
// checkout and a Node and nothing else — no package manager, no dependency
// tree, nothing a registry could move under two runners that must agree.
//
// The round trip is checked here rather than only in the unit suite. These are
// the bytes a signature would cover and the bytes a reader parses, so a table
// this schema cannot express canonically has to fail the build that ships it.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  BUNDLED_CERTIFICATE_FEED_SEQUENCE,
  bundledCertificateFeed,
  parseCertificateFeed,
  serializeCertificateFeed,
} from "../src/main/certification/certificate-feed.js";

export const OUTPUT = "build/certificates/feed.json";

export function generate(
  sequence: number = BUNDLED_CERTIFICATE_FEED_SEQUENCE,
): Uint8Array {
  const bytes = serializeCertificateFeed({
    ...bundledCertificateFeed(),
    sequence,
  });
  const reread = serializeCertificateFeed(parseCertificateFeed(bytes));
  if (Buffer.compare(Buffer.from(bytes), Buffer.from(reread)) !== 0) {
    throw new Error(
      "the bundled certificate feed does not survive its own parser unchanged",
    );
  }
  return bytes;
}

/**
 * The sequence a published candidate may carry. It has to beat the snapshot
 * compiled into the application, because a feed that does not is one no
 * installation will ever adopt — `governingCertificateFeed` keeps the newer of
 * the two, and the snapshot needs nothing from the network. The upper bound is
 * the parser's own unsigned-word rule and is left to it: `generate` reads every
 * document it writes.
 */
export function publicationSequence(text: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) {
    throw new Error(`--sequence must be a decimal integer, not ${JSON.stringify(text)}`);
  }
  const sequence = Number(text);
  if (sequence <= BUNDLED_CERTIFICATE_FEED_SEQUENCE) {
    throw new Error(
      `--sequence ${sequence} does not beat the bundled snapshot's `
        + `${BUNDLED_CERTIFICATE_FEED_SEQUENCE}, so no installation would adopt it`,
    );
  }
  return sequence;
}

interface Arguments {
  readonly sequence: number;
  readonly out: string;
}

export function parseArguments(argv: readonly string[]): Arguments {
  let sequence = BUNDLED_CERTIFICATE_FEED_SEQUENCE;
  let out = OUTPUT;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--sequence") sequence = publicationSequence(value);
    else if (flag === "--out") out = value;
    else throw new Error(`unknown argument ${JSON.stringify(flag)}`);
  }
  return { sequence, out };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { sequence, out } = parseArguments(process.argv.slice(2));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, generate(sequence));
  console.log(`generated certificate feed ${sequence} -> ${out}`);
}
