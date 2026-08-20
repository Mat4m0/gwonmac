import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ProofBudget,
  ProofLimitError,
  relocationAwareFingerprint,
  verifyLayout,
  type FieldWitnesses,
  type ProofVerdict,
} from "../../src/main/certification/semantic-proof.js";

describe("semantic proof primitives", () => {
  it("binds every verdict to one input and verifier ABI", () => {
    const verdict: ProofVerdict<{ functionIndex: number }> = {
      status: "proved",
      inputSha256: "a".repeat(64),
      verifierAbi: 1,
      value: { functionIndex: 42 },
    };
    assert.equal(verdict.inputSha256, "a".repeat(64));
    assert.equal(verdict.verifierAbi, 1);
  });

  it("requires an exact, non-empty witness ledger", () => {
    const layout = { root: 12, field: 20 } as const;
    const witnesses = {
      root: { sourceRole: "reader", expression: "global + 12", occurrences: [4] },
      field: { sourceRole: "writer", expression: "object + 20", occurrences: [9] },
    } satisfies FieldWitnesses<typeof layout>;
    assert.deepEqual(verifyLayout(layout, witnesses).layout, layout);
    const overbroad = { ...witnesses, extra: witnesses.root };
    assert.throws(
      () => verifyLayout(layout, overbroad),
      /witness keys do not match/,
    );
    assert.throws(
      () => verifyLayout(layout, {
        ...witnesses,
        field: { ...witnesses.field, occurrences: [] },
      }),
      /invalid witness for field/,
    );
  });

  it("canonicalizes only explicit relocation operands", () => {
    const baseline = Uint8Array.of(0x10, 1, 0x41, 10, 0x0b);
    const relocated = Uint8Array.of(0x10, 9, 0x41, 10, 0x0b);
    const spans = [{
      start: 1,
      end: 2,
      addressClass: "function-index" as const,
      role: "unique callback",
    }];
    assert.equal(
      relocationAwareFingerprint(baseline, spans),
      relocationAwareFingerprint(relocated, spans),
    );
    const changedBranch = Uint8Array.of(0x0c, 9, 0x41, 10, 0x0b);
    assert.notEqual(
      relocationAwareFingerprint(baseline, spans),
      relocationAwareFingerprint(changedBranch, spans),
    );
    assert.throws(
      () => relocationAwareFingerprint(baseline, [
        spans[0]!,
        { ...spans[0]!, role: "duplicate" },
      ]),
      /overlapping relocation span/,
    );
  });

  it("fails closed at the analysis ceiling", () => {
    const budget = new ProofBudget(1);
    budget.spend();
    assert.throws(() => budget.spend(), ProofLimitError);
    assert.throws(() => new ProofBudget(-1), /invalid analysis limit/);
  });
});
