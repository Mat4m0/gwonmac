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

export const { mountToolsApp, mountTravelPalette, mountTradeChat } = embedded;
