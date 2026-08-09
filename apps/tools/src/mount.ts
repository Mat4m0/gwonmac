import { createApp, h, ref } from "vue";
import ToolsApp from "./ToolsApp.vue";
import {
  liveParty,
  type ToolboxObservation,
} from "../../../src/shared/builds/live-party";
import type { ToolsHost } from "./host";
import { devTrace } from "./dev-trace";
import "./styles.css";

export type ToolsAppHandle = Readonly<{
  show(): void;
  hide(): void;
  toggle(): void;
  /**
   * The companion's latest projection of the running game, from the overlay.
   *
   * The raw observation crosses the boundary and is read into the domain here,
   * because this bundle is where the domain lives. The renderer side stays a
   * courier that never learns what a hero is.
   */
  update(observation: ToolboxObservation): void;
  dispose(): void;
}>;

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
  const setVisible = (next: boolean) => {
    if (visible.value === next) return;
    visible.value = next;
    devTrace(development, "visibility", { visible: next });
    options.onVisibilityChange?.(next);
  };
  const app = createApp({
    setup() {
      return () =>
        h(ToolsApp, {
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
      Reflect.deleteProperty(window, "gwPlayerProfessionProbe");
      app.unmount();
    },
  });
}
