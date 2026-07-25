import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unavailablePlatformCapabilities } from "../../src/renderer/platform-capabilities.js";

describe("ArenaNet unavailable platform capabilities", () => {
  it("exposes only the two namespaces required by defective client guards", () => {
    const capabilities = unavailablePlatformCapabilities(() => undefined);
    assert.deepEqual(Object.keys(capabilities).sort(), ["adProvider", "shop"]);
    assert.equal(capabilities.adProvider.privacyOptionsRequired, false);
  });

  it("returns promises with explicit unavailable outcomes", async () => {
    const calls: string[] = [];
    const capabilities = unavailablePlatformCapabilities((value) => {
      calls.push(String(value));
    });
    await assert.rejects(
      capabilities.adProvider.showInterstitial(),
      /adProvider\.showInterstitial is unavailable/,
    );
    await assert.rejects(capabilities.shop.initialize(), /shop\.initialize is unavailable/);
    await assert.rejects(
      capabilities.shop.inAppPurchase(),
      /shop\.inAppPurchase is unavailable/,
    );
    assert.equal(calls.length, 3);
  });

  it("preserves the four callback assignments made by the glue", () => {
    const { shop } = unavailablePlatformCapabilities(() => undefined);
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
});
