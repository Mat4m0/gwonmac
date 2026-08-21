import { createApp, h, ref } from "vue";
import ToolsApp from "./ToolsApp.vue";
import {
  liveParty,
  type ToolboxObservation,
} from "../../../src/shared/builds/live-party";
import type { ToolsHost } from "./host";
import type { ToolsAppHandle } from "../../../src/shared/tools-bundle-contracts";
import { devTrace } from "./dev-trace";
import "./styles.css";

export function mountToolsApp(
  target: HTMLElement,
  options: {
    host: ToolsHost;
    mode: "standalone" | "embedded";
    initiallyVisible?: boolean;
    onVisibilityChange?: (visible: boolean) => void;
    development?: boolean;
  },
): ToolsAppHandle {
  let lastProfessionProbe = "";
  let lastPartyTrace = "";
  const development = options.development === true;
  const visible = ref(options.initiallyVisible ?? options.mode === "standalone");
  const tools = ref<InstanceType<typeof ToolsApp> | null>(null);
  const setVisible = (next: boolean) => {
    if (visible.value === next) return;
    if (!next) options.host.cancelApply();
    visible.value = next;
    devTrace(development, "visibility", { visible: next });
    options.onVisibilityChange?.(next);
  };
  const app = createApp({
    setup() {
      return () =>
        h(ToolsApp, {
          ref: tools,
          host: options.host,
          mode: options.mode,
          visible: visible.value,
          onClose: () => setVisible(false),
          onReady: () => {
            target.dataset.ready = "true";
            devTrace(development, "ready", { mode: options.mode });
          },
        });
    },
  });
  devTrace(development, "mount", {
    mode: options.mode,
    visible: visible.value,
  });
  app.mount(target);
  return Object.freeze({
    show: () => setVisible(true),
    hide: () => setVisible(false),
    toggle: () => setVisible(!visible.value),
    requestClose: () => tools.value?.requestClose(),
    update: (observation: ToolboxObservation) => {
      options.host.party.value = liveParty(observation);
      const observed = options.host.party.value;
      const partySummary = {
        status: observed.status,
        playRegion: observed.playRegion,
        inOutpost: observed.inOutpost,
        partial: observed.partial,
        heroes: observed.heroes.length,
        accountSkillsObserved: observed.accountSkills !== null,
        characterSkillsObserved: observed.characterSkills !== null,
      } as const;
      const partyTrace = JSON.stringify(partySummary);
      if (partyTrace !== lastPartyTrace) {
        lastPartyTrace = partyTrace;
        devTrace(development, "party", partySummary);
      }
      const party = observation.party;
      const player = party?.slots?.[0];
      if (
        party?.status === "ready"
        && party.rosterObserved === true
        && player?.occupied === true
        && player.professions === null
      ) {
        const diagnostic = Object.freeze({
          schema: 1,
          probe: party.playerProfessionProbe ?? null,
          playerAgentId: player.agentId,
          investedAttributeIds:
            player.attributes?.map((entry) => entry[0]) ?? null,
          equippedSkillIds: player.skills ?? null,
        });
        Reflect.set(window, "gwPlayerProfessionProbe", diagnostic);
        const probe = JSON.stringify(party.playerProfessionProbe ?? null);
        if (probe !== lastProfessionProbe) {
          lastProfessionProbe = probe;
          console.warn(
            "[tools] player profession probe "
            + JSON.stringify(diagnostic),
          );
        }
      } else {
        Reflect.deleteProperty(window, "gwPlayerProfessionProbe");
      }
    },
    dispose: () => {
      devTrace(development, "dispose");
      options.host.cancelApply();
      Reflect.deleteProperty(window, "gwPlayerProfessionProbe");
      app.unmount();
    },
  });
}
