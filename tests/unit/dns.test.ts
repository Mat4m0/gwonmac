import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allowedName } from "../../src/main/core/allowlists.js";
import {
  fallbackDnsServers,
  normalizeDnsName,
  resolveDns,
} from "../../src/main/core/dns.js";
import { AllowlistError, ValidationError } from "../../src/shared/errors.js";

describe("dns suffix matching", () => {
  it("normalizes case and a trailing dot", () => {
    assert.equal(normalizeDnsName("File1.ArenaNetworks.com."), "file1.arenanetworks.com");
  });

  it("matches whole suffix labels only", () => {
    assert.equal(allowedName("file1.arenanetworks.com"), true);
    assert.equal(allowedName("arenanetworks.com.evil.example"), false);
    assert.equal(allowedName("notarenanetworks.com"), false);
    assert.equal(allowedName("xarenanetworks.com"), false);
    assert.equal(allowedName(""), false);
  });

  it("rejects IP literals passed as DNS names", async () => {
    await assert.rejects(() => resolveDns("8.8.8.8"), ValidationError);
    await assert.rejects(() => resolveDns("169.254.169.254"), ValidationError);
  });

  it("rejects names outside the allowlist without contacting the network", async () => {
    await assert.rejects(() => resolveDns("evil.example"), AllowlistError);
  });

  it("uses Node's platform resolver list without assuming resolv.conf", () => {
    assert.deepEqual(
      fallbackDnsServers([
        "192.0.2.53",
        "2001:db8::53",
        "8.8.8.8",
      ]),
      ["192.0.2.53", "8.8.8.8", "1.1.1.1"],
    );
  });
});
