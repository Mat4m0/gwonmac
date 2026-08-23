/** Build or verify the signed, presentation-only public content envelope. */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CONTENT_ENVELOPE_MAX_BYTES,
  CONTENT_PAYLOAD_MAX_BYTES,
  parseContentPayload,
  parseSignedContentEnvelope,
  type SignedContentEnvelopeV1,
} from "../src/shared/content-feed.js";

const usage = "content-feed.ts sign <source> <output> | verify <envelope> <public-key-base64> | assert-forward <source> <published-envelope> <public-key-base64> | release-notes <source> <version> <output>";

function canonicalPayload(value: unknown): Uint8Array {
  const payload = parseContentPayload(value);
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  if (bytes.byteLength > CONTENT_PAYLOAD_MAX_BYTES) {
    throw new Error(`content payload exceeds ${CONTENT_PAYLOAD_MAX_BYTES} bytes`);
  }
  return bytes;
}

async function signFeed(sourcePath: string, outputPath: string): Promise<void> {
  const privateKeyPem = process.env.CONTENT_FEED_PRIVATE_KEY;
  const keyId = process.env.CONTENT_FEED_KEY_ID;
  if (!privateKeyPem || !keyId) {
    throw new Error("CONTENT_FEED_PRIVATE_KEY and CONTENT_FEED_KEY_ID are required");
  }
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
  const payload = canonicalPayload(source);
  const envelope: SignedContentEnvelopeV1 = {
    schemaVersion: 1,
    keyId,
    payload: Buffer.from(payload).toString("base64url"),
    signature: sign(null, payload, createPrivateKey(privateKeyPem)).toString("base64url"),
  };
  parseSignedContentEnvelope(envelope);
  const encoded = `${JSON.stringify(envelope)}\n`;
  if (Buffer.byteLength(encoded) > CONTENT_ENVELOPE_MAX_BYTES) {
    throw new Error(`content envelope exceeds ${CONTENT_ENVELOPE_MAX_BYTES} bytes`);
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, encoded, { encoding: "utf8", mode: 0o644 });
}

async function verifiedPayload(envelopePath: string, publicKeyBase64: string) {
  const bytes = await readFile(envelopePath);
  if (bytes.byteLength > CONTENT_ENVELOPE_MAX_BYTES) throw new Error("content envelope is oversized");
  const envelope = parseSignedContentEnvelope(JSON.parse(bytes.toString("utf8")) as unknown);
  const payload = Buffer.from(envelope.payload, "base64url");
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
  if (!verify(null, payload, publicKey, Buffer.from(envelope.signature, "base64url"))) {
    throw new Error("content signature is invalid");
  }
  return parseContentPayload(JSON.parse(payload.toString("utf8")) as unknown);
}

async function verifyFeed(envelopePath: string, publicKeyBase64: string): Promise<void> {
  await verifiedPayload(envelopePath, publicKeyBase64);
}

async function assertForward(
  sourcePath: string,
  envelopePath: string,
  publicKeyBase64: string,
): Promise<void> {
  const next = parseContentPayload(
    JSON.parse(await readFile(sourcePath, "utf8")) as unknown,
  );
  const previous = await verifiedPayload(envelopePath, publicKeyBase64);
  if (next.sequence < previous.sequence) throw new Error("content sequence would move backward");
  if (next.sequence === previous.sequence && JSON.stringify(next) !== JSON.stringify(previous)) {
    throw new Error("content changed without advancing its sequence");
  }
}

async function writeReleaseNotes(
  sourcePath: string,
  version: string,
  outputPath: string,
): Promise<void> {
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
  const payload = parseContentPayload(source);
  const release = payload.releases.find((entry) => entry.version === version);
  if (!release) throw new Error(`content source has no release notes for ${version}`);
  const lines = [
    "## What’s new",
    "",
    release.summary,
    "",
    ...release.highlights.map((highlight) => `- ${highlight}`),
    "",
  ];
  await writeFile(outputPath, lines.join("\n"), "utf8");
}

const [command, first, second, third] = process.argv.slice(2);
if (!first || !second || !["sign", "verify", "assert-forward", "release-notes"].includes(command ?? "")) {
  throw new Error(usage);
}
if (command === "sign") await signFeed(first, second);
else if (command === "verify") await verifyFeed(first, second);
else if (command === "assert-forward") {
  if (!third) throw new Error(usage);
  await assertForward(first, second, third);
}
else {
  if (!third) throw new Error(usage);
  await writeReleaseNotes(first, second, third);
}
