/** Keeps durable Travel history aligned with the currently certified character. */
import { computed, shallowRef, type Ref } from "vue";
import type { GwNativeApi } from "../../../src/shared/contracts";
import type { TravelGameState } from "../../../src/shared/travel-command";
import { travelDestination } from "../../../src/shared/travel";
import {
  EMPTY_TRAVEL_HISTORY,
  type TravelCharacterKey,
  type TravelHistory,
} from "../../../src/shared/travel-history";

type Observation = Readonly<{
  characterKey: TravelCharacterKey;
  mapId: number;
}>;
type PublishedHistory = Readonly<{
  characterKey: TravelCharacterKey;
  maps: TravelHistory;
}>;

function observation(state: TravelGameState): Observation | null {
  return state.status === "ready" && state.characterKey !== null
    ? Object.freeze({ characterKey: state.characterKey, mapId: state.mapId })
    : null;
}

function sameObservation(left: Observation | null, right: Observation): boolean {
  return left?.characterKey === right.characterKey && left.mapId === right.mapId;
}

export function createTravelHistoryObservation(
  api: GwNativeApi["travelHistory"],
  state: Ref<TravelGameState>,
  development: boolean,
) {
  const published = shallowRef<PublishedHistory | null>(null);
  const history = computed<TravelHistory>(() => {
    const current = observation(state.value);
    return current !== null && published.value?.characterKey === current.characterKey
      ? published.value.maps
      : EMPTY_TRAVEL_HISTORY;
  });
  let tail: Promise<void> = Promise.resolve();
  let lastObservation: Observation | null = null;
  let inFlight: Readonly<{ observation: Observation; promise: Promise<TravelHistory> }> | null = null;
  let disposed = false;

  const synchronize = (next: Observation): Promise<TravelHistory> => {
    if (inFlight !== null && sameObservation(inFlight.observation, next)) {
      return inFlight.promise;
    }
    const operation = travelDestination(next.mapId) === null
      ? () => api.get({ characterKey: next.characterKey })
      : () => api.record(next);
    const result = tail.then(operation).then((maps) => {
      if (!disposed && observation(state.value)?.characterKey === next.characterKey) {
        published.value = Object.freeze({ characterKey: next.characterKey, maps });
      }
      return maps;
    });
    tail = result.then(() => undefined, () => undefined);
    inFlight = Object.freeze({ observation: next, promise: result });
    void result.then(
      () => {
        if (inFlight?.promise === result) inFlight = null;
      },
      () => {
        if (inFlight?.promise === result) inFlight = null;
      },
    );
    return result;
  };

  const reportFailure = (next: Observation, error: unknown): void => {
    if (sameObservation(lastObservation, next)) lastObservation = null;
    if (!development) return;
    console.debug(`[tools:dev] travel.history.refused ${JSON.stringify({
      mapId: next.mapId,
      reason: error instanceof Error ? error.message : "unknown history error",
    })}`);
  };

  return Object.freeze({
    history,
    load(): Promise<TravelHistory> {
      const current = observation(state.value);
      if (current === null) return Promise.resolve(EMPTY_TRAVEL_HISTORY);
      if (inFlight !== null && sameObservation(inFlight.observation, current)) {
        return inFlight.promise;
      }
      if (published.value?.characterKey === current.characterKey) {
        return Promise.resolve(published.value.maps);
      }
      return synchronize(current);
    },
    update(nextState: TravelGameState): void {
      const next = observation(nextState);
      if (next === null || sameObservation(lastObservation, next)) return;
      lastObservation = next;
      void synchronize(next).catch((error: unknown) => reportFailure(next, error));
    },
    dispose(): void {
      disposed = true;
      published.value = null;
    },
  });
}
