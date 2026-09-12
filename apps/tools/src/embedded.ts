/** Mounts the explicit Tools surfaces inside the certified renderer. */
import { mountEliteSkills as mountElites } from "./elite-mount";
import { loadInstalledSkills } from "./skill-catalog";
import { mountWhispers } from "./whispers-mount";
import { createNativeHost } from "./host";
import { mountToolsApp as mount } from "./mount";
import { createNativeTravelHost } from "./travel-host";
import { mountTravelPalette as mountTravel } from "./travel-mount";
import { createNativeTradeHost } from "./trade-host";
import { mountTradeChat as mountTrade } from "./trade-mount";
import type {
  EmbeddedToolsBundle,
} from "../../../src/shared/tools-bundle-contracts";

const embedded: EmbeddedToolsBundle<HTMLElement> = Object.freeze({
  mountEliteSkills: (target, options) => mountElites(target, {
    tracking: options.nativeApi.eliteTracking, loadSkills: loadInstalledSkills,
    onOpenChange: options.onOpenChange,
    openWiki: (location, page) => options.nativeApi.eliteTracking.openWiki({ locationId: location.id, page }),
  }),
  mountWhispers,
  mountToolsApp: (target, { nativeApi, ...options }) => mount(target, {
    host: createNativeHost(
      nativeApi,
      options.publishTemplate,
      options.commands,
      options.storage,
      options.applyUnavailable,
      options.development,
      options.observationUnavailable,
    ),
    mode: "embedded",
    ...options,
  }),
  mountTravelPalette: (target, { nativeApi, ...options }) => mountTravel(target, {
    ...options,
    nativeDialog: true,
    host: createNativeTravelHost(
      nativeApi,
      options.command,
      options.development,
    ),
  }),
  mountTradeChat: (target, { nativeApi, ...options }) => mountTrade(target, {
    ...options,
    host: createNativeTradeHost(nativeApi),
  }),
});

export const { mountEliteSkills, mountToolsApp, mountTravelPalette, mountTradeChat } = embedded;
export { mountWhispers };
