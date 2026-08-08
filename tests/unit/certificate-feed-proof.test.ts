// The security invariant of the whole feed, executed: a certificate is a
// proposal, and the transforms already in this application are what decide
// whether it enables anything. The signature is deliberately absent from these
// cases — every entry here is treated as perfectly signed, because a valid
// signature is exactly the situation in which the local proof has to be the
// thing that says no.
//
// The client is synthetic: one carrier import and the five certified stubs,
// each reached through the padded call the transform patches. That is the whole
// shape `rewriteTemplateSaveWasm` certifies, so a refusal here is the real
// transform refusing and not a stand-in for it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { CertificateFeedEntry } from "../../src/main/certification/certificate-feed.ts";
import { proveCertificateFeedEntry } from "../../src/main/certification/certificate-feed-proof.ts";
import {
  ENHANCEMENT_BUILDS,
  enhancementOutputSha256,
} from "../../src/main/certification/enhancement-builds.ts";
import { ENHANCEMENT_CAPABILITY_PROFILES } from "../../src/shared/enhancement-contracts.ts";
import {
  rewriteTemplateSaveWasm,
  type KnownTemplateSaveBuild,
} from "../../src/main/certification/template-save-compat.ts";

function uleb(value: number): number[] {
  const output: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest) byte |= 0x80;
    output.push(byte);
  } while (rest);
  return output;
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

/** The width LLVM uses for call targets, which the transform patches in place. */
function paddedCall(index: number): number[] {
  const bytes = [0x10];
  let rest = index;
  for (let position = 0; position < 5; position += 1) {
    bytes.push((rest & 0x7f) | (position === 4 ? 0 : 0x80));
    rest >>>= 7;
  }
  return bytes;
}

const IMPORT_COUNT = 1;
const CARRIER_IMPORT = 0;

/**
 * The five stubs in `BRIDGE_KINDS` order: local function index, the type it is
 * declared with, its body, and how many arguments a caller pushes.
 * `fileExists` carries no body claim, exactly as the shipped entry does — there
 * the call site's own target index is the certification.
 */
const STUBS = [
  { kind: "ensureDirectory", type: 0, args: 2, body: [0x00, 0x41, 0x02, 0x0b], results: 1 },
  { kind: "findFiles", type: 1, args: 3, body: [0x00, 0x0b], results: 0 },
  { kind: "fileBaseName", type: 2, args: 6, body: [0x00, 0x41, 0x00, 0x0b], results: 1 },
  { kind: "deleteFile", type: 3, args: 1, body: [0x00, 0x41, 0x00, 0x0b], results: 1 },
  { kind: "fileExists", type: 4, args: 3, body: [0x00, 0x41, 0x00, 0x0b], results: 1 },
] as const;

const TYPES = section(1, [
  6,
  0x60, 2, 0x7f, 0x7f, 1, 0x7f, // (i32, i32) -> i32
  0x60, 3, 0x7f, 0x7f, 0x7f, 0, // (i32, i32, i32) -> ()
  0x60, 6, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f,
  0x60, 1, 0x7f, 1, 0x7f, // (i32) -> i32
  0x60, 3, 0x7f, 0x7f, 0x7f, 1, 0x7f, // (i32, i32, i32) -> i32
  0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f, // the carrier import
]);
const CARRIER_TYPE = 5;
const CALLER_TYPE = 1;

/** One caller reaching all five stubs, and the body offset of each call. */
function caller(): { body: number[]; offsets: number[] } {
  const body = [0x00];
  const offsets: number[] = [];
  for (const [index, stub] of STUBS.entries()) {
    for (let argument = 0; argument < stub.args; argument += 1) body.push(0x41, 0x00);
    offsets.push(body.length);
    body.push(...paddedCall(IMPORT_COUNT + index));
    if (stub.results === 1) body.push(0x1a);
  }
  body.push(0x0b);
  return { body, offsets };
}

function client(): { bytes: Uint8Array; offsets: number[] } {
  const { body, offsets } = caller();
  const bodies = [...STUBS.map((stub) => [...stub.body]), body];
  const bytes = Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...TYPES,
    ...section(2, [1, 1, 109, 1, 97, 0, CARRIER_TYPE]),
    ...section(3, [
      bodies.length,
      ...STUBS.map((stub) => stub.type),
      CALLER_TYPE,
    ]),
    ...section(10, [
      bodies.length,
      ...bodies.flatMap((item) => [...uleb(item.length), ...item]),
    ]),
  ]);
  return { bytes, offsets };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const CLIENT = client();

function draft(): KnownTemplateSaveBuild {
  return {
    sha256: sha256(CLIENT.bytes),
    outputSha256: "0".repeat(64),
    importCount: IMPORT_COUNT,
    carrierImport: CARRIER_IMPORT,
    bridges: STUBS.map((stub, index) => ({
      kind: stub.kind,
      stubFunction: index,
      ...(stub.kind === "fileExists" ? {} : { stubBody: [...stub.body] }),
      callSites: [{ localFunction: STUBS.length, bodyOffset: CLIENT.offsets[index]! }],
    })),
  };
}

/** Learn the derived hash the way a new client build would be certified. */
function certified(): KnownTemplateSaveBuild {
  const build = draft();
  try {
    rewriteTemplateSaveWasm(CLIENT.bytes, build);
  } catch (error) {
    const found = /unexpected output ([0-9a-f]{64})/.exec(
      error instanceof Error ? error.message : "",
    );
    if (found) return { ...build, outputSha256: found[1]! };
  }
  return assert.fail("the synthetic client did not produce a derived module");
}

const TEMPLATE_SAVE = certified();

const entry = (over: Partial<CertificateFeedEntry> = {}): CertificateFeedEntry => ({
  templateSave: TEMPLATE_SAVE,
  enhancement: null,
  ...over,
});

describe("a certificate the feed proposes", () => {
  it("enables what the transform reproduces, and says what it withheld", () => {
    const proof = proveCertificateFeedEntry(entry(), CLIENT.bytes);
    assert.deepEqual(proof, {
      certification: { state: "template-only", templateSaveBuild: TEMPLATE_SAVE },
      withheld: ["enhancement-layout-changed"],
    });
  });

  it("enables nothing when the stub it names is not the stub that is there", () => {
    const bridges = TEMPLATE_SAVE.bridges.map((bridge, index) =>
      index === 0 ? { ...bridge, stubBody: [0x00, 0x41, 0x09, 0x0b] } : bridge);
    assert.deepEqual(
      proveCertificateFeedEntry(
        entry({ templateSave: { ...TEMPLATE_SAVE, bridges } }),
        CLIENT.bytes,
      ),
      { certification: { state: "uncertified" }, withheld: ["template-transform-failed"] },
    );
  });

  it("enables nothing when the call site it names is somewhere else", () => {
    const bridges = TEMPLATE_SAVE.bridges.map((bridge, index) =>
      index === 0
        ? { ...bridge, callSites: [{ localFunction: STUBS.length, bodyOffset: 1 }] }
        : bridge);
    assert.deepEqual(
      proveCertificateFeedEntry(
        entry({ templateSave: { ...TEMPLATE_SAVE, bridges } }),
        CLIENT.bytes,
      ),
      { certification: { state: "uncertified" }, withheld: ["template-transform-failed"] },
    );
  });

  it("enables nothing when the derived hash it claims is not the hash produced", () => {
    // The signature says the key holder wrote this. The transform says the
    // bytes disagree, and the bytes win.
    assert.deepEqual(
      proveCertificateFeedEntry(
        entry({ templateSave: { ...TEMPLATE_SAVE, outputSha256: "b".repeat(64) } }),
        CLIENT.bytes,
      ),
      { certification: { state: "uncertified" }, withheld: ["template-transform-failed"] },
    );
  });

  it("enables nothing for a client it does not describe", () => {
    assert.deepEqual(
      proveCertificateFeedEntry(entry(), Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0])),
      { certification: { state: "uncertified" }, withheld: ["template-transform-failed"] },
    );
  });

  it("enables nothing at all for bytes that are not WebAssembly", () => {
    assert.deepEqual(
      proveCertificateFeedEntry(entry(), new TextEncoder().encode("not a module")),
      { certification: { state: "uncertified" }, withheld: ["invalid-wasm"] },
    );
  });

  it("has a hash to compare against for every certified capability profile", () => {
    // The proof withholds the enhancement half unless each profile's derived
    // hash matches the entry. A profile whose recorded hash could not be read
    // back would make that comparison refuse for ever and turn the accepting
    // branch into dead code, which no refusal case above would notice.
    for (const build of ENHANCEMENT_BUILDS) {
      for (const [profile, capabilities] of Object.entries(
        ENHANCEMENT_CAPABILITY_PROFILES,
      )) {
        assert.equal(
          enhancementOutputSha256(build, capabilities),
          build.outputSha256[profile as keyof typeof build.outputSha256],
        );
      }
    }
  });

  it("withholds enhancement facts the shipped table does not already certify", () => {
    // A well-formed entry — it is keyed by the template-save output the schema
    // demands — proposing enhancement for a build no release has certified.
    // The template transform re-derives its own claims, so template saving
    // survives; the layout words have no such anchor, so they never arrive.
    const enhancement = {
      ...ENHANCEMENT_BUILDS[0]!,
      sha256: TEMPLATE_SAVE.outputSha256,
    };
    assert.deepEqual(proveCertificateFeedEntry(entry({ enhancement }), CLIENT.bytes), {
      certification: { state: "template-only", templateSaveBuild: TEMPLATE_SAVE },
      withheld: ["enhancement-layout-changed"],
    });
  });

  it("withholds an address the signer chose rather than the table recorded", () => {
    // The attack the exact-restatement rule exists for: a certified build's
    // record with one client-memory address moved, and an `outputSha256` the
    // key holder computed over that module. The transform would reproduce that
    // hash, so only refusing the record itself stops the companion kernel being
    // pointed somewhere else in client memory.
    const certified = ENHANCEMENT_BUILDS[0]!;
    const enhancement = {
      ...certified,
      layout: { ...certified.layout, cursorColorBuffer: certified.layout.cursorColorBuffer + 4 },
    };
    assert.deepEqual(proveCertificateFeedEntry(entry({ enhancement }), CLIENT.bytes), {
      certification: { state: "template-only", templateSaveBuild: TEMPLATE_SAVE },
      withheld: ["enhancement-layout-changed"],
    });
  });

  it("keeps template save when only the enhancement half fails its proof", () => {
    // The certified record verbatim, so it passes the restatement rule, against
    // a client that is not the one it was measured on. Only a parser refuses
    // that pairing over the schema; the proof must refuse it over the bytes.
    assert.deepEqual(
      proveCertificateFeedEntry(entry({ enhancement: ENHANCEMENT_BUILDS[0]! }), CLIENT.bytes),
      {
        certification: { state: "template-only", templateSaveBuild: TEMPLATE_SAVE },
        withheld: ["enhancement-transform-failed"],
      },
    );
  });
});
