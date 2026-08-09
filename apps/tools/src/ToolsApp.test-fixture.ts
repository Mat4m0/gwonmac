import { flushPromises, mount } from "@vue/test-utils";
import { mapTeamSlots } from "../../../src/shared/builds/library";
import { liveParty } from "../../../src/shared/builds/live-party";
import ToolsApp from "./ToolsApp.vue";
import { createDemoHost, type ToolsHost } from "./host";

export async function workbench(host: ToolsHost = createDemoHost()) {
  const wrapper = mount(ToolsApp, {
    attachTo: document.body,
    props: { host, mode: "standalone", visible: true },
  });
  await flushPromises();
  return wrapper;
}

export function applicableHost(
  applyTeam: ToolsHost["applyTeam"],
  mode: "normal" | "hard" = "hard",
): ToolsHost {
  const demo = createDemoHost();
  demo.party.value = liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: true,
    heroCount: 1,
    firstHeroId: 21,
    firstHeroAgentId: 11,
    party: {
      status: "ready",
      rosterObserved: true,
      playRegion: "pve",
      hardMode: false,
      inOutpost: true,
      slotCount: 1,
      slots: [
        {
          index: 0, occupied: true, hero: null, agentId: 10, level: 20,
          professions: [1, 0], behaviour: null,
          skills: [0, 0, 0, 0, 0, 0, 0, 0], disabled: 0,
          attributes: [],
        },
        {
          index: 1, occupied: true, hero: 21, agentId: 11, level: 20,
          professions: [4, 8], behaviour: 1,
          skills: [208, 209, 210, 211, 212, 213, 214, 215], disabled: 0,
          attributes: [[5, 12], [6, 10]],
        },
      ],
    },
  });
  return {
    ...demo,
    async loadLibrary() {
      const loaded = await demo.loadLibrary();
      return {
        ...loaded,
        library: {
          ...loaded.library,
          teams: loaded.library.teams.map((team, teamIndex) => teamIndex === 0
            ? {
                ...team,
                mode,
                slots: mapTeamSlots(team.slots, (slot, slotIndex) => slotIndex === 0
                  ? { ...slot, build: null }
                  : slotIndex === 1
                    ? slot
                    : { ...slot, hero: null, build: null, behaviour: null }),
              }
            : team),
        },
      };
    },
    applyTeam,
  };
}
