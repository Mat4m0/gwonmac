/**
 * Defines the fixed scalar contract for Compass, Mission Map, and pathing research.
 * Exposes no raw WebAssembly pointers across the renderer boundary.
 */

export const PATHING_SPIKE_SAMPLE_TRAPEZOIDS = 3;
export const PATHING_SPIKE_COORDINATES = 6;

export const PATHING_SPIKE_GLOBALS = Object.freeze({
  status: "gwonmac_pathing_spike_status",
  sequence: "gwonmac_pathing_spike_sequence",
  callCount: "gwonmac_pathing_spike_call_count",
  totalTrapezoids: "gwonmac_pathing_spike_total_trapezoids",
  sampledMapTrapezoids: "gwonmac_pathing_spike_sampled_map_trapezoids",
  sampledMapZplane: "gwonmac_pathing_spike_sampled_map_zplane",
  generation: "gwonmac_pathing_spike_generation",
  readCoordinate: "gwonmac_pathing_spike_read_coordinate",
  reset: "gwonmac_pathing_spike_reset",
  samples: Object.freeze(Array.from(
    { length: PATHING_SPIKE_SAMPLE_TRAPEZOIDS },
    (_, trapezoid) => Object.freeze(Array.from(
      { length: PATHING_SPIKE_COORDINATES },
      (_, coordinate) => `gwonmac_pathing_spike_t${trapezoid}_c${coordinate}`,
    )),
  )),
});

export const EXPLORATION_SPIKE_GLOBALS = Object.freeze({
  status: "gwonmac_exploration_spike_status",
  sequence: "gwonmac_exploration_spike_sequence",
  generation: "gwonmac_exploration_spike_generation",
  width: "gwonmac_exploration_spike_width",
  height: "gwonmac_exploration_spike_height",
  dwordCount: "gwonmac_exploration_spike_dword_count",
  observe: "gwonmac_exploration_spike_observe",
  readWord: "gwonmac_exploration_spike_read_word",
});

export const EXPLORATION_SPIKE_SCALARS = Object.freeze([
  EXPLORATION_SPIKE_GLOBALS.status,
  EXPLORATION_SPIKE_GLOBALS.sequence,
  EXPLORATION_SPIKE_GLOBALS.generation,
  EXPLORATION_SPIKE_GLOBALS.width,
  EXPLORATION_SPIKE_GLOBALS.height,
  EXPLORATION_SPIKE_GLOBALS.dwordCount,
]);

export const WORLD_MAP_ANCHOR_SPIKE_GLOBALS = Object.freeze({
  status: "gwonmac_world_map_anchor_spike_status",
  generation: "gwonmac_world_map_anchor_spike_generation",
  worldAnchorX: "gwonmac_world_map_anchor_spike_x",
  worldAnchorY: "gwonmac_world_map_anchor_spike_y",
  observe: "gwonmac_world_map_anchor_spike_observe",
});

export const WORLD_MAP_ANCHOR_SPIKE_SCALARS = Object.freeze([
  WORLD_MAP_ANCHOR_SPIKE_GLOBALS.status,
  WORLD_MAP_ANCHOR_SPIKE_GLOBALS.generation,
  WORLD_MAP_ANCHOR_SPIKE_GLOBALS.worldAnchorX,
  WORLD_MAP_ANCHOR_SPIKE_GLOBALS.worldAnchorY,
]);

type NativeFrameGlobals = Readonly<{
  status: string;
  generation: string;
  frameId: string;
  visible: string;
  viewportWidth: string;
  viewportHeight: string;
  left: string;
  bottom: string;
  right: string;
  top: string;
  observe: string;
}>;

function nativeFrameGlobals(prefix: string): NativeFrameGlobals {
  return Object.freeze({
    status: `${prefix}_status`,
    generation: `${prefix}_generation`,
    frameId: `${prefix}_frame_id`,
    visible: `${prefix}_visible`,
    viewportWidth: `${prefix}_viewport_width`,
    viewportHeight: `${prefix}_viewport_height`,
    left: `${prefix}_left`,
    bottom: `${prefix}_bottom`,
    right: `${prefix}_right`,
    top: `${prefix}_top`,
    observe: `${prefix}_observe`,
  });
}

export const MISSION_MAP_FRAME_SPIKE_GLOBALS = nativeFrameGlobals(
  "gwonmac_mission_map_frame_spike",
);

export const MISSION_MAP_PROJECTION_SPIKE_GLOBALS = Object.freeze({
  status: "gwonmac_mission_map_projection_spike_status",
  sequence: "gwonmac_mission_map_projection_spike_sequence",
  generation: "gwonmac_mission_map_projection_spike_generation",
  zoom: "gwonmac_mission_map_projection_spike_zoom",
  panX: "gwonmac_mission_map_projection_spike_pan_x",
  panY: "gwonmac_mission_map_projection_spike_pan_y",
  drawableWidth: "gwonmac_mission_map_projection_spike_drawable_width",
  drawableHeight: "gwonmac_mission_map_projection_spike_drawable_height",
  playerMapX: "gwonmac_mission_map_projection_spike_player_map_x",
  playerMapY: "gwonmac_mission_map_projection_spike_player_map_y",
  nativeMapWidth: "gwonmac_mission_map_projection_spike_native_map_width",
  nativeMapHeight: "gwonmac_mission_map_projection_spike_native_map_height",
});

export const MISSION_MAP_PROJECTION_SPIKE_SCALARS = Object.freeze([
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.status,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.sequence,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.generation,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.zoom,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panX,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panY,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.drawableWidth,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.drawableHeight,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.playerMapX,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.playerMapY,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.nativeMapWidth,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS.nativeMapHeight,
]);

export const COMPASS_FRAME_SPIKE_GLOBALS = Object.freeze({
  ...nativeFrameGlobals("gwonmac_compass_frame_spike"),
  cameraSequence: "gwonmac_compass_frame_spike_camera_sequence",
  compassDirectionX: "gwonmac_compass_frame_spike_direction_x",
  compassDirectionY: "gwonmac_compass_frame_spike_direction_y",
});

/** Explicit WASM allocation order. Never infer this ABI from object key order. */
export const MISSION_MAP_FRAME_SPIKE_SCALARS = Object.freeze([
  MISSION_MAP_FRAME_SPIKE_GLOBALS.status,
  MISSION_MAP_FRAME_SPIKE_GLOBALS.generation,
  MISSION_MAP_FRAME_SPIKE_GLOBALS.frameId,
  MISSION_MAP_FRAME_SPIKE_GLOBALS.visible,
  MISSION_MAP_FRAME_SPIKE_GLOBALS.viewportWidth,
  MISSION_MAP_FRAME_SPIKE_GLOBALS.viewportHeight,
  MISSION_MAP_FRAME_SPIKE_GLOBALS.left,
  MISSION_MAP_FRAME_SPIKE_GLOBALS.bottom,
  MISSION_MAP_FRAME_SPIKE_GLOBALS.right,
  MISSION_MAP_FRAME_SPIKE_GLOBALS.top,
]);

export const COMPASS_FRAME_SPIKE_SCALARS = Object.freeze([
  COMPASS_FRAME_SPIKE_GLOBALS.status,
  COMPASS_FRAME_SPIKE_GLOBALS.generation,
  COMPASS_FRAME_SPIKE_GLOBALS.frameId,
  COMPASS_FRAME_SPIKE_GLOBALS.visible,
  COMPASS_FRAME_SPIKE_GLOBALS.cameraSequence,
  COMPASS_FRAME_SPIKE_GLOBALS.viewportWidth,
  COMPASS_FRAME_SPIKE_GLOBALS.viewportHeight,
  COMPASS_FRAME_SPIKE_GLOBALS.left,
  COMPASS_FRAME_SPIKE_GLOBALS.bottom,
  COMPASS_FRAME_SPIKE_GLOBALS.right,
  COMPASS_FRAME_SPIKE_GLOBALS.top,
  COMPASS_FRAME_SPIKE_GLOBALS.compassDirectionX,
  COMPASS_FRAME_SPIKE_GLOBALS.compassDirectionY,
]);

export type NativeFrameSpikeSnapshot = Readonly<{
  status: number;
  generation: number;
  frameId: number;
  visible: boolean;
  viewportWidth: number;
  viewportHeight: number;
  left: number;
  bottom: number;
  right: number;
  top: number;
}>;

export type CompassFrameSpikeSnapshot = NativeFrameSpikeSnapshot & Readonly<{
  cameraSequence: number;
  compassDirectionX: number;
  compassDirectionY: number;
}>;

export type MissionMapFrameSpikeSnapshot = NativeFrameSpikeSnapshot & Readonly<{
  projectionStatus: number;
  projectionSequence: number;
  projectionGeneration: number;
  zoom: number;
  panX: number;
  panY: number;
  drawableWidth: number;
  drawableHeight: number;
  playerMapX: number;
  playerMapY: number;
  nativeMapWidth: number;
  nativeMapHeight: number;
}>;

export type SpikeController<T> = Readonly<{
  snapshot(): T | null;
}>;

export type CompassFrameSpikeController = SpikeController<CompassFrameSpikeSnapshot>;
export type MissionMapFrameSpikeController = SpikeController<MissionMapFrameSpikeSnapshot>;

export type PathingSpikeSnapshot = Readonly<{
  status: number;
  sequence: number;
  callCount: number;
  totalTrapezoids: number;
  sampledMapTrapezoids: number;
  sampledMapZplane: number;
  generation: number;
  samples: readonly (readonly number[])[];
}>;

export type PathingSpikeTrapezoid = Readonly<{
  topLeftX: number;
  topRightX: number;
  topY: number;
  bottomLeftX: number;
  bottomRightX: number;
  bottomY: number;
}>;

export type PathingSpikeController = SpikeController<PathingSpikeSnapshot> & Readonly<{
  reset(): void;
  readLargestGeometry(): readonly PathingSpikeTrapezoid[] | null;
}>;

export type ExplorationSpikeSnapshot = Readonly<{
  status: number;
  sequence: number;
  generation: number;
  width: number;
  height: number;
  dwordCount: number;
}>;

export type ExplorationSpikeBitmap = Readonly<{
  snapshot: ExplorationSpikeSnapshot;
  words: Uint32Array;
}>;

export type ExplorationSpikeController = SpikeController<ExplorationSpikeSnapshot> & Readonly<{
  isExplored(cellX: number, cellY: number): boolean | null;
  readBitmap(): ExplorationSpikeBitmap | null;
}>;

export type WorldMapAnchorSpikeSnapshot = Readonly<{
  status: number;
  generation: number;
  worldAnchorX: number;
  worldAnchorY: number;
}>;

export type WorldMapAnchorSpikeController = SpikeController<WorldMapAnchorSpikeSnapshot>;
