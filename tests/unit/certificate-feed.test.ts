// The feed is hostile input that happens to arrive signed, so the parser is
// tested the way a manifest is: every refusal has its own case, and the
// accepting case is the shipped tables themselves, so the schema is proved
// against the only data anybody has rather than against a fixture written to
// fit it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUNDLED_CERTIFICATE_FEED_SEQUENCE,
  CERTIFICATE_FEED_FORMAT_VERSION,
  bundledCertificateFeed,
  certifiedBuildTablesFromFeed,
  governingCertificateFeed,
  parseCertificateFeed,
  serializeCertificateFeed,
} from "../../src/main/certification/certificate-feed.ts";
import { certifyClientBuild } from "../../src/main/certification/client-certification.ts";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/certification/template-save-compat.ts";
import { ENHANCEMENT_BUILDS } from "../../src/main/certification/enhancement-builds.ts";
import { AppError } from "../../src/shared/errors.ts";

const UNKNOWN_CLIENT = "f".repeat(64);

const encode = (document: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(document));

/** The bundled snapshot as a mutable JSON document, ready to be spoiled. */
function document(): Record<string, unknown> {
  return JSON.parse(
    new TextDecoder().decode(serializeCertificateFeed(bundledCertificateFeed())),
  ) as Record<string, unknown>;
}

function firstEntry(feed: Record<string, unknown>): Record<string, unknown> {
  const entries = feed["entries"];
  assert.ok(Array.isArray(entries) && entries.length > 0);
  return entries[0] as Record<string, unknown>;
}

function refusal(bytes: Uint8Array): AppError {
  try {
    parseCertificateFeed(bytes);
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "certificate_feed_format");
    return error;
  }
  return assert.fail("the parser accepted bytes it must refuse");
}

describe("the bundled certificate feed", () => {
  it("expresses every shipped certificate", () => {
    const feed = bundledCertificateFeed();
    assert.equal(feed.formatVersion, CERTIFICATE_FEED_FORMAT_VERSION);
    assert.equal(feed.sequence, BUNDLED_CERTIFICATE_FEED_SEQUENCE);
    assert.equal(feed.entries.size, TEMPLATE_SAVE_BUILDS.length);
    for (const build of TEMPLATE_SAVE_BUILDS) {
      assert.deepEqual(feed.entries.get(build.sha256)?.templateSave, build);
    }
    const enhancements = [...feed.entries.values()]
      .map((entry) => entry.enhancement)
      .filter((build) => build !== null);
    assert.deepEqual(enhancements, [...ENHANCEMENT_BUILDS]);
  });

  it("survives its own parser byte for byte", () => {
    const bytes = serializeCertificateFeed(bundledCertificateFeed());
    assert.deepEqual(serializeCertificateFeed(parseCertificateFeed(bytes)), bytes);
  });

  it("answers exactly what the shipped tables answer", () => {
    // The point of the whole schema: a feed is not a second certification
    // authority, it is the same two lookups delivered as data.
    const tables = certifiedBuildTablesFromFeed(
      parseCertificateFeed(serializeCertificateFeed(bundledCertificateFeed())),
    );
    for (const build of TEMPLATE_SAVE_BUILDS) {
      assert.deepEqual(
        certifyClientBuild(build.sha256, tables),
        certifyClientBuild(build.sha256),
      );
    }
    assert.deepEqual(
      certifyClientBuild(UNKNOWN_CLIENT, tables),
      certifyClientBuild(UNKNOWN_CLIENT),
    );
    assert.deepEqual(certifyClientBuild(UNKNOWN_CLIENT, tables), {
      state: "uncertified",
    });
  });

  it("delivers enhancement facts only as the shipped table already states them", () => {
    // Nothing re-derives a layout word from the client bytes, so a well-formed
    // feed is the wrong place to learn one. Move an address the companion
    // kernel reads and the entry loses its enhancement half — and keeps
    // template saving, which is proved rather than asserted.
    const spoiled = document();
    const entries = spoiled["entries"] as Record<string, unknown>[];
    const carrying = entries.find((item) => item["enhancement"] !== null);
    assert.ok(carrying, "the bundled snapshot certifies at least one enhancement build");
    const layout = (carrying["enhancement"] as Record<string, unknown>)["layout"] as
      Record<string, number>;
    layout["cursorColorBuffer"] = layout["cursorColorBuffer"]! + 4;
    const officialSha256 = (carrying["templateSave"] as Record<string, string>)["sha256"]!;
    const tables = certifiedBuildTablesFromFeed(parseCertificateFeed(encode(spoiled)));
    assert.equal(certifyClientBuild(officialSha256).state, "certified");
    assert.equal(certifyClientBuild(officialSha256, tables).state, "template-only");
  });
});

describe("an unrecognised build behaves as it does today", () => {
  // Absent, forged and stale are three ways to end up with no fetched feed, and
  // all three have to land on the bundled snapshot rather than on nothing.
  const bundled = bundledCertificateFeed();
  const today = TEMPLATE_SAVE_BUILDS.map((build) => certifyClientBuild(build.sha256));

  const sameAsToday = (label: string, tables = certifiedBuildTablesFromFeed(bundled)) => {
    it(label, () => {
      assert.deepEqual(
        TEMPLATE_SAVE_BUILDS.map((build) => certifyClientBuild(build.sha256, tables)),
        today,
      );
      assert.deepEqual(certifyClientBuild(UNKNOWN_CLIENT, tables), {
        state: "uncertified",
      });
    });
  };

  sameAsToday("with no fetched feed at all");
  sameAsToday(
    "with a forged feed, which never became a feed",
    certifiedBuildTablesFromFeed(bundled),
  );
  sameAsToday(
    "with a stale feed, which did not replace the bundled one",
    certifiedBuildTablesFromFeed(
      governingCertificateFeed(bundled, { ...bundled, sequence: 0, entries: new Map() })
        .feed,
    ),
  );
});

describe("sequence", () => {
  const bundled = bundledCertificateFeed();

  it("accepts only a strictly newer feed", () => {
    const newer = { ...bundled, sequence: bundled.sequence + 1 };
    assert.deepEqual(governingCertificateFeed(bundled, newer), {
      feed: newer,
      accepted: true,
    });
  });

  it("refuses a regression, and refuses a replay of the same sequence", () => {
    for (const sequence of [0, bundled.sequence]) {
      const stale = { ...bundled, sequence, entries: new Map() };
      const chosen = governingCertificateFeed(bundled, stale);
      assert.equal(chosen.accepted, false);
      assert.equal(chosen.feed, bundled);
    }
  });

  it("must be an unsigned integer in the bytes", () => {
    for (const sequence of [-1, 1.5, "1", null, 2 ** 32]) {
      assert.match(
        refusal(encode({ ...document(), sequence })).message,
        /sequence must be an unsigned 32-bit integer/,
      );
    }
  });
});

describe("the certificate feed parser refuses", () => {
  it("an unknown field, at the top level and inside an entry", () => {
    assert.match(
      refusal(encode({ ...document(), extra: 1 })).message,
      /feed carries unknown field "extra"/,
    );
    // Spelled as text: an object literal's `__proto__` sets a prototype instead
    // of a field, and it is the field JSON.parse creates that has to be caught.
    const injected = `{"__proto__":1,${JSON.stringify(document()).slice(1)}`;
    assert.match(
      refusal(new TextEncoder().encode(injected)).message,
      /feed carries unknown field "__proto__"/,
    );

    const spoiled = document();
    const entry = firstEntry(spoiled);
    (entry["templateSave"] as Record<string, unknown>)["notes"] = "hello";
    assert.match(
      refusal(encode(spoiled)).message,
      /templateSave carries unknown field "notes"/,
    );
  });

  it("a missing field", () => {
    const spoiled = document();
    delete (firstEntry(spoiled)["templateSave"] as Record<string, unknown>)["carrierImport"];
    assert.match(refusal(encode(spoiled)).message, /carrierImport/);
  });

  it("bytes beyond the cap, before it looks at any of them", () => {
    const oversize = new Uint8Array(256 * 1024 + 1).fill(0x20);
    assert.match(refusal(oversize).message, /exceeds the 262144-byte cap/);
    assert.match(refusal(new Uint8Array(0)).message, /no bytes/);
  });

  it("more entries than the cap, before it parses one", () => {
    const spoiled = { ...document(), entries: Array.from({ length: 65 }, () => null) };
    assert.match(refusal(encode(spoiled)).message, /between 0 and 64 items/);
  });

  it("a format version it does not implement", () => {
    for (const formatVersion of [0, 2, "1", null]) {
      assert.match(
        refusal(encode({ ...document(), formatVersion })).message,
        /formatVersion must be 1/,
      );
    }
  });

  it("a non-canonical digest", () => {
    const spoiled = document();
    const templateSave = firstEntry(spoiled)["templateSave"] as Record<string, unknown>;
    const original = templateSave["sha256"];
    assert.equal(typeof original, "string");
    for (const sha256 of [(original as string).toUpperCase(), "abc", `${original as string}0`]) {
      templateSave["sha256"] = sha256;
      assert.match(refusal(encode(spoiled)).message, /must be a lower-case SHA-256 digest/);
    }
  });

  it("a non-canonical number", () => {
    const spoiled = document();
    const templateSave = firstEntry(spoiled)["templateSave"] as Record<string, unknown>;
    for (const importCount of [-1, 219.5, 2 ** 32, "219"]) {
      templateSave["importCount"] = importCount;
      assert.match(refusal(encode(spoiled)).message, /unsigned 32-bit integer/);
    }
    // `-0` cannot be written by JSON.stringify and can be read by JSON.parse,
    // so the only way to present it is as text.
    const negativeZero = JSON.stringify(document()).replace(
      '"importCount":219',
      '"importCount":-0',
    );
    assert.match(
      refusal(new TextEncoder().encode(negativeZero)).message,
      /importCount must be an unsigned 32-bit integer/,
    );
  });

  it("a bridge set that is not the closed five in order", () => {
    const spoiled = document();
    const templateSave = firstEntry(spoiled)["templateSave"] as Record<string, unknown>;
    const bridges = templateSave["bridges"];
    assert.ok(Array.isArray(bridges));

    templateSave["bridges"] = [...bridges].reverse();
    assert.match(refusal(encode(spoiled)).message, /kind must be "ensureDirectory"/);

    templateSave["bridges"] = bridges.slice(0, 4);
    assert.match(refusal(encode(spoiled)).message, /bridges must hold between 5 and 5/);

    templateSave["bridges"] = [...bridges, bridges[0]];
    assert.match(refusal(encode(spoiled)).message, /bridges must hold between 5 and 5/);
  });

  it("a stub body that is present but empty, which would match anything", () => {
    const spoiled = document();
    const templateSave = firstEntry(spoiled)["templateSave"] as Record<string, unknown>;
    const bridges = templateSave["bridges"];
    assert.ok(Array.isArray(bridges));
    (bridges[0] as Record<string, unknown>)["stubBody"] = [];
    assert.match(refusal(encode(spoiled)).message, /stubBody must hold between 1 and 256/);
  });

  it("an enhancement that is not keyed by the template-save output", () => {
    const spoiled = document();
    const entries = spoiled["entries"];
    assert.ok(Array.isArray(entries));
    const certified = entries.find(
      (entry) => (entry as Record<string, unknown>)["enhancement"] !== null,
    ) as Record<string, unknown>;
    (certified["enhancement"] as Record<string, unknown>)["sha256"] = "a".repeat(64);
    assert.match(
      refusal(encode(spoiled)).message,
      /not keyed by the template-save output hash/,
    );
  });

  it("an enhancement missing a certified capability profile", () => {
    const spoiled = document();
    const entries = spoiled["entries"];
    assert.ok(Array.isArray(entries));
    const certified = entries.find(
      (entry) => (entry as Record<string, unknown>)["enhancement"] !== null,
    ) as Record<string, unknown>;
    const enhancement = certified["enhancement"] as Record<string, unknown>;
    delete (enhancement["outputSha256"] as Record<string, unknown>)["cursorToolbox"];
    assert.match(refusal(encode(spoiled)).message, /cursorToolbox/);
  });

  it("entries that repeat or are out of ascending key order", () => {
    const spoiled = document();
    const entries = spoiled["entries"];
    assert.ok(Array.isArray(entries) && entries.length > 1);

    spoiled["entries"] = [...entries].reverse();
    assert.match(refusal(encode(spoiled)).message, /out of ascending key order or duplicated/);

    spoiled["entries"] = [entries[0], entries[0]];
    assert.match(refusal(encode(spoiled)).message, /out of ascending key order or duplicated/);
  });

  it("bytes that are not one canonical document", () => {
    assert.match(refusal(new TextEncoder().encode("[]")).message, /feed must be an object/);
    assert.match(refusal(new TextEncoder().encode("{")).message, /is not JSON/);
    assert.match(refusal(Uint8Array.of(0x7b, 0xff, 0x7d)).message, /is not UTF-8/);

    const withMark = new TextEncoder().encode(
      new TextDecoder().decode(serializeCertificateFeed(bundledCertificateFeed())),
    );
    assert.match(
      refusal(Uint8Array.from([0xef, 0xbb, 0xbf, ...withMark])).message,
      /carries a byte-order mark/,
    );
  });
});
