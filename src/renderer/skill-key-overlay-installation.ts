/**
 * Owns the complete renderer-side lifetime of the optional skill-key overlay:
 * its shared region, DOM consumer, settings projection, and release. The main
 * companion installer decides ordering; it does not need feature-local state.
 */
import type { SkillKeyBindings } from "../shared/skill-key-bindings.js";
import { COMPANION_SKILL_KEY_BYTES } from "./companion-snapshot.js";
import { createSkillKeyOverlayConsumer } from "./skill-key-overlay-consumer.js";

type Malloc = (bytes: number) => unknown;
type Free = (pointer: number) => void;

export function createSkillKeyOverlayInstallation(available: boolean) {
  let pointer = 0;
  let consumer: ReturnType<typeof createSkillKeyOverlayConsumer> | null = null;

  return Object.freeze({
    available,
    get pointer() {
      return pointer;
    },
    get bytes() {
      return available ? COMPANION_SKILL_KEY_BYTES : 0;
    },
    get allocated() {
      return !available || pointer !== 0;
    },
    get region() {
      return available
        ? Object.freeze({
            name: "skill keys",
            pointer,
            size: COMPANION_SKILL_KEY_BYTES,
            align: 4,
          })
        : null;
    },
    get sink() {
      return consumer;
    },
    allocate(malloc: Malloc) {
      if (available && pointer === 0) {
        pointer = Number(malloc(COMPANION_SKILL_KEY_BYTES));
      }
    },
    mount(
      parent: HTMLElement,
      bindings: SkillKeyBindings,
      enabled: boolean,
    ) {
      if (!available || consumer !== null) return;
      const canvas = parent.ownerDocument.getElementById("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("Enhancement skill key target is missing");
      }
      consumer = createSkillKeyOverlayConsumer(parent, canvas);
      consumer.setBindings(bindings);
      consumer.setEnabled(enabled);
    },
    sync(bindings: SkillKeyBindings, enabled: boolean) {
      consumer?.setBindings(bindings);
      consumer?.setEnabled(enabled);
    },
    dispose() {
      consumer?.dispose();
      consumer = null;
    },
    release(free: Free) {
      if (pointer !== 0) free(pointer);
      pointer = 0;
    },
  });
}
