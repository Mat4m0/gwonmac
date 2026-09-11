/** Owns asynchronous character-plan loading and saving, including stale responses. */
import { ref, shallowRef, watch, type Ref } from "vue";
import { EMPTY_ELITE_TRACKING, type EliteChange, type EliteTracking, type EliteUpdate } from "../../../src/shared/elite-skills";
import type { TravelCharacterKey } from "../../../src/shared/travel-history";
export interface EliteTrackingHost {
  get(value: { characterKey: string }): Promise<EliteTracking>;
  update(value: EliteUpdate): Promise<EliteTracking>;
}
export function useEliteTracking(character: Ref<TravelCharacterKey | null>, host: EliteTrackingHost) {
  const tracking = shallowRef<EliteTracking>(EMPTY_ELITE_TRACKING);
  const busy = ref(false);
  const problem = ref("");
  const loaded = ref(false);
  let epoch = 0;
  let retryAction: (() => Promise<void>) | null = null;
  async function load() {
    const key = character.value;
    const ownEpoch = ++epoch;
    tracking.value = EMPTY_ELITE_TRACKING;
    loaded.value = false;
    problem.value = "";
    retryAction = null;
    busy.value = key !== null;
    if (key === null) return;
    try {
      const next = await host.get({ characterKey: key });
      if (ownEpoch !== epoch) return;
      tracking.value = next;
      loaded.value = true;
    } catch {
      if (ownEpoch !== epoch) return;
      problem.value = "Your tracked skills could not be loaded.";
      retryAction = load;
    } finally { if (ownEpoch === epoch) busy.value = false; }
  }
  async function change(value: EliteChange) {
    const key = character.value;
    if (key === null || busy.value || !loaded.value) return;
    const ownEpoch = epoch;
    busy.value = true;
    problem.value = "";
    try {
      const next = await host.update({ characterKey: key, change: value });
      if (ownEpoch !== epoch) return;
      tracking.value = next;
      retryAction = null;
    } catch {
      if (ownEpoch !== epoch) return;
      problem.value = "Could not save this change. Your saved plan is unchanged.";
      retryAction = () => change(value);
    } finally { if (ownEpoch === epoch) busy.value = false; }
  }
  const stop = watch(character, () => { void load(); }, { immediate: true });
  return { tracking, busy, loaded, problem, change, reload: load,
    retry: () => retryAction?.(),
    dismissError: () => { problem.value = ""; retryAction = null; },
    dispose: () => { epoch++; stop(); },
  };
}
