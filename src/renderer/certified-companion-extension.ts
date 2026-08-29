/**
 * Core-owned contract for launch-time companion extensions. Implementations
 * are supplied dynamically; this module contains lifecycle shapes only.
 */
import type {
  EnhancementCapabilities,
  EnhancementProgram,
} from "../shared/enhancement-contracts.js";
import type { CompanionOwnedRegion } from "./companion-owned-regions.js";
import type {
  CompanionCoreMemoryNeeds,
  allocateCompanionCoreMemory,
} from "./companion-core-memory-installation.js";
import type { installCompanionKernel } from "./companion-kernel-loader.js";
import type {
  OptionalObserverReaders,
  SkillCooldownConsumer,
  SkillSlotConsumer,
  StateConsumer,
  ToolboxConsumer,
} from "./companion-observer.js";
import type { createPlayRegionObservationInstallation } from "./play-region-state-installation.js";
import type { createSkillSlotGeometryInstallation } from "./skill-slot-geometry-installation.js";

type CoreMemory = ReturnType<typeof allocateCompanionCoreMemory>;
type Kernel = Awaited<ReturnType<typeof installCompanionKernel>>;
type PlayRegions = ReturnType<typeof createPlayRegionObservationInstallation>;
type SkillGeometry = ReturnType<typeof createSkillSlotGeometryInstallation>;
export type KernelRegion = Readonly<{ pointer: number; bytes: number }>;

export type CompanionObserverExtension = Readonly<{
  pollers: readonly { poll(): void; enabled?(): boolean }[];
  state: StateConsumer | null;
  toolbox: ToolboxConsumer | null;
  observeState: boolean;
  publishState: boolean;
  skillSlots: SkillSlotConsumer | null;
  skillCooldowns: SkillCooldownConsumer | null;
  readers: OptionalObserverReaders | null;
  pointers: Readonly<{
    snapshot: number;
    toolbox: number;
    party: number;
    skillSlots: number;
    skillCooldowns: number;
  }>;
}>;

export type CompanionExtensionSession = Readonly<{
  observer: CompanionObserverExtension;
  beforeHook(): void;
  afterHook(): void;
  createRuntime(
    base: CompanionDeveloperRuntime,
  ): CompanionDeveloperRuntime | CompanionObserverRuntime;
  withdrawPolicy(): void;
  disposePresentation(): void;
  releaseObserverMemory(free: (pointer: number) => void): void;
  releaseCallbackResources(free: (pointer: number) => void): void;
}>;

export type CompanionExtensionActivation = Readonly<{
  memory: WebAssembly.Memory;
  exports: WebAssembly.Exports;
  core: CoreMemory;
  kernel: Kernel;
  playRegions: PlayRegions;
  skillGeometry: SkillGeometry;
  capabilities: EnhancementCapabilities;
  program: EnhancementProgram;
  isCleaned(): boolean;
  hookInstalled(): boolean;
  setHookEnabled(enabled: boolean): void;
}>;

export type PreparedCompanionExtension = Readonly<{
  featureFlags: number;
  memoryNeeds: Pick<
    CompanionCoreMemoryNeeds,
    "snapshot" | "toolbox" | "commandPayloadBytes" | "professionTrace" | "professionTraceBytes"
  >;
  allocate(malloc: (bytes: number) => unknown): void;
  initialize(memory: WebAssembly.Memory): void;
  ownedRegions(): readonly CompanionOwnedRegion[];
  kernelRegions: Readonly<{
    skillSlots: KernelRegion;
    skillCooldowns: KernelRegion;
  }>;
  activate(context: CompanionExtensionActivation): CompanionExtensionSession;
  rollback(free: (pointer: number) => void): void;
}>;

export type PrepareCompanionExtension = (
  exports: WebAssembly.Exports,
  capabilities: EnhancementCapabilities,
  program: EnhancementProgram,
) => Promise<PreparedCompanionExtension>;
