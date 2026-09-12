/**
 * Projects independently certified native map frames for capture markers.
 * Frame visibility stays available when absolute spawn projection is unsupported.
 */
import type { EliteMapView } from "../shared/elite-map.js";
import type {
  CartographyContextSnapshot, CompassFrameSpikeSnapshot,
  MissionMapFrameSpikeSnapshot, WorldMapFrameSpikeSnapshot, WorldMapAnchorSpikeSnapshot,
} from "../shared/cartography-spike.js";
import { projectMissionMapFrame, projectNativeFrame, type ScreenBox } from "./cartography-spike/frame-placement.js";
import { projectMissionMapContentBox, projectMapUnitsToMissionMap, projectMapUnitsToWorldMap } from "./cartography-spike/map-projections.js";
export function eliteMapSurfaces(input: Readonly<{
  context: CartographyContextSnapshot | null; mapId: number | null;
  anchor: WorldMapAnchorSpikeSnapshot | null; onWorldMap: boolean;
  compass: CompassFrameSpikeSnapshot | null; mission: MissionMapFrameSpikeSnapshot | null;
  world: WorldMapFrameSpikeSnapshot | null; canvas: ScreenBox;
}>): Pick<EliteMapView, "world" | "mission"> {
  const { context, compass, mission, world, canvas } = input;
  if (!context || context.status !== 1 || context.mapId !== input.mapId) return { world: null, mission: null };
  const worldBox = world?.generation === context.areaEpoch ? projectNativeFrame(world, canvas) : null;
  const worldProjection = world && worldBox ? projectMapUnitsToWorldMap(world, worldBox) : null;
  const supported = input.onWorldMap && input.anchor?.status === 1
    && input.anchor.generation === context.areaEpoch && [0, 2, 4].includes(input.anchor.continent);
  const missionFrame = mission?.generation === context.areaEpoch && compass?.generation === context.areaEpoch
    ? projectMissionMapFrame(mission, compass, canvas) : null;
  const missionBox = mission && missionFrame ? projectMissionMapContentBox(mission, missionFrame) : null;
  const missionProjection = supported && mission && missionBox ? projectMapUnitsToMissionMap(mission, missionBox) : null;
  return {
    world: worldProjection && world ? { ...worldProjection, continent: world.continent } : null,
    mission: missionBox ? { box: missionBox, transform: missionProjection?.transform ?? null } : null,
  };
}
