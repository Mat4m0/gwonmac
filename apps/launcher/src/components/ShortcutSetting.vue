<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { LauncherNativeApi, LauncherSnapshot } from "@shared/launcher-contracts";
import { DEFAULT_SHORTCUTS, SHORTCUT_LABELS, shortcutConflict, shortcutDisplay, type ShortcutAction, type ShortcutBinding } from "@shared/keyboard-shortcuts";

const props = defineProps<{
  action: ShortcutAction;
  shortcuts: LauncherSnapshot["shortcuts"];
  api?: LauncherNativeApi["tools"] | undefined;
  disabled?: boolean;
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
    await props.api.replaceShortcut({ action: props.action, binding });
    message.value = binding ? "Shortcut saved." : "Shortcut cleared.";
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
    <span>Shortcut: <kbd>{{ shortcutDisplay(shortcuts[action]) }}</kbd></span>
    <div class="shortcut-actions">
      <button class="secondary" :disabled="disabled || capturing" :aria-label="`Change ${label} shortcut`" @click="capture">{{ capturing ? 'Listening…' : 'Change shortcut' }}</button>
      <button class="text-link" :disabled="disabled || capturing || !shortcuts[action]" :aria-label="`Clear ${label} shortcut`" @click="save(null)">Clear</button>
      <button class="text-link" :disabled="disabled || capturing" :aria-label="`Restore ${label} default shortcut`" @click="choose(DEFAULT_SHORTCUTS[action])">Restore default</button>
    </div>
    <p v-if="message" role="status" class="inline-message">{{ message }}</p>
    <div v-if="pending" class="shortcut-actions">
      <button class="secondary" @click="pending = null; message = 'Shortcut change cancelled.'">Cancel</button>
      <button class="primary" :disabled="disabled" @click="save(pending.binding)">Replace shortcut</button>
    </div>
  </div>
</template>

<style scoped>
.shortcut-setting { display: grid; gap: 12px; padding: 0 24px 20px; }
.shortcut-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
kbd { font: inherit; }
.shortcut-setting > span { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
