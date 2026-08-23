/** Launch Electron against a real, signed loopback content feed. */
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { ContentPayloadV1, SignedContentEnvelopeV1 } from "../src/shared/content-feed.js";

const SCENARIOS = [
  "healthy",
  "announcement",
  "arenanet-update",
  "known-issue",
  "resolved",
  "release",
  "stale-cache",
  "offline",
  "timeout",
  "invalid-signature",
  "rollback",
  "oversized",
] as const;
type Scenario = (typeof SCENARIOS)[number];

function requestedScenario(): Scenario {
  const marker = process.argv.indexOf("--scenario");
  const value = marker >= 0 ? process.argv[marker + 1] : "healthy";
  if (!SCENARIOS.includes(value as Scenario)) {
    throw new Error(`scenario must be one of: ${SCENARIOS.join(", ")}`);
  }
  return value as Scenario;
}

function iso(milliseconds: number): string {
  return new Date(Math.floor(milliseconds / 1_000) * 1_000)
    .toISOString().replace(".000Z", "Z");
}

function payloadFor(scenario: Scenario, version: string): ContentPayloadV1 {
  const now = Date.now();
  const base = {
    schemaVersion: 1 as const,
    sequence: scenario === "rollback" ? 1 : 2,
    publishedAt: iso(now),
    releases: scenario === "release" ? [{
      version,
      track: "stable" as const,
      publishedAt: iso(now),
      title: "A smoother Guild Wars launch",
      summary: "This update improves startup feedback and keeps status information close at hand.",
      highlights: ["Added Updates & Status", "Improved plain-language startup messages"],
    }] : [],
  };
  if (scenario === "healthy" || scenario === "release" || scenario === "offline"
      || scenario === "timeout" || scenario === "invalid-signature"
      || scenario === "rollback" || scenario === "oversized") {
    return { ...base, notices: [] };
  }
  const knownIssue = scenario === "known-issue";
  const resolved = scenario === "resolved";
  return {
    ...base,
    notices: [{
      id: knownIssue ? "long-session-memory" : "arenanet-client-update",
      revision: 1,
      state: resolved ? "resolved" : "active",
      kind: knownIssue ? "known-issue" : scenario === "announcement"
        ? "announcement" : "arenanet-update",
      severity: scenario === "announcement" ? "important" : "degraded",
      title: knownIssue ? "Long sessions may use more memory" : "Guild Wars was updated",
      summary: knownIssue
        ? "Guild Wars can use more memory during a long session and may eventually close. You can keep playing."
        : "We’re checking that everything still behaves as expected. You can keep playing.",
      details: knownIssue
        ? ["This happens inside the game client, so GWonMac cannot fully fix it.", "Restarting the game from time to time can help."]
        : ["If something feels wrong, please tell us on Discord."],
      startsAt: iso(now - 60_000),
      expiresAt: iso(now + 24 * 60 * 60 * 1_000),
      action: knownIssue ? "app-releases" : "discord-support",
    }],
  };
}

const scenario = requestedScenario();
const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const payload = Buffer.from(JSON.stringify(payloadFor(scenario, packageJson.version)), "utf8");
const signature = scenario === "invalid-signature"
  ? Buffer.alloc(64, 7).toString("base64url")
  : sign(null, payload, privateKey).toString("base64url");
const envelope: SignedContentEnvelopeV1 = {
  schemaVersion: 1,
  keyId: "content-test-01",
  payload: payload.toString("base64url"),
  signature,
};
const ordinaryBody = Buffer.from(JSON.stringify(envelope));
const body = scenario === "oversized" ? Buffer.alloc(65 * 1024, 0x61) : ordinaryBody;
let requestCount = 0;

const server = createServer((request, response) => {
  if (request.url !== "/content/v1/feed.json") {
    response.writeHead(404).end();
    return;
  }
  requestCount += 1;
  process.stdout.write(`[content-dev] request ${requestCount}\n`);
  if (scenario === "offline") {
    response.writeHead(503).end();
    return;
  }
  if (scenario === "timeout") return;
  const etag = `"content-${scenario}-1"`;
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, { ETag: etag }).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": body.byteLength,
    ETag: etag,
  });
  response.end(body);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("loopback server did not bind");
  const endpoint = `http://127.0.0.1:${address.port}/content/v1/feed.json`;
  const encodedPublicKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  process.stdout.write(`[content-dev] ${scenario} at ${endpoint}\n`);
  const child = spawn("pnpm", ["dev"], {
    stdio: "inherit",
    env: {
      ...process.env,
      GW_TEST_CONTENT_FEED_URL: endpoint,
      GW_TEST_CONTENT_PUBLIC_KEY: encodedPublicKey,
    },
  });
  child.once("exit", (code, signal) => {
    server.close();
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => child.kill(signal));
  }
});
