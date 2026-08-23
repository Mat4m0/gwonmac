import { expect, test } from "@playwright/test";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { closeOffline, launchOffline } from "./fixtures.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
let server: Server;
let endpoint = "";
let requests = 0;

function wholeSecond(milliseconds: number): string {
  return new Date(Math.floor(milliseconds / 1_000) * 1_000)
    .toISOString().replace(".000Z", "Z");
}

function signedBody(): string {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    sequence: 1,
    publishedAt: wholeSecond(now),
    notices: [{
      id: "arenanet-client-update",
      revision: 1,
      state: "active",
      kind: "arenanet-update",
      severity: "degraded",
      title: "Guild Wars was updated",
      summary: "We’re checking that everything still behaves as expected. You can keep playing.",
      details: ["If something feels wrong, please tell us on Discord."],
      startsAt: wholeSecond(now - 60_000),
      expiresAt: wholeSecond(now + 60 * 60 * 1_000),
      action: "discord-support",
    }],
    releases: [],
  }));
  return JSON.stringify({
    schemaVersion: 1,
    keyId: "content-test-01",
    payload: payload.toString("base64url"),
    signature: sign(null, payload, privateKey).toString("base64url"),
  });
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url !== "/content/v1/feed.json") {
      response.writeHead(404).end();
      return;
    }
    requests += 1;
    const body = signedBody();
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      ETag: '"content-e2e-1"',
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("content fixture did not bind");
  endpoint = `http://127.0.0.1:${address.port}/content/v1/feed.json`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) =>
    error ? reject(error) : resolve()));
});

test("a signed loopback notice informs without taking over startup", async () => {
  requests = 0;
  const fixture = await launchOffline("gw-content-e2e-", {
    GW_TEST_CONTENT_FEED_URL: endpoint,
    GW_TEST_CONTENT_PUBLIC_KEY: publicKeyBase64,
  });
  try {
    const { page } = fixture;
    await expect(page.locator("#loading-content-notice")).toBeVisible();
    await expect(page.locator("#loading-content-title")).toHaveText("Guild Wars was updated");
    await expect(page.locator("#loading-content-summary")).toContainText("You can keep playing");
    await expect(page.locator("#loading-retry")).toBeVisible();
    expect(requests).toBe(1);

    await page.locator("#loading-content-open").click();
    await expect(page.locator("#settings-dialog")).toBeVisible();
    await expect(page.locator("#settings-content-list")).toContainText("Guild Wars was updated");
  } finally {
    await closeOffline(fixture);
  }
});

test("the independent opt-out makes zero content requests", async () => {
  requests = 0;
  const fixture = await launchOffline(
    "gw-content-optout-e2e-",
    {
      GW_TEST_CONTENT_FEED_URL: endpoint,
      GW_TEST_CONTENT_PUBLIC_KEY: publicKeyBase64,
    },
    async (userData) => {
      await writeFile(
        path.join(userData, "settings.json"),
        JSON.stringify({ onlineContentEnabled: false, autoCheckUpdates: false }),
        { mode: 0o600 },
      );
    },
  );
  try {
    const { page } = fixture;
    await expect.poll(() => page.evaluate(() => window.gwNative.content.getState()))
      .toMatchObject({ phase: "disabled" });
    expect(requests).toBe(0);
    await page.evaluate(() => window.gwNative.settings.set({ onlineContentEnabled: true }));
    await expect.poll(() => requests).toBe(1);
  } finally {
    await closeOffline(fixture);
  }
});
