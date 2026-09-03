<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { Ellipsis } from "lucide-vue-next";
import type { LauncherNativeApi, LauncherSnapshot } from "@shared/launcher-contracts";
import { DEFAULT_SHORTCUTS, SHORTCUT_LABELS, shortcutConflict, shortcutDisplay, type ShortcutAction, type ShortcutBinding } from "@shared/keyboard-shortcuts";

const props = defineProps<{
  action: ShortcutAction;
  shortcuts: LauncherSnapshot["shortcuts"];
  api?: LauncherNativeApi["tools"] | undefined;
  disabled?: boolean;
  performSave?: ((action: () => Promise<unknown>) => Promise<void>) | undefined;
}>();
const message = ref("");
const capturing = ref(false);
const pending = ref<{ binding: ShortcutBinding; owner: ShortcutAction } | null>(null);
const label = computed(() => SHORTCUT_LABELS[props.action]);
let mounted = true;
onBeforeUnmount(() => { mounted = false; });

async function save(binding: ShortcutBinding | null) {
  pending.value = null;
  try {
    if (!props.api) { message.value = "Shortcut editing is available in the app."; return; }
    const action = () => props.api!.replaceShortcut({ action: props.action, binding });
    if (props.performSave) await props.performSave(action);
    else await action();
    message.value = "";
  } catch { message.value = "The shortcut could not be saved. Try again."; }
}

function choose(binding: ShortcutBinding | null) {
  const owner = binding && shortcutConflict(props.action, binding, props.shortcuts);
  if (binding && owner) {
    pending.value = { binding, owner };
    message.value = `Already used by ${SHORTCUT_LABELS[owner]}. Replacing it will clear that shortcut.`;
  } else void save(binding);
}

async function capture() {
  if (!props.api) { message.value = "Shortcut editing is available in the app."; return; }
  pending.value = null;
  capturing.value = true;
  message.value = "Press Command with a letter or number. Escape cancels; Delete clears.";
  try {
    const result = await props.api.captureShortcut(props.action);
    if (!mounted || props.disabled) return;
    if (result.status === "captured") choose(result.binding);
    else if (result.status === "cleared") await save(null);
    else if (result.status === "conflict") {
      pending.value = { binding: result.binding, owner: result.action };
      message.value = `Already used by ${SHORTCUT_LABELS[result.action]}. Replacing it will clear that shortcut.`;
    } else if (result.status === "reserved") message.value = "That shortcut is reserved by macOS or the application.";
    else if (result.status === "invalid") message.value = "Use Command with a letter or number. Shift and Option are supported.";
    else message.value = "Shortcut change cancelled.";
  } catch { message.value = "The shortcut could not be captured. Try again."; }
  finally { capturing.value = false; }
}
</script>

<template>
  <div class="shortcut-setting" :aria-label="`${label} shortcut`">
    <span class="visually-hidden">Shortcut</span>
    <button class="secondary shortcut-value" :disabled="disabled || capturing" :aria-label="`Change ${label} shortcut`" @click="capture"><kbd>{{ capturing ? 'Listening…' : shortcutDisplay(shortcuts[action]) }}</kbd><span aria-hidden="true">Change</span></button>
    <details class="shortcut-options" @keydown.esc.prevent="($event.currentTarget as HTMLDetailsElement).open = false"><summary :aria-label="`${label} shortcut options`" title="Shortcut options"><Ellipsis /></summary><div class="shortcut-actions">
      <button class="text-link" :disabled="disabled || capturing || !shortcuts[action]" :aria-label="`Clear ${label} shortcut`" @click="save(null)">Clear</button>
      <button class="text-link" :disabled="disabled || capturing" :aria-label="`Restore ${label} default shortcut`" @click="choose(DEFAULT_SHORTCUTS[action])">Restore default</button>
    </div></details>
    <p v-if="message" role="status" class="inline-message">{{ message }}</p>
    <div v-if="pending" class="shortcut-actions">
      <button class="secondary" @click="pending = null; message = 'Shortcut change cancelled.'">Cancel</button>
      <button class="primary" :disabled="disabled" @click="save(pending.binding)">Replace shortcut</button>
    </div>
  </div>
</template>

<style scoped>
.shortcut-setting { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; width: 172px; max-width: 100%; font-size: 13px; }
.shortcut-value { display: inline-flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 132px; }
.shortcut-value > span { font-size: 12px; color: var(--muted); }
.shortcut-options { position: relative; margin: 0; }
.shortcut-options summary { display: grid; place-items: center; width: 28px; height: 32px; padding: 0; list-style: none; border-radius: 5px; color: var(--muted); }
.shortcut-options summary::-webkit-details-marker { display: none; }
.shortcut-options summary:hover, .shortcut-options[open] summary { background: var(--control); color: inherit; }
.shortcut-options summary svg { width: 18px; height: 18px; }
.shortcut-options .shortcut-actions { position: absolute; top: calc(100% + 4px); right: 0; z-index: 4; width: 176px; display: grid; gap: 0; padding: 4px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--surface-solid); }
.shortcut-options .text-link { padding: 8px; border: 0; text-align: left; color: inherit; }
.shortcut-options .text-link:hover { background: var(--surface-hover); }
.shortcut-setting > .inline-message, .shortcut-setting > .shortcut-actions { flex-basis: 100%; }
.shortcut-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
kbd { font: inherit; font-variant-numeric: tabular-nums; }
</style>
