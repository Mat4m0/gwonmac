/**
 * Canonical renderer source for saved feature settings and certified play-region
 * policy. Presentation and command modules consume one immutable snapshot
 * instead of wiring the same settings/region listeners independently.
 */
import type { EnhancementProgram } from "../shared/enhancement-contracts.js";
import type { CompanionPlayRegionState } from "./companion-play-region-snapshot.js";
import {
  enhancementRuntimePolicy,
  type OptionalToolSettings,
  type RuntimePlayRegion,
} from "./enhancement-runtime-policy.js";

type CompanionPolicyReason = "launch" | "region" | "settings";

type CompanionPolicySnapshot<
  Settings extends OptionalToolSettings = OptionalToolSettings,
> = Readonly<{
  settings: Settings;
  playRegion: RuntimePlayRegion;
  playRegionState: CompanionPlayRegionState;
  policy: ReturnType<typeof enhancementRuntimePolicy>;
}>;

type PolicyUpdate<Settings extends OptionalToolSettings> = Readonly<{
  reason: CompanionPolicyReason;
  snapshot: CompanionPolicySnapshot<Settings>;
}>;

function projectPlayRegion(state: CompanionPlayRegionState): string {
  return state.status === "ready"
    ? `ready:${state.playRegion}:${state.mapId}:${state.instanceType}`
    : `waiting:${state.reason}`;
}

export function createCompanionPolicySource<Settings extends OptionalToolSettings>(
  input: Readonly<{
    program: EnhancementProgram;
    readSettings(): Settings;
    settingsEvents: Pick<EventTarget, "addEventListener" | "removeEventListener">;
    readPlayRegion(): CompanionPlayRegionState;
    subscribePlayRegion(
      listener: (state: CompanionPlayRegionState) => void,
    ): () => void;
  }>,
) {
  const listeners = new Set<(update: PolicyUpdate<Settings>) => void>();
  let disposed = false;
  let settings = input.readSettings();
  let playRegionState = input.readPlayRegion();
  let playRegionProjection = projectPlayRegion(playRegionState);
  const makeSnapshot = (): CompanionPolicySnapshot<Settings> => {
    const playRegion = playRegionState.status === "ready"
      ? playRegionState.playRegion
      : "unknown";
    return Object.freeze({
      settings,
      playRegion,
      playRegionState,
      policy: enhancementRuntimePolicy(input.program, settings, playRegion),
    });
  };
  let snapshot = makeSnapshot();
  const publish = (reason: Exclude<CompanionPolicyReason, "launch">) => {
    snapshot = makeSnapshot();
    const update = Object.freeze({ reason, snapshot });
    for (const listener of listeners) listener(update);
  };
  const onSettings = () => {
    if (disposed) return;
    // The event is only a notification. The validated bridge remains the
    // source of truth even if page code dispatches a forged event payload.
    settings = input.readSettings();
    publish("settings");
  };
  input.settingsEvents.addEventListener("gw:tools-settings", onSettings);
  let unsubscribePlayRegion: () => void;
  try {
    unsubscribePlayRegion = input.subscribePlayRegion((state) => {
      if (disposed) return;
      const projection = projectPlayRegion(state);
      if (projection === playRegionProjection) return;
      playRegionState = state;
      playRegionProjection = projection;
      publish("region");
    });
  } catch (cause) {
    input.settingsEvents.removeEventListener("gw:tools-settings", onSettings);
    throw cause;
  }

  return Object.freeze({
    get snapshot() { return snapshot; },
    subscribe(listener: (update: PolicyUpdate<Settings>) => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      try {
        listener(Object.freeze({ reason: "launch", snapshot }));
      } catch (cause) {
        listeners.delete(listener);
        throw cause;
      }
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const failures: unknown[] = [];
      try {
        input.settingsEvents.removeEventListener("gw:tools-settings", onSettings);
      } catch (cause) {
        failures.push(cause);
      }
      try {
        unsubscribePlayRegion();
      } catch (cause) {
        failures.push(cause);
      }
      listeners.clear();
      if (failures.length > 0) {
        throw new AggregateError(failures, "Companion policy source disposal failed");
      }
    },
  });
}
