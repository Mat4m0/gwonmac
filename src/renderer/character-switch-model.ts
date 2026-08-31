/**
 * Closed Character Switch domain contract shared by the controller, host, and
 * palette. Presentation never receives native coordinates or open diagnostics.
 */
import type { CompanionCharacterListState } from "./companion-character-list-snapshot.js";
import type { CharacterSwitchUsageDocument } from "../shared/character-switch-usage.js";

export type CharacterSwitchContext =
  | "outpost"
  | "pve-explorable"
  | "pvp-explorable"
  | "loading"
  | "character-select"
  | "unavailable";

export type CharacterSwitchFailureCode =
  | "play-path-unproved"
  | "list-unavailable"
  | "current-target"
  | "busy"
  | "active-pvp"
  | "game-loading"
  | "character-select"
  | "state-unavailable"
  | "focus-lost"
  | "target-missing"
  | "logout-refused"
  | "logout-invalid"
  | "logout-timeout"
  | "selector-timeout"
  | "selector-refused"
  | "selector-invalid"
  | "selector-frame-missing"
  | "selector-child-missing"
  | "selector-index-invalid"
  | "selector-context-invalid"
  | "selector-array-invalid"
  | "selector-target-missing"
  | "selector-parent-invalid"
  | "selection-not-confirmed"
  | "play-refused"
  | "play-invalid"
  | "play-frame-missing"
  | "play-parent-invalid"
  | "play-timeout"
  | "confirmation-timeout";

export type CharacterSwitchStage =
  | "logout"
  | "selector"
  | "selection"
  | "play"
  | "confirmation";

export type CharacterSwitchActionState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "confirming" }>
  | Readonly<{ status: "switching"; stage: CharacterSwitchStage }>
  | Readonly<{
      status: "failed";
      code: CharacterSwitchFailureCode;
      retryable: boolean;
    }>
  | Readonly<{ status: "complete" }>;

export type CharacterSwitchTransitionStage =
  | "idle:reset"
  | "confirmation:required"
  | "confirmation:cancelled"
  | "logout:queued"
  | "logout:sent"
  | "selector:list-ready"
  | `selector:waiting-${"frame" | "child" | "index" | "context" | "array" | "target"}`
  | "selection:confirmed"
  | "selection:sent"
  | "play:sent"
  | "confirmation:complete"
  | `failed:${CharacterSwitchFailureCode}`;

export type CharacterSwitchDiagnosticTransition = Readonly<{
  sequence: number;
  stage: CharacterSwitchTransitionStage;
  elapsedBucketMs: number;
}>;

export type CharacterSwitchDiagnostics =
  | Readonly<{
      version: 1;
      stage: "unavailable";
      lastCode: "play-path-unproved";
    }>
  | Readonly<{
      version: 7;
      buildId: number;
      programId: number;
      readerState: CompanionCharacterListState["status"];
      characterCount: number;
      preGameState: "not-read";
      preGameReadCount: 0;
      preGameReadBucketMs: 0;
      playability: CharacterSwitchContext;
      requestSequence: number;
      actionSequence: number;
      focused: boolean;
      policyEnabled: boolean;
      stage: CharacterSwitchActionState["status"] | CharacterSwitchStage;
      lastCode: CharacterSwitchFailureCode | null;
      elapsedBucketMs: number;
      lastSelectorReadiness: "frame" | "child" | "index" | "context" | "array" | "target" | null;
      selectorReadinessRetries: number;
      lastSelectorProofMask: number;
      selectorClickProved: boolean;
      selectorConfirmationProved: boolean;
      selectorParentResolverProved: boolean;
      selectorParentIdentityProved: boolean;
      selectorParentProved: boolean;
      selectorContextRowsProved: boolean;
      selectorContextProved: boolean;
      selectorContextIdentityProved: boolean;
      selectorCharacterArrayProved: boolean;
      selectorTargetProved: boolean;
      selectorTargetPointerProved: boolean;
      requestedListIndex: number | null;
      selectorObservedIndex: number | null;
      lastFrameProofMask: number;
      counters: Readonly<{ logout: number; select: number; play: number }>;
      transitions: readonly CharacterSwitchDiagnosticTransition[];
    }>;

export interface CharacterSwitchSource {
  readonly characters: CompanionCharacterListState;
  readonly action: CharacterSwitchActionState;
  readonly usage: CharacterSwitchUsageDocument;
  readonly context: CharacterSwitchContext;
  request(characterKey: string): void;
  confirm(): void;
  cancelConfirmation(): void;
  reset(): void;
  diagnostics(): CharacterSwitchDiagnostics;
  subscribe(listener: () => void): () => void;
}
