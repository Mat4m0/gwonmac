import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCanonicalRendererUrl } from "../../src/main/core/renderer-trust.js";

describe("canonical renderer URL", () => {
  it("allows only the launcher document and explicit developer variants", () => {
    for (const url of [
      "gw://app/",
      "gw://app/index.html",
      "gw://app/?toolbox-automation=1",
      "gw://app/?toolbox-fixture=map",
      "gw://app/?toolbox-fixture=target",
    ]) {
      assert.equal(isCanonicalRendererUrl(url), true, url);
    }
  });

  it("rejects proxy, subresource, ambiguous, and malformed URLs", () => {
    for (const url of [
      "gw://app/account/login",
      "gw://app/Gw.jspi.js",
      "gw://app/?unknown=1",
      "gw://app/?toolbox-automation=0",
      "gw://app/?toolbox-automation=1&toolbox-fixture=map",
      "gw://app/?toolbox-automation=1#fragment",
      "gw://user@app/",
      "gw://app:443/",
      "https://app/",
      "not a URL",
    ]) {
      assert.equal(isCanonicalRendererUrl(url), false, url);
    }
  });
});
