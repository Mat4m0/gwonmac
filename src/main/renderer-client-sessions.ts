/**
 * Per-renderer projection of the app-global certified client session.
 *
 * Certification stays immutable and shared. A failure while one renderer
 * installs an optional Enhancement belongs only to that document, generation,
 * and window; it must not disable the same feature in another account.
 */
import type {
  ClientCompatibility,
  ClientSession,
  EnhancementRuntimeFeature,
} from "../shared/contracts.js";

interface ProjectionState {
  readonly documentId: number;
  readonly generation: number;
  readonly failed: Set<EnhancementRuntimeFeature>;
}

export interface RendererClientIdentity<Owner extends object> {
  readonly owner: Owner;
  readonly documentId: number;
  readonly generation: number;
}

function projectCompatibility(
  compatibility: ClientCompatibility,
  failed: ReadonlySet<EnhancementRuntimeFeature>,
): ClientCompatibility {
  const status = <Feature extends EnhancementRuntimeFeature>(
    feature: Feature,
  ): ClientCompatibility["features"][Feature] =>
    failed.has(feature)
      ? { status: "unavailable", reason: "preparation-failed" }
      : compatibility.features[feature];
  return Object.freeze({
    ...compatibility,
    features: Object.freeze({
      gameFileSaving: compatibility.features.gameFileSaving,
      nativeCursor: status("nativeCursor"),
      targetObservation: status("targetObservation"),
      partyObservation: status("partyObservation"),
      teamApply: status("teamApply"),
      travelAction: status("travelAction"),
      xunlaiAction: status("xunlaiAction"),
      chatAliases: status("chatAliases"),
      skillSlotGeometry: status("skillSlotGeometry"),
    }),
  });
}

export class RendererClientSessions<Owner extends object> {
  readonly #states = new WeakMap<Owner, ProjectionState>();

  #state(identity: RendererClientIdentity<Owner>): ProjectionState {
    const current = this.#states.get(identity.owner);
    if (
      current
      && current.documentId === identity.documentId
      && current.generation === identity.generation
    ) return current;
    const next: ProjectionState = {
      documentId: identity.documentId,
      generation: identity.generation,
      failed: new Set(),
    };
    this.#states.set(identity.owner, next);
    return next;
  }

  session(
    identity: RendererClientIdentity<Owner>,
    base: ClientSession,
  ): ClientSession {
    if (base.extendedMemory === null || base.compatibility === null) return base;
    const failed = this.#state(identity).failed;
    return failed.size === 0
      ? base
      : { ...base, compatibility: projectCompatibility(base.compatibility, failed) };
  }

  recordFailures(
    identity: RendererClientIdentity<Owner>,
    base: ClientSession,
    features: readonly EnhancementRuntimeFeature[],
  ): void {
    if (base.extendedMemory === null || base.compatibility === null) return;
    const failed = this.#state(identity).failed;
    for (const feature of features) {
      if (base.compatibility.features[feature].status === "available") {
        failed.add(feature);
      }
    }
  }
}
