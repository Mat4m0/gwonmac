import { createApp, h, ref } from "vue";
import ToolsApp from "./ToolsApp.vue";
import {
  liveParty,
  type ToolboxObservation,
} from "../../../src/shared/builds/live-party";
import type { ToolsHost } from "./host";
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
  },
): ToolsAppHandle {
  let lastProfessionProbe = "";
  const visible = ref(options.initiallyVisible ?? options.mode === "standalone");
  const setVisible = (next: boolean) => {
    visible.value = next;
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
          },
        });
    },
  });
  app.mount(target);
  return Object.freeze({
    show: () => setVisible(true),
    hide: () => setVisible(false),
    toggle: () => setVisible(!visible.value),
    update: (observation: ToolboxObservation) => {
      options.host.party.value = liveParty(observation);
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
      Reflect.deleteProperty(window, "gwPlayerProfessionProbe");
      app.unmount();
    },
  });
}
