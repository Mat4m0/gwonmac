/**
 * Review-only structural diagnostics that never grant launch authority.
 * Runtime decisions live in the feature proof modules.
 */
import { createHash } from "node:crypto";
import {
  enhancementProofContext,
  EvidenceError,
  functionBodySha256,
  functionHasSignature,
  MAX_CONSIDERED,
  MAX_INPUT_BYTES,
  signatureEvidence,
} from "./enhancement-wasm-proof-context.js";
import type { EnhancementProofContext } from "./enhancement-wasm-proof-context.js";
import type {
  CursorConsideration,
  CursorEvidenceReport,
  DecodedFunction,
  EnhancementEvidenceFailure,
  EnhancementStructuralEvidenceReport,
  MessageProducerEvidence,
  ModuleShape,
  PlayerChatMessageAnchors,
  PlayerChatUiConsideration,
  PlayerChatUiEvidenceReport,
  TickEvidenceReport,
} from "./enhancement-evidence-types.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

function unavailableTick(): TickEvidenceReport {
  return { status: "unavailable", exportCount: 0, considered: [], candidate: null };
}

function unavailableUi(): PlayerChatUiEvidenceReport {
  return { status: "unavailable", considered: [], candidate: null };
}

function unavailableCursor(): CursorEvidenceReport {
  return { status: "unavailable", considered: [], candidate: null };
}

function baseReport(
  sha256: string,
  validWasm: boolean,
  failure: EnhancementEvidenceFailure,
): EnhancementStructuralEvidenceReport {
  return {
    sha256,
    validWasm,
    failures: [failure],
    tick: unavailableTick(),
    playerChatUi: unavailableUi(),
    cursor: unavailableCursor(),
  };
}

export function messageRelations(
  decoded: readonly DecodedFunction[],
  target: number,
  message: number,
): MessageProducerEvidence[] {
  return decoded
    .filter(
      (producer) =>
        (producer.messageSites[message] ?? 0) > 0
        && (producer.calls.get(target) ?? 0) > 0,
    )
    .map((producer) => ({
      producerFunctionIndex: producer.functionIndex,
      messageSites: producer.messageSites[message] ?? 0,
      directCallSites: producer.calls.get(target) ?? 0,
    }));
}

function exactPlayerChatProducer(
  relations: readonly MessageProducerEvidence[],
): MessageProducerEvidence[] {
  return relations.filter(
    (relation) =>
      relation.messageSites === 3
      && relation.directCallSites === 3,
  );
}

export function playerChatUiEvidence(
  module: ModuleShape,
  decoded: readonly DecodedFunction[],
  messageAnchors: PlayerChatMessageAnchors,
): PlayerChatUiEvidenceReport {
  const playerChatMessage = messageAnchors.playerChatMessage;
  const [nearby7fMessage, nearby80Message] =
    messageAnchors.nearbyPlayerMessages;
  const relevantTargets = new Set<number>();
  for (const producer of decoded) {
    if (
      (producer.messageSites[playerChatMessage] ?? 0) === 0
      && (producer.messageSites[nearby7fMessage] ?? 0) === 0
      && (producer.messageSites[nearby80Message] ?? 0) === 0
    ) {
      continue;
    }
    for (const target of producer.calls.keys()) relevantTargets.add(target);
  }
  if (relevantTargets.size > MAX_CONSIDERED) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  const considered = [...relevantTargets]
    .sort((left, right) => left - right)
    .map((dispatcherFunctionIndex): PlayerChatUiConsideration => ({
      dispatcherFunctionIndex,
      signature: signatureEvidence(module, dispatcherFunctionIndex),
      signatureMatches: functionHasSignature(module, dispatcherFunctionIndex, 3),
      playerChat: messageRelations(
        decoded,
        dispatcherFunctionIndex,
        playerChatMessage,
      ),
      nearby7f: messageRelations(
        decoded,
        dispatcherFunctionIndex,
        nearby7fMessage,
      ),
      nearby80: messageRelations(
        decoded,
        dispatcherFunctionIndex,
        nearby80Message,
      ),
    }))
    .filter(
      (candidate) =>
        candidate.signatureMatches
        || candidate.playerChat.some(
          (relation) =>
            relation.messageSites >= 3
            || relation.directCallSites >= 3,
        ),
    );
  const candidates = considered.filter(
    (candidate) =>
      candidate.signatureMatches
      && exactPlayerChatProducer(candidate.playerChat).length === 1
      && candidate.nearby7f.length > 0
      && candidate.nearby80.length > 0,
  );
  if (candidates.length === 1) {
    const candidate = candidates[0]!;
    return {
      status: "candidate",
      considered,
      candidate: {
        dispatcherFunctionIndex: candidate.dispatcherFunctionIndex,
        playerChatProducerFunctionIndex:
          exactPlayerChatProducer(candidate.playerChat)[0]!
            .producerFunctionIndex,
        nearby7fProducerFunctionIndices: candidate.nearby7f.map(
          (relation) => relation.producerFunctionIndex,
        ),
        nearby80ProducerFunctionIndices: candidate.nearby80.map(
          (relation) => relation.producerFunctionIndex,
        ),
      },
    };
  }
  return {
    status: candidates.length > 1 ? "ambiguous" : "unavailable",
    considered,
    candidate: null,
  };
}


function cursorEvidence(
  module: ModuleShape,
  decoded: readonly DecodedFunction[],
  tableRelations: ReadonlyMap<number, readonly number[]>,
): CursorEvidenceReport {
  const callers = new Map<number, Map<number, number>>();
  for (const producer of decoded) {
    for (const [target, sites] of producer.calls) {
      const targetCallers = callers.get(target) ?? new Map<number, number>();
      targetCallers.set(producer.functionIndex, sites);
      callers.set(target, targetCallers);
    }
  }
  const considered: CursorConsideration[] = [];
  for (
    let targetFunctionIndex = 0;
    targetFunctionIndex < module.functionTypeIndices.length;
    targetFunctionIndex += 1
  ) {
    if (!functionHasSignature(module, targetFunctionIndex, 5)) continue;
    const targetCallers = callers.get(targetFunctionIndex) ?? new Map();
    const activeTableSlots = [...(tableRelations.get(targetFunctionIndex) ?? [])];
    if (targetCallers.size === 0 && activeTableSlots.length === 0) continue;
    const directProducers = [...targetCallers]
      .sort(([left], [right]) => left - right)
      .map(([producerFunctionIndex, directCallSites]) => ({
        producerFunctionIndex,
        directCallSites,
      }));
    if (directProducers.length !== 2 && activeTableSlots.length === 0) continue;
    considered.push({
      targetFunctionIndex,
      directCallSites: directProducers.reduce(
        (sum, producer) => sum + producer.directCallSites,
        0,
      ),
      directProducers,
      activeTableSlots,
    });
  }
  if (considered.length > MAX_CONSIDERED) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  const producerShape = considered.filter(
    (candidate) =>
      candidate.directProducers.length === 2
      && candidate.directCallSites === 2,
  );
  const candidates = producerShape.filter(
    (candidate) => candidate.activeTableSlots.length === 1,
  );
  if (candidates.length === 1) {
    const candidate = candidates[0]!;
    return {
      status: "candidate",
      considered,
      candidate: {
        targetFunctionIndex: candidate.targetFunctionIndex,
        producerFunctionIndices: [
          candidate.directProducers[0]!.producerFunctionIndex,
          candidate.directProducers[1]!.producerFunctionIndex,
        ],
        activeTableSlot: candidate.activeTableSlots[0]!,
        bodySha256: functionBodySha256(module, candidate.targetFunctionIndex),
        producerBodySha256: [
          functionBodySha256(module, candidate.directProducers[0]!.producerFunctionIndex),
          functionBodySha256(module, candidate.directProducers[1]!.producerFunctionIndex),
        ],
      },
    };
  }
  const relationIsAmbiguous = producerShape.some(
    (candidate) => candidate.activeTableSlots.length > 1,
  );
  return {
    status: candidates.length > 1 || relationIsAmbiguous
      ? "ambiguous"
      : "unavailable",
    considered,
    candidate: null,
  };
}

/**
 * Recovers only the three independently reviewable hook boundaries. It never
 * infers source anchors, memory layouts, message names, or a launch policy.
 */
export function inspectEnhancementStructuralEvidence(
  input: Uint8Array,
  messageAnchors: PlayerChatMessageAnchors,
  suppliedContext?: EnhancementProofContext,
): EnhancementStructuralEvidenceReport {
  const sha256 = createHash("sha256").update(input).digest("hex");
  if (input.byteLength > MAX_INPUT_BYTES) {
    return baseReport(sha256, false, "input-too-large");
  }
  let validWasm: boolean;
  try {
    validWasm = WebAssembly.validate(input);
  } catch {
    validWasm = false;
  }
  if (!validWasm) return baseReport(sha256, false, "invalid-wasm");

  let module: ModuleShape;
  let context: EnhancementProofContext;
  try {
    const candidate = suppliedContext?.inputIdentity === input
      ? suppliedContext
      : enhancementProofContext(input);
    if (!candidate) throw new EvidenceError("module-shape-unsupported");
    context = candidate;
    module = context.module;
  } catch (error) {
    const failure = error instanceof EvidenceError
      ? error.code
      : "module-shape-unsupported";
    return baseReport(sha256, true, failure);
  }
  const tick = context.tick;
  let decoded: DecodedFunction[];
  try {
    decoded = context.decodeFunctions(messageAnchors);
  } catch (error) {
    const failure = error instanceof EvidenceError
      ? error.code
      : "instruction-set-unsupported";
    return {
      sha256,
      validWasm: true,
      failures: [failure],
      tick,
      playerChatUi: unavailableUi(),
      cursor: unavailableCursor(),
    };
  }

  let playerChatUi: PlayerChatUiEvidenceReport;
  try {
    playerChatUi = playerChatUiEvidence(module, decoded, messageAnchors);
  } catch (error) {
    const failure = error instanceof EvidenceError
      ? error.code
      : "analysis-limit-exceeded";
    return {
      sha256,
      validWasm: true,
      failures: [failure],
      tick,
      playerChatUi: unavailableUi(),
      cursor: unavailableCursor(),
    };
  }

  try {
    const tableRelations = context.tableRelations;
    return {
      sha256,
      validWasm: true,
      failures: [],
      tick,
      playerChatUi,
      cursor: cursorEvidence(module, decoded, tableRelations),
    };
  } catch (error) {
    const failure = error instanceof EvidenceError
      ? error.code
      : "active-table-unsupported";
    return {
      sha256,
      validWasm: true,
      failures: [failure],
      tick,
      playerChatUi,
      cursor: unavailableCursor(),
    };
  }
}
