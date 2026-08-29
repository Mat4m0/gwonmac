import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  APPLE_TEAM_ID,
  applicationIdentifier,
  DISTRIBUTION_CHANNELS,
} from "../../src/shared/distribution-channel.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("each channel has an exact minimal and isolated entitlement file", () => {
  for (const channel of DISTRIBUTION_CHANNELS) {
    const source = readFileSync(
      path.join(root, `packaging/entitlements.${channel}.plist`),
      "utf8",
    );
    assert.equal((source.match(/<key>/gu) ?? []).length, 4);
    assert.match(source, /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/u);
    assert.match(source, /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/u);
    assert.match(
      source,
      new RegExp(
        `<key>com\\.apple\\.application-identifier</key>\\s*<string>${applicationIdentifier(channel).replaceAll(".", "\\.")}</string>`,
        "u",
      ),
    );
    assert.match(
      source,
      new RegExp(
        `<key>com\\.apple\\.developer\\.team-identifier</key>\\s*<string>${APPLE_TEAM_ID}</string>`,
        "u",
      ),
    );
    assert.doesNotMatch(
      source,
      /keychain-access-groups|application-groups|app-sandbox|get-task-allow/u,
    );
  }
});
