import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allowedName,
  isPublicIp,
  parseDestination,
  ALLOWED_PORTS,
} from "../../src/main/core/allowlists.js";
import { ValidationError } from "../../src/shared/errors.js";

describe("allowlists", () => {
  it("allows approved domain suffixes", () => {
    for (const name of [
      "arenanetworks.com",
      "File1.ArenaNetworks.com",
      "guildwars.com",
      "a.b.guildwars.com",
      "arenanetworks.com.",
    ]) {
      assert.equal(allowedName(name), true, name);
    }
  });

  it("rejects lookalike and empty names", () => {
    for (const name of [
      "arenanetworks.com.evil.com",
      "evil.com",
      "notarenanetworks.com",
      "xarenanetworks.com",
      "",
    ]) {
      assert.equal(allowedName(name), false, name || "(empty)");
    }
  });

  it("classifies public vs private addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.1.2",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "not.an.ip",
      "1.2.3",
    ]) {
      assert.equal(isPublicIp(ip), false, ip);
    }
    for (const ip of [
      "8.8.8.8",
      "54.196.189.234",
      "172.15.0.1",
      "172.32.0.1",
      "2606:4700::1",
      "::ffff:8.8.8.8",
    ]) {
      assert.equal(isPublicIp(ip), true, ip);
    }
  });

  it("parses IPv4:port and [IPv6]:port only", () => {
    assert.deepEqual(parseDestination("8.8.8.8:6112"), { host: "8.8.8.8", port: 6112 });
    assert.deepEqual(parseDestination("[2606:4700::1]:443"), {
      host: "2606:4700::1",
      port: 443,
    });
    assert.throws(() => parseDestination("2606:4700::1:443"), ValidationError);
    assert.throws(() => parseDestination("bad"), ValidationError);
  });

  it("allowlists the game ports", () => {
    assert.deepEqual([...ALLOWED_PORTS].sort((a, b) => a - b), [80, 443, 6112]);
  });
});
