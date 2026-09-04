/**
 * Feature-local ownership of Travel exports, memory, policy, palette, and
 * teardown. The shared companion installer only composes this lifecycle.
 */
import type { TravelFriends } from "../shared/friends.js";
import type { TravelCommand } from "../shared/travel-command.js";
import type {
  EnhancementTravelConfigure,
  EnhancementTravelEnqueue,
  EnhancementTravelToggleTake,
  EnhancementGuildHallEnqueue,
} from "./enhancement-travel-command.js";
import { TRAVEL_PAYLOAD_BYTES } from "./enhancement-travel-command.js";
import {
  createTravelController,
  type TravelAvailability,
  type TravelController,
} from "./enhancement-travel-controller.js";
import { createTravelPalette } from "./travel-palette.js";

export interface TravelInstallation {
  allocate(malloc: (bytes: number) => unknown): void;
  region(): { readonly name: string; readonly pointer: number; readonly size: number; readonly align: 4 };
  initialize(): void;
  mount(parent: HTMLElement): void;
  update(availability: TravelAvailability): void;
  poll(): void;
  observingFriends(): boolean;
  updateFriends(friends: TravelFriends): void;
  command(): TravelCommand | null;
  dispose(free: (pointer: number) => void): void;
}

export function createTravelInstallation(
  exports: WebAssembly.Exports,
  enabled: boolean,
): TravelInstallation | null {
  if (!enabled) return null;
  const enqueue = typeof exports.enhancement_travel === "function"
    ? exports.enhancement_travel as EnhancementTravelEnqueue
    : null;
  const configure = typeof exports.enhancement_configure_travel === "function"
    ? exports.enhancement_configure_travel as EnhancementTravelConfigure
    : null;
  const takeToggle = typeof exports.enhancement_take_travel_toggle === "function"
    ? exports.enhancement_take_travel_toggle as EnhancementTravelToggleTake
    : null;
  const enqueueGuildHall = typeof exports.enhancement_guild_hall === "function"
    ? exports.enhancement_guild_hall as EnhancementGuildHallEnqueue
    : null;
  if (enqueue === null || configure === null || takeToggle === null) {
    throw new Error("the travel profile derived a module with no travel command");
  }

  let payloadPointer = 0;
  let controller: TravelController | null = null;
  let palette: ReturnType<typeof createTravelPalette> | null = null;
  return {
    allocate(malloc) {
      payloadPointer = Number(malloc(TRAVEL_PAYLOAD_BYTES));
    },
    region() {
      return { name: "travel payload", pointer: payloadPointer, size: TRAVEL_PAYLOAD_BYTES, align: 4 };
    },
    initialize() {
      configure(payloadPointer, 0);
    },
    mount(parent) {
      controller = createTravelController(enqueue, enqueueGuildHall, configure, payloadPointer);
      palette = createTravelPalette(parent, controller.command);
    },
    update(availability) {
      controller?.update(availability);
      palette?.setEnabled(availability.enabled);
      if (availability.state !== null) palette?.update(availability.state);
    },
    updateFriends(friends) { palette?.updateFriends(friends); },
    observingFriends() { return palette?.observingFriends() ?? false; },
    poll() {
      if (takeToggle() === 1 && controller?.command.unavailable() === null) {
        window.dispatchEvent(new CustomEvent("gw:travel-toggle"));
      }
    },
    command() {
      return controller?.command ?? null;
    },
    dispose(free) {
      const failures: unknown[] = [];
      try {
        palette?.dispose();
      } catch (error) {
        failures.push(error);
      }
      palette = null;
      try {
        controller?.dispose();
      } catch (error) {
        failures.push(error);
      }
      controller = null;
      try {
        if (payloadPointer !== 0) free(payloadPointer);
      } catch (error) {
        failures.push(error);
      }
      payloadPointer = 0;
      if (failures.length > 0) {
        throw new AggregateError(failures, "Travel cleanup was incomplete");
      }
    },
  };
}
