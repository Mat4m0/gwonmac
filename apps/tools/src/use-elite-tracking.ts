/** Owns character-plan loading and ordered saves without dropping rapid edits. */
import { ref, shallowRef, watch, type Ref } from "vue";
import { ELITE_LOCATIONS } from "../../../src/shared/elite-locations";
import { EMPTY_ELITE_TRACKING, changeEliteTracking, type EliteChange, type EliteTracking, type EliteUpdate } from "../../../src/shared/elite-skills";
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
  function session() {
    return { key: character.value, confirmed: EMPTY_ELITE_TRACKING,
      pending: [] as EliteChange[], saving: false };
  }
  let current = session();
  const pendingSaves = new Map<TravelCharacterKey, Promise<void>>();
  let disposed = false;
  const owns = (owner: ReturnType<typeof session>) => !disposed && owner === current;
  async function load() {
    const owner = current = session();
    tracking.value = EMPTY_ELITE_TRACKING;
    loaded.value = false;
    problem.value = "";
    busy.value = owner.key !== null;
    if (owner.key === null) return;
    try {
      // Returning to a character must load the final queued edit, not an intermediate save.
      const pending = pendingSaves.get(owner.key);
      if (pending) await pending;
      if (!owns(owner)) return;
      const next = await host.get({ characterKey: owner.key });
      if (!owns(owner)) return;
      owner.confirmed = tracking.value = next;
      loaded.value = true;
    } catch {
      if (owns(owner)) problem.value = "Your elite skills setup could not be loaded.";
    } finally { if (owns(owner)) busy.value = false; }
  }
  async function drain(owner: ReturnType<typeof session>) {
    if (owner.saving || owner.key === null) return;
    owner.saving = true;
    if (owns(owner)) { busy.value = true; problem.value = ""; }
    try {
      // Finish already-requested saves for the old character after a switch.
      while (owner.pending.length) {
        const change = owner.pending[0]!;
        owner.confirmed = await host.update({ characterKey: owner.key, change });
        owner.pending.shift();
        if (owns(owner)) tracking.value = owner.pending.reduce(
          (state, next) => changeEliteTracking(state, next, ELITE_LOCATIONS), owner.confirmed);
      }
    } catch {
      if (owns(owner)) problem.value = "Changes are not saved. Retry, or restore your saved setup.";
    } finally {
      owner.saving = false;
      if (owns(owner)) busy.value = false;
    }
  }
  function save(owner = current) {
    if (owner.saving || owner.key === null) return;
    const key = owner.key;
    const completion = drain(owner);
    pendingSaves.set(key, completion);
    void completion.finally(() => {
      if (pendingSaves.get(key) === completion) pendingSaves.delete(key);
    });
    return completion;
  }
  function change(value: EliteChange) {
    if (disposed || (current.key !== null && !loaded.value)) return;
    tracking.value = changeEliteTracking(tracking.value, value, ELITE_LOCATIONS);
    if (current.key === null) return;
    // Only the latest consecutive view edit matters; tracking actions retain their order.
    const last = current.pending.length - 1;
    if (value.kind === "view" && last > 0 && current.pending[last]?.kind === "view") current.pending[last] = value;
    else current.pending.push(value);
    if (!problem.value) void save();
  }
  const stop = watch(character, () => { void load(); }, { immediate: true, flush: "sync" });
  return { tracking, busy, loaded, problem, change, reload: load,
    retry: () => loaded.value ? save() : load(),
    dismissError: () => {
      current.pending.length = 0;
      tracking.value = current.confirmed;
      problem.value = "";
    },
    dispose: () => { disposed = true; stop(); },
  };
}
