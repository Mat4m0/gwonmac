/**
 * Type-only boundary between the classic renderer and the independently built
 * Tools bundle. The runtime import uses a generated file name, so both builds
 * import these shapes directly instead of restating them on either side.
 */
import type { ToolboxObservation } from "./builds/live-party.js";
import type { TeamApplyCommands } from "./builds/team-apply-runner.js";
import type { StorageCommand } from "./storage-command.js";
import type { TravelCommand, TravelGameState } from "./travel-command.js";

export type PublishedTemplate = Readonly<{
  fileName: string;
  location: string;
}>;

/** A build the Tools bundle has already encoded for the renderer to publish. */
export type PublishableTemplate = Readonly<{ name: string; code: string }>;

export type ToolsAppHandle = Readonly<{
  show: () => void;
  hide: () => void;
  toggle: () => void;
  requestClose: () => void;
  /** The companion's latest game projection; the Tools domain interprets it. */
  update: (observation: ToolboxObservation) => void;
  dispose: () => void;
}>;

export type ToolsAppMountOptions = Readonly<{
  initiallyVisible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
  publishTemplate:
    | ((template: PublishableTemplate) => Promise<PublishedTemplate>)
    | null;
  commands: TeamApplyCommands | null;
  storage: StorageCommand | null;
  applyUnavailable: string | null;
  observationUnavailable: string | null;
  development: boolean;
}>;

export type TravelPaletteHandle = Readonly<{
  show: () => void;
  hide: () => void;
  toggle: () => void;
  update: (state: TravelGameState) => void;
  dispose: () => void;
}>;

export type TravelPaletteMountOptions = Readonly<{
  command: TravelCommand;
  development: boolean;
  initiallyVisible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}>;

/** The exact named exports of the generated Tools module. */
export type EmbeddedToolsBundle<Target> = Readonly<{
  mountToolsApp: (
    target: Target,
    options: ToolsAppMountOptions,
  ) => ToolsAppHandle;
  mountTravelPalette: (
    target: Target,
    options: TravelPaletteMountOptions,
  ) => TravelPaletteHandle;
}>;
