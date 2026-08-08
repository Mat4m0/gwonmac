/**
 * The one holder of the client the rest of main is allowed to serve.
 *
 * Every publication takes the next generation number, and a caller holding a
 * stale one cannot write through it: `replaceSnapshot` refuses unless the
 * generation still matches, so work that an update superseded cannot reach back
 * and edit the client that replaced it. Published values are frozen, so a
 * holder of an `ActiveClient` reads one fixed picture rather than a moving one.
 *
 * The slot records what is current and decides nothing about readiness.
 */
import type { SnapshotMetadata } from "../shared/contracts.js";
import type { ChunkStore } from "./core/chunk-store.js";
import type { KnownEnhancementBuild } from "./certification/enhancement-builds.js";

export interface ActiveClient {
  readonly generation: number;
  readonly artifactsDir: string;
  readonly store: ChunkStore;
  readonly snapshotMeta: SnapshotMetadata;
  readonly wasmPath: string;
  readonly jsPath: string;
  readonly enhancementBuild: KnownEnhancementBuild | null;
}

export type ClientGeneration = Omit<ActiveClient, "generation">;

export class ActiveClientSlot {
  private currentValue: ActiveClient | null = null;
  private nextGeneration = 1;

  get current(): ActiveClient | null {
    return this.currentValue;
  }

  publish(value: ClientGeneration): ActiveClient {
    const active = Object.freeze({
      ...value,
      generation: this.nextGeneration++,
    });
    this.currentValue = active;
    return active;
  }

  replaceSnapshot(
    generation: number,
    snapshotMeta: SnapshotMetadata,
  ): boolean {
    const active = this.currentValue;
    if (!active || active.generation !== generation) return false;
    this.currentValue = Object.freeze({ ...active, snapshotMeta });
    return true;
  }
}
