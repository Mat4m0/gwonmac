/**
 * The local-proof rule: a certificate a feed proposes enables nothing until the
 * transforms already in this application reproduce it against the client bytes
 * on this machine.
 *
 * This is what keeps a compromised feed key from being a code-execution key.
 * The feed carries no instructions, so the worst a forged entry can say is
 * "rewrite these call sites, and the result will hash to this". The template
 * transform re-checks every stub body and call-site signature and refuses
 * unless its own output hashes to the entry's claim. Nothing derived is
 * published unless the bytes agree, so the key holder can withhold a
 * certificate — deny service — and cannot mint one for a transform that does
 * something else.
 *
 * The enhancement half is held to a different rule, because it is not equally
 * re-derivable: `certifiedEnhancementFromFeed` accepts it only as an exact
 * restatement of the shipped table, and owns the reason. What remains here is
 * the byte proof — the enhancement transform is run once per certified
 * capability profile and each output hash is compared to the record's, so a
 * table entry that does not reproduce against *these* client bytes still
 * withholds enhancement instead of enabling it.
 *
 * All four profiles are proved, not the one this session happens to want,
 * because the whole `outputSha256` record is what the derived-artifact cache
 * later treats as the expected result. An unproved hash in that record is
 * exactly the fact a forged feed would want accepted.
 *
 * The answer is a `ClientCertification` — the same three states the rest of the
 * chain speaks — plus the reasons anything was withheld, drawn from the local
 * verifier's vocabulary so a refusal reads the same whether the proof ran here
 * or in the isolated process. This module owns no signature check, no schema,
 * and no file.
 */
import { createHash } from "node:crypto";
import { ENHANCEMENT_CAPABILITY_PROFILES } from "../../shared/contracts.js";
import {
  certifiedEnhancementFromFeed,
  type CertificateFeedEntry,
} from "./certificate-feed.js";
import type { ClientCertification } from "./client-module.js";
import { enhancementOutputSha256 } from "./enhancement-builds.js";
import { transformEnhancementWasm } from "./enhancement-transform.js";
import type { LocalVerificationReason } from "./local-client-verifier.js";
import { rewriteTemplateSaveWasm } from "./template-save-compat.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export interface CertificateFeedProof {
  readonly certification: ClientCertification;
  /** Empty only when every fact the entry carried was reproduced. */
  readonly withheld: readonly LocalVerificationReason[];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function refused(reason: LocalVerificationReason): CertificateFeedProof {
  return { certification: { state: "uncertified" }, withheld: [reason] };
}

/**
 * Proves one entry against the official client bytes it claims to describe.
 * The caller looks the entry up by the client's own hash; a mismatch is left to
 * the template transform, which refuses an input it was not certified for.
 */
export function proveCertificateFeedEntry(
  entry: CertificateFeedEntry,
  official: Uint8Array,
): CertificateFeedProof {
  if (!WebAssembly.validate(official)) return refused("invalid-wasm");

  let templateOutput: Uint8Array;
  try {
    templateOutput = rewriteTemplateSaveWasm(official, entry.templateSave);
  } catch {
    return refused("template-transform-failed");
  }

  const templateOnly: CertificateFeedProof = {
    certification: {
      state: "template-only",
      templateSaveBuild: entry.templateSave,
    },
    withheld: ["enhancement-layout-changed"],
  };
  const enhancement = certifiedEnhancementFromFeed(entry);
  if (enhancement === null) return templateOnly;

  for (const capabilities of Object.values(ENHANCEMENT_CAPABILITY_PROFILES)) {
    let derived: Uint8Array;
    try {
      derived = transformEnhancementWasm(templateOutput, enhancement, capabilities);
    } catch {
      return {
        certification: templateOnly.certification,
        withheld: ["enhancement-transform-failed"],
      };
    }
    if (enhancementOutputSha256(enhancement, capabilities) !== sha256(derived)) {
      return {
        certification: templateOnly.certification,
        withheld: ["enhancement-transform-failed"],
      };
    }
  }

  return {
    certification: {
      state: "certified",
      templateSaveBuild: entry.templateSave,
      enhancementBuild: enhancement,
    },
    withheld: [],
  };
}
