// ArenaNet's current glue has two defective absence guards: ad playback falls
// through after reporting failure, and shop purchase dereferences Module.shop
// before checking it. Keep only those two namespaces, with explicit unavailable
// semantics. Properly guarded optional namespaces are intentionally absent.

/**
 * @param {(...values: unknown[]) => void} log
 */
export function unavailablePlatformCapabilities(log) {
  /** @param {string} name */
  const unavailable = (name) => {
    log(`[platform] ${name} unavailable`);
    return Promise.reject(new Error(`${name} is unavailable on macOS`));
  };

  return {
    adProvider: Object.freeze({
      privacyOptionsRequired: false,
      showInterstitial: () => unavailable('adProvider.showInterstitial'),
    }),
    shop: /** @type {{
      onTransactionApproved: null | ((...args: unknown[]) => void),
      onInAppPurchase: null | ((...args: unknown[]) => void),
      onTransactionComplete: null | ((...args: unknown[]) => void),
      onValidationRequest: null | ((...args: unknown[]) => void),
      initialize: (...args: unknown[]) => Promise<never>,
      inAppPurchase: (...args: unknown[]) => Promise<never>
    }} */ ({
      // The glue assigns these callbacks before initialize(). Declare them so
      // their contract is visible and ordinary property writes remain readable.
      onTransactionApproved: null,
      onInAppPurchase: null,
      onTransactionComplete: null,
      onValidationRequest: null,
      initialize: () => unavailable('shop.initialize'),
      inAppPurchase: () => unavailable('shop.inAppPurchase'),
    }),
  };
}
