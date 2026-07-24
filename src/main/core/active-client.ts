import type { SnapshotMetadata } from "../../shared/contracts.js";
import type { ChunkStore } from "./chunk-store.js";
import type { KnownToolboxBuild } from "./toolbox-builds.js";

export interface ActiveClient {
  readonly generation: number;
  readonly artifactsDir: string;
  readonly store: ChunkStore;
  readonly snapshotMeta: SnapshotMetadata;
  readonly wasmPath: string;
  readonly toolboxBuild: KnownToolboxBuild | null;
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
