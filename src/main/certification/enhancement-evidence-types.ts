/**
 * Closed evidence and location contracts shared by Enhancement proof modules.
 * The contracts carry facts but grant no capability.
 */
import type { FunctionType } from "../core/wasm-binary.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import type { RelocationSpan } from "./semantic-proof.js";
import type {
  EnhancementCursorLayout,
  EnhancementObservationBaseLayout,
  EnhancementTargetLayout,
} from "../../shared/enhancement-config.js";

export type EnhancementEvidenceStatus =
  | "candidate"
  | "ambiguous"
  | "unavailable";

export type EnhancementEvidenceFailure =
  | "input-too-large"
  | "invalid-wasm"
  | "module-shape-unsupported"
  | "instruction-set-unsupported"
  | "analysis-limit-exceeded"
  | "active-table-unsupported";

export interface FunctionSignatureEvidence {
  readonly params: string[];
  readonly results: string[];
}

export interface TickEvidenceReport {
  readonly status: EnhancementEvidenceStatus;
  readonly exportCount: number;
  readonly considered: Array<{
    readonly functionIndex: number;
    readonly signature: FunctionSignatureEvidence | null;
  }>;
  readonly candidate: {
    readonly functionIndex: number;
    readonly signature: FunctionSignatureEvidence;
    readonly bodySha256: string;
  } | null;
}

export interface MessageProducerEvidence {
  readonly producerFunctionIndex: number;
  readonly messageSites: number;
  readonly directCallSites: number;
}

export interface PlayerChatUiConsideration {
  readonly dispatcherFunctionIndex: number;
  readonly signature: FunctionSignatureEvidence | null;
  readonly signatureMatches: boolean;
  readonly playerChat: MessageProducerEvidence[];
  readonly nearby7f: MessageProducerEvidence[];
  readonly nearby80: MessageProducerEvidence[];
}

export interface PlayerChatUiEvidenceReport {
  readonly status: EnhancementEvidenceStatus;
  readonly considered: PlayerChatUiConsideration[];
  readonly candidate: {
    readonly dispatcherFunctionIndex: number;
    readonly playerChatProducerFunctionIndex: number;
    readonly nearby7fProducerFunctionIndices: number[];
    readonly nearby80ProducerFunctionIndices: number[];
  } | null;
}

export interface PlayerChatMessageAnchors {
  readonly playerChatMessage: number;
  readonly nearbyPlayerMessages: readonly [number, number];
}

export interface CursorConsideration {
  readonly targetFunctionIndex: number;
  readonly directCallSites: number;
  readonly directProducers: Array<{
    readonly producerFunctionIndex: number;
    readonly directCallSites: number;
  }>;
  readonly activeTableSlots: number[];
}

export interface CursorEvidenceReport {
  readonly status: EnhancementEvidenceStatus;
  readonly considered: CursorConsideration[];
  readonly candidate: {
    readonly targetFunctionIndex: number;
    readonly producerFunctionIndices: [number, number];
    readonly activeTableSlot: number;
    readonly bodySha256: string;
    readonly producerBodySha256: [string, string];
  } | null;
}

export interface EnhancementStructuralEvidenceReport {
  readonly sha256: string;
  readonly validWasm: boolean;
  readonly failures: EnhancementEvidenceFailure[];
  readonly tick: TickEvidenceReport;
  readonly playerChatUi: PlayerChatUiEvidenceReport;
  readonly cursor: CursorEvidenceReport;
}

export interface AutomaticCursorLocation {
  readonly baseline: KnownEnhancementBuild;
  readonly hookFunction: number;
  readonly hookBodySha256: string;
  readonly cursorFunction: number;
  readonly cursorTableSlot: number;
  readonly producerFunctions: readonly [number, number];
  readonly producerBodySha256: readonly [string, string];
  readonly layout: EnhancementCursorLayout;
}

export interface AutomaticTargetLocation {
  readonly baseline: KnownEnhancementBuild;
  readonly hookFunction: number;
  readonly hookBodySha256: string;
  readonly observationLayout: EnhancementObservationBaseLayout;
  readonly targetLayout: EnhancementTargetLayout;
}

export interface AutomaticLocalActionsLocation {
  readonly baseline: KnownEnhancementBuild;
  readonly hookFunction: number;
  readonly hookBodySha256: string;
  readonly observationLayout: EnhancementObservationBaseLayout | null;
  readonly uiDispatcher: KnownEnhancementBuild["uiDispatcher"] | null;
  readonly gameThread: KnownEnhancementBuild["gameThread"] | null;
  readonly travelAction: KnownEnhancementBuild["travelAction"] | null;
  readonly xunlaiAction: KnownEnhancementBuild["xunlaiAction"] | null;
  readonly chatAliases: KnownEnhancementBuild["chatAliases"] | null;
  readonly partyObservation: KnownEnhancementBuild["partyObservation"] | null;
  readonly teamApply: KnownEnhancementBuild["teamApply"] | null;
}

export interface WasmExport {
  readonly name: string;
  readonly kind: number;
  readonly index: number;
}

export interface ModuleShape {
  readonly types: FunctionType[];
  readonly functionTypeIndices: number[];
  readonly functionImportCount: number;
  readonly bodies: Uint8Array[];
  readonly bodySha256: (string | undefined)[];
  readonly exports: WasmExport[];
  readonly elementSection: Uint8Array | null;
  readonly dataSegments: readonly Readonly<{
    base: number;
    bytes: Uint8Array;
  }>[];
}

export interface DecodedFunction {
  readonly functionIndex: number;
  readonly calls: Map<number, number>;
  readonly messageSites: Readonly<Record<number, number>>;
}

export type SemanticRole = Readonly<{
  bodyLength: number;
  fingerprint: string;
  spans: readonly RelocationSpan[];
  params: readonly string[];
  results: readonly string[];
}>;
