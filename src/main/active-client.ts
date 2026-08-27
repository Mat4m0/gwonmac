/**
 * The one holder of the client the rest of main is allowed to serve.
 *
 * Every publication takes the next generation number. Published values are
 * frozen, so a holder of an `ActiveClient` reads one fixed picture rather than
 * a moving one; mutable chunk residency remains owned by its `ChunkStore`.
 *
 * The slot records what is current and decides nothing about readiness.
 */
import type {
  ClientTransforms,
  ClientCompatibility,
  ExtendedMemoryRuntimeStatus,
  RuntimeEnhancementVerification,
} from "../shared/contracts.js";
import type { ChunkStore } from "./core/chunk-store.js";

export interface ActiveClient {
  readonly generation: number;
  readonly artifactsDir: string;
  readonly store: ChunkStore;
  readonly wasmPath: string;
  readonly jsPath: string;
  readonly compatibility: ClientCompatibility | null;
  readonly extendedMemory: ExtendedMemoryRuntimeStatus;
  readonly transforms: ClientTransforms;
  readonly enhancementVerification: RuntimeEnhancementVerification;
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
}
