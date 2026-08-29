/**
 * Reads only the certified scalar frame surfaces exported by the derived client.
 * Keeps native pointers and mutable WebAssembly state outside the renderer contract.
 */
import {
  COMPASS_FRAME_SPIKE_GLOBALS,
  COMPASS_FRAME_SPIKE_SCALARS,
  MISSION_MAP_FRAME_SPIKE_GLOBALS,
  MISSION_MAP_FRAME_SPIKE_SCALARS,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS,
  MISSION_MAP_PROJECTION_SPIKE_SCALARS,
  type CompassFrameSpikeController,
  type MissionMapFrameSpikeController,
  type NativeFrameSpikeSnapshot,
} from "../../shared/cartography-spike.js";

type FrameGlobals = typeof MISSION_MAP_FRAME_SPIKE_GLOBALS;

function numberGlobal(exports: WebAssembly.Exports, name: string): number | null {
  const candidate = exports[name];
  if (!(candidate instanceof WebAssembly.Global) || typeof candidate.value !== "number") {
    return null;
  }
  return Number.isFinite(candidate.value) ? candidate.value : null;
}

function hasFrameSurface(
  exports: WebAssembly.Exports,
  globals: FrameGlobals,
  scalars: readonly string[],
): boolean {
  return typeof exports[globals.observe] === "function"
    && scalars.every((name) => exports[name] instanceof WebAssembly.Global);
}

function readFrame(
  exports: WebAssembly.Exports,
  globals: FrameGlobals,
): NativeFrameSpikeSnapshot | null {
  const observe = exports[globals.observe];
  if (typeof observe !== "function") return null;
  try {
    observe();
  } catch {
    return null;
  }
  const status = numberGlobal(exports, globals.status);
  const generation = numberGlobal(exports, globals.generation);
  const frameId = numberGlobal(exports, globals.frameId);
  const visible = numberGlobal(exports, globals.visible);
  const viewportWidth = numberGlobal(exports, globals.viewportWidth);
  const viewportHeight = numberGlobal(exports, globals.viewportHeight);
  const left = numberGlobal(exports, globals.left);
  const bottom = numberGlobal(exports, globals.bottom);
  const right = numberGlobal(exports, globals.right);
  const top = numberGlobal(exports, globals.top);
  if (
    status === null || generation === null || frameId === null || visible === null
    || viewportWidth === null || viewportHeight === null || left === null
    || bottom === null || right === null || top === null
    || ![status, generation, frameId, visible].every(Number.isSafeInteger)
    || (visible !== 0 && visible !== 1)
  ) return null;
  return Object.freeze({
    status,
    generation,
    frameId,
    visible: visible === 1,
    viewportWidth,
    viewportHeight,
    left,
    bottom,
    right,
    top,
  });
}

export function createMissionMapFrameSpikeReader(
  exports: WebAssembly.Exports,
): MissionMapFrameSpikeController | null {
  if (!hasFrameSurface(
    exports,
    MISSION_MAP_FRAME_SPIKE_GLOBALS,
    MISSION_MAP_FRAME_SPIKE_SCALARS,
  ) || !MISSION_MAP_PROJECTION_SPIKE_SCALARS.every(
    (name) => exports[name] instanceof WebAssembly.Global,
  )) return null;
  return Object.freeze({
    snapshot() {
      const frame = readFrame(exports, MISSION_MAP_FRAME_SPIKE_GLOBALS);
      const projectionStatus = numberGlobal(
        exports,
        MISSION_MAP_PROJECTION_SPIKE_GLOBALS.status,
      );
      const projectionSequence = numberGlobal(
        exports,
        MISSION_MAP_PROJECTION_SPIKE_GLOBALS.sequence,
      );
      const projectionGeneration = numberGlobal(
        exports,
        MISSION_MAP_PROJECTION_SPIKE_GLOBALS.generation,
      );
      const zoom = numberGlobal(exports, MISSION_MAP_PROJECTION_SPIKE_GLOBALS.zoom);
      const panX = numberGlobal(exports, MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panX);
      const panY = numberGlobal(exports, MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panY);
      const drawableWidth = numberGlobal(
        exports,
        MISSION_MAP_PROJECTION_SPIKE_GLOBALS.drawableWidth,
      );
      const drawableHeight = numberGlobal(
        exports,
        MISSION_MAP_PROJECTION_SPIKE_GLOBALS.drawableHeight,
      );
      const playerMapX = numberGlobal(exports, MISSION_MAP_PROJECTION_SPIKE_GLOBALS.playerMapX);
      const playerMapY = numberGlobal(exports, MISSION_MAP_PROJECTION_SPIKE_GLOBALS.playerMapY);
      const nativeMapWidth = numberGlobal(
        exports,
        MISSION_MAP_PROJECTION_SPIKE_GLOBALS.nativeMapWidth,
      );
      const nativeMapHeight = numberGlobal(
        exports,
        MISSION_MAP_PROJECTION_SPIKE_GLOBALS.nativeMapHeight,
      );
      if (
        frame === null || projectionStatus === null || projectionSequence === null
        || projectionGeneration === null
        || zoom === null || panX === null || panY === null
        || drawableWidth === null || drawableHeight === null
        || playerMapX === null || playerMapY === null
        || nativeMapWidth === null || nativeMapHeight === null
        || !Number.isSafeInteger(projectionStatus)
        || !Number.isSafeInteger(projectionSequence)
        || !Number.isSafeInteger(projectionGeneration)
        || projectionStatus !== 1
        || projectionGeneration !== frame.generation
        || zoom < 1 || zoom > 3.5
        || drawableWidth <= 0 || drawableHeight <= 0
        || nativeMapWidth <= 0 || nativeMapHeight <= 0
      ) return null;
      return Object.freeze({
        ...frame,
        projectionStatus,
        projectionSequence,
        projectionGeneration,
        zoom,
        panX,
        panY,
        drawableWidth,
        drawableHeight,
        playerMapX,
        playerMapY,
        nativeMapWidth,
        nativeMapHeight,
      });
    },
  });
}

export function createCompassFrameSpikeReader(
  exports: WebAssembly.Exports,
): CompassFrameSpikeController | null {
  if (
    !hasFrameSurface(exports, COMPASS_FRAME_SPIKE_GLOBALS, COMPASS_FRAME_SPIKE_SCALARS)
  ) return null;
  return Object.freeze({
    snapshot() {
      const frame = readFrame(exports, COMPASS_FRAME_SPIKE_GLOBALS);
      const cameraSequence = numberGlobal(exports, COMPASS_FRAME_SPIKE_GLOBALS.cameraSequence);
      const compassDirectionX = numberGlobal(exports, COMPASS_FRAME_SPIKE_GLOBALS.compassDirectionX);
      const compassDirectionY = numberGlobal(exports, COMPASS_FRAME_SPIKE_GLOBALS.compassDirectionY);
      if (
        frame === null || cameraSequence === null || !Number.isSafeInteger(cameraSequence)
        || compassDirectionX === null || compassDirectionY === null
      ) return null;
      return Object.freeze({
        ...frame,
        cameraSequence,
        compassDirectionX,
        compassDirectionY,
      });
    },
  });
}
