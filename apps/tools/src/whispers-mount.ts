/** Mounts the session-owned whisper view without a native API or storage host. */
import { createApp, h } from "vue";
import WhispersApp from "./WhispersApp.vue";
import type { WhisperSession } from "../../../src/shared/whisper-session";
export function mountWhispers(target: HTMLElement, options: { session: WhisperSession }) {
  const app = createApp({ setup: () => () => h(WhispersApp, options) });
  app.mount(target);
  return { dispose: () => app.unmount() };
}
