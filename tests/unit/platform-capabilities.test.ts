import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unavailablePlatformCapabilities } from "../../src/renderer/platform-capabilities.js";

describe("ArenaNet unavailable platform capabilities", () => {
  it("exposes only the two namespaces required by defective client guards", () => {
    const capabilities = unavailablePlatformCapabilities("macos", () => undefined);
    assert.deepEqual(Object.keys(capabilities).sort(), ["adProvider", "shop"]);
    assert.equal(capabilities.adProvider.privacyOptionsRequired, false);
  });

  it("returns promises with explicit unavailable outcomes", async () => {
    const calls: string[] = [];
    const capabilities = unavailablePlatformCapabilities("windows", (value) => {
      calls.push(String(value));
    });
    await assert.rejects(
      capabilities.adProvider.showInterstitial(),
      /adProvider\.showInterstitial is unavailable on Windows/,
    );
    await assert.rejects(
      capabilities.shop.initialize(),
      /shop\.initialize is unavailable on Windows/,
    );
    await assert.rejects(
      capabilities.shop.inAppPurchase(),
      /shop\.inAppPurchase is unavailable on Windows/,
    );
    assert.equal(calls.length, 3);
  });

  it("preserves the four callback assignments made by the glue", () => {
    const { shop } = unavailablePlatformCapabilities("linux", () => undefined);
    const callback = () => undefined;
    shop.onTransactionApproved = callback;
    shop.onInAppPurchase = callback;
    shop.onTransactionComplete = callback;
    shop.onValidationRequest = callback;
    assert.equal(shop.onTransactionApproved, callback);
    assert.equal(shop.onInAppPurchase, callback);
    assert.equal(shop.onTransactionComplete, callback);
    assert.equal(shop.onValidationRequest, callback);
  });

  it("uses closed wording for every trusted platform and invalid init", async () => {
    for (const [platform, name] of [
      ["macos", "macOS"],
      ["windows", "Windows"],
      ["linux", "Linux"],
      [null, "this desktop platform"],
    ] as const) {
      const capabilities = unavailablePlatformCapabilities(
        platform,
        () => undefined,
      );
      await assert.rejects(
        capabilities.shop.initialize(),
        new RegExp(`unavailable on ${name}`),
      );
    }
  });
});
