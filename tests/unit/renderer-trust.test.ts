import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isAccountsRendererUrl,
  isCanonicalRendererUrl,
} from "../../src/main/core/renderer-trust.js";

describe("canonical renderer URL", () => {
  it("allows the launcher document and nothing else", () => {
    for (const url of ["gw://app/", "gw://app/index.html"]) {
      assert.equal(isCanonicalRendererUrl(url), true, url);
    }
  });

  it("rejects every query string, including the ones it used to carry", () => {
    // Launch configuration lives in the preload argument, so the trust
    // root no longer allow-lists anything. A parameter it once accepted is now
    // exactly as untrusted as one it never did.
    for (const url of [
      "gw://app/?enhancement-automation=1",
      "gw://app/?native-cursor=1",
      "gw://app/?template-fs-trace=1",
      "gw://app/?enhancement-automation=1&native-cursor=1",
      "gw://app/index.html?native-cursor=1",
      "gw://app/?unknown=1",
      "gw://app/?enhancement-fixture=map",
    ]) {
      assert.equal(isCanonicalRendererUrl(url), false, url);
    }
  });

  it("rejects proxy, subresource, ambiguous, and malformed URLs", () => {
    for (const url of [
      "gw://app/account/login",
      "gw://app/Gw.jspi.js",
      "gw://app/accounts.html",
      "gw://app/#fragment",
      "gw://user@app/",
      "gw://app:443/",
      "https://app/",
      "not a URL",
    ]) {
      assert.equal(isCanonicalRendererUrl(url), false, url);
    }
  });

  it("gives the accounts Hub its own document boundary", () => {
    assert.equal(isAccountsRendererUrl("gw://app/accounts.html"), true);
    for (const url of [
      "gw://app/",
      "gw://app/index.html",
      "gw://app/accounts.html?profile=one",
      "gw://app/accounts.html#profile",
    ]) {
      assert.equal(isAccountsRendererUrl(url), false, url);
    }
  });
});
