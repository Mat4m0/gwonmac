import { createHash } from "node:crypto";
import type { EnhancementLayout } from "./enhancement-builds.js";
import {
  indexOfBytes,
  paddedIndex,
  parseCode,
  sectionById,
  splitSections,
} from "./wasm-binary.js";

const STATIC_ADDRESS_FIELDS = Object.freeze([
  "contextRoot",
  "agentArray",
  "manualTargetAgentId",
  "automaticTargetAgentId",
  "cursorActiveArt",
  "cursorSoftwareModel",
  "cursorShowCount",
  "cursorColorBuffer",
] as const satisfies readonly (keyof EnhancementLayout)[]);

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Fingerprint every complete function body that refers to a measured static
 * address. Address immediates are tagged before hashing, so one common
 * relocation is ignored while every surrounding instruction remains exact.
 */
export function enhancementAddressEvidence(
  input: Uint8Array,
  layout: EnhancementLayout,
): string | null {
  let bodies: Uint8Array[];
  try {
    bodies = parseCode(sectionById(splitSections(input), 10));
  } catch {
    return null;
  }
  const needles = STATIC_ADDRESS_FIELDS.map((field, index) => ({
    field,
    tag: index + 1,
    bytes: paddedIndex(layout[field]),
  }));
  const counts = new Map<(typeof STATIC_ADDRESS_FIELDS)[number], number>();
  const evidence: { roles: string[]; bodySha256: string }[] = [];

  for (const body of bodies) {
    const normalized = body.slice();
    const roles: string[] = [];
    for (const needle of needles) {
      for (let at = indexOfBytes(body, needle.bytes, 0); at >= 0;) {
        normalized.fill(0, at, at + needle.bytes.byteLength);
        normalized[at] = needle.tag;
        roles.push(`${needle.field}:${at}`);
        counts.set(needle.field, (counts.get(needle.field) ?? 0) + 1);
        at = indexOfBytes(body, needle.bytes, at + needle.bytes.byteLength);
      }
    }
    if (roles.length > 0) {
      evidence.push({
        roles: roles.sort(),
        bodySha256: sha256(normalized),
      });
    }
  }
  if (STATIC_ADDRESS_FIELDS.some((field) => !counts.has(field))) return null;
  evidence.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return sha256(JSON.stringify(evidence));
}
