// ArenaNet's current glue has two defective absence guards: ad playback falls
// through after reporting failure, and shop purchase dereferences Module.shop
// before checking it. Keep only those two namespaces, with explicit unavailable
// semantics. Properly guarded optional namespaces are intentionally absent.

/**
 * The shop namespace ArenaNet's glue expects to find. The four callbacks are
 * assigned by the glue before `initialize()`, so they are declared here — as
 * writable properties rather than an index signature — to keep their contract
 * visible and ordinary property writes readable. Their arguments come from
 * generated code this project does not control, which is why they are
 * `unknown[]`: nothing here inspects them.
 */
type UnavailableShop = {
  onTransactionApproved: ((...args: unknown[]) => void) | null;
  onInAppPurchase: ((...args: unknown[]) => void) | null;
  onTransactionComplete: ((...args: unknown[]) => void) | null;
  onValidationRequest: ((...args: unknown[]) => void) | null;
  initialize: (...args: unknown[]) => Promise<never>;
  inAppPurchase: (...args: unknown[]) => Promise<never>;
};

export function unavailablePlatformCapabilities(
  log: (...values: unknown[]) => void,
) {
  const unavailable = (name: string): Promise<never> => {
    log(`[platform] ${name} unavailable`);
    return Promise.reject(new Error(`${name} is unavailable on macOS`));
  };

  const shop: UnavailableShop = {
    onTransactionApproved: null,
    onInAppPurchase: null,
    onTransactionComplete: null,
    onValidationRequest: null,
    initialize: () => unavailable('shop.initialize'),
    inAppPurchase: () => unavailable('shop.inAppPurchase'),
  };

  return {
    adProvider: Object.freeze({
      privacyOptionsRequired: false,
      showInterstitial: () => unavailable('adProvider.showInterstitial'),
    }),
    shop,
  };
}
