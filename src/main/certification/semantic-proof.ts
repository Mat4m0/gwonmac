/**
 * Shared vocabulary and limits for feature-local semantic proofs.
 *
 * These primitives grant no capability. A feature verifier must still own its
 * semantic anchors and production transform. This file only makes three safety
 * rules hard to bypass: every verdict is input/ABI bound, every layout field
 * has a named witness, and byte canonicalization can hide only explicit,
 * non-overlapping relocation operands.
 */
import { createHash } from "node:crypto";

export const SEMANTIC_VERIFIER_ABI = 6;

export type ProofRefusal = Readonly<{
  inputSha256: string;
  verifierAbi: number;
  invariant: string;
}>;

export type ProofVerdict<Value> =
  | Readonly<{
      status: "proved";
      inputSha256: string;
      verifierAbi: number;
      value: Value;
    }>
  | (Readonly<{ status: "changed" }> & ProofRefusal)
  | (Readonly<{ status: "ambiguous"; candidates: number }> & ProofRefusal);

export type AddressClass =
  | "function-index"
  | "immutable-data"
  | "mutable-static";

export type FieldWitness = Readonly<{
  sourceRole: string;
  expression: string;
  occurrences: readonly number[];
}>;

/** Adding a layout field makes every witness ledger a TypeScript error. */
export type FieldWitnesses<Layout extends Readonly<Record<string, number>>> = {
  readonly [Field in keyof Layout]: FieldWitness;
};

export type VerifiedLayout<Layout extends Readonly<Record<string, number>>> =
  Readonly<{
    layout: Layout;
    witnesses: FieldWitnesses<Layout>;
  }>;

function exactOwnKeys(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]);
}

export function verifyLayout<Layout extends Readonly<Record<string, number>>>(
  layout: Layout,
  witnesses: FieldWitnesses<Layout>,
): VerifiedLayout<Layout> {
  if (!exactOwnKeys(layout, witnesses)) {
    throw new Error("semantic proof: layout witness keys do not match");
  }
  for (const [field, value] of Object.entries(layout)) {
    const witness = witnesses[field]!;
    if (
      !Number.isSafeInteger(value)
      || !witness.sourceRole
      || !witness.expression
      || witness.occurrences.length === 0
      || !witness.occurrences.every(
        (occurrence) => Number.isSafeInteger(occurrence) && occurrence >= 0,
      )
    ) {
      throw new Error(`semantic proof: invalid witness for ${field}`);
    }
  }
  return Object.freeze({
    layout: Object.freeze({ ...layout }),
    witnesses: Object.freeze({ ...witnesses }),
  });
}

export class ProofLimitError extends Error {
  readonly limit: string;

  constructor(limit: string) {
    super(`semantic proof: ${limit} limit exceeded`);
    this.limit = limit;
  }
}

export class ProofBudget {
  #remaining: number;
  readonly limit: number;

  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error("semantic proof: invalid analysis limit");
    }
    this.limit = limit;
    this.#remaining = limit;
  }

  spend(units = 1): void {
    if (!Number.isSafeInteger(units) || units < 0) {
      throw new Error("semantic proof: invalid analysis cost");
    }
    if (units > this.#remaining) throw new ProofLimitError("analysis-work");
    this.#remaining -= units;
  }
}

export type RelocationSpan = Readonly<{
  start: number;
  end: number;
  addressClass: AddressClass;
  role: string;
}>;

const text = new TextEncoder();

/**
 * Hash bytes while replacing only caller-supplied relocation operands with a
 * typed role marker. Branches, opcodes, call order, cardinality, constants,
 * and every byte outside those operands remain exact.
 */
export function relocationAwareFingerprint(
  bytes: Uint8Array,
  spans: readonly RelocationSpan[],
  budget = new ProofBudget(4_096),
): string {
  const ordered = [...spans].sort((left, right) => left.start - right.start);
  const hash = createHash("sha256");
  let cursor = 0;
  for (const span of ordered) {
    budget.spend();
    if (
      !span.role
      || !Number.isSafeInteger(span.start)
      || !Number.isSafeInteger(span.end)
      || span.start < cursor
      || span.end <= span.start
      || span.end > bytes.byteLength
    ) {
      throw new Error("semantic proof: invalid or overlapping relocation span");
    }
    hash.update(bytes.subarray(cursor, span.start));
    hash.update(text.encode(`\0${span.addressClass}:${span.role}\0`));
    cursor = span.end;
  }
  hash.update(bytes.subarray(cursor));
  return hash.digest("hex");
}
