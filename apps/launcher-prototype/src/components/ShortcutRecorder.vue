<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { CircleX, Keyboard } from "@lucide/vue";
import {
  activateShortcutRecorder,
  deactivateShortcutRecorder,
  shortcutFromKeyboardEvent,
  validateShortcut,
} from "../shortcuts";

const props = withDefaults(
  defineProps<{
    label: string;
    unavailableShortcuts?: string[];
  }>(),
  { unavailableShortcuts: () => [] },
);

const shortcut = defineModel<string>({ required: true });
const recording = ref(false);
const message = ref("");
const hasError = ref(false);
const messageId = computed(() => `shortcut-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);

const stopRecording = () => {
  recording.value = false;
  hasError.value = false;
  message.value = "";
  deactivateShortcutRecorder(stopRecording);
};

const startRecording = () => {
  activateShortcutRecorder(stopRecording);
  recording.value = true;
  hasError.value = false;
  message.value = "Press a shortcut. Press Escape to cancel.";
};

const clearShortcut = () => {
  shortcut.value = "";
  stopRecording();
};

const handleKeydown = (event: KeyboardEvent) => {
  if (!recording.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    stopRecording();
    return;
  }
  if (event.key === "Tab" && !event.metaKey && !event.altKey && !event.ctrlKey) {
    stopRecording();
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const candidate = shortcutFromKeyboardEvent(event);
  if (!candidate) {
    hasError.value = true;
    message.value = "Add a letter, number, arrow, or function key.";
    return;
  }

  const error = validateShortcut(candidate, props.unavailableShortcuts);
  if (error) {
    hasError.value = true;
    message.value = error;
    return;
  }

  shortcut.value = candidate;
  recording.value = false;
  hasError.value = false;
  deactivateShortcutRecorder(stopRecording);
  message.value = `${candidate} saved.`;
};

onMounted(() => window.addEventListener("keydown", handleKeydown, true));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown, true);
  deactivateShortcutRecorder(stopRecording);
});
</script>

<template>
  <div class="shortcut-recorder" :class="{ recording, error: hasError }">
    <div class="shortcut-recorder-control">
      <kbd :aria-label="shortcut ? `Current shortcut: ${shortcut}` : 'No shortcut set'">
        <Keyboard v-if="recording" aria-hidden="true" />
        <span>{{ recording ? "Press keys…" : shortcut || "None" }}</span>
      </kbd>
      <button
        class="shortcut-record-button"
        type="button"
        :aria-label="
          recording
            ? `Cancel recording ${label} shortcut`
            : shortcut
              ? `Change ${label} shortcut`
              : `Record ${label} shortcut`
        "
        :aria-invalid="hasError || undefined"
        :aria-describedby="message ? messageId : undefined"
        @click="recording ? stopRecording() : startRecording()"
      >
        {{ recording ? "Cancel" : shortcut ? "Change" : "Record shortcut" }}
      </button>
      <button
        v-if="shortcut && !recording"
        class="shortcut-clear-button"
        type="button"
        :aria-label="`Clear ${label} shortcut`"
        @click="clearShortcut"
      >
        <CircleX aria-hidden="true" />
      </button>
    </div>
    <p :id="messageId" class="shortcut-message" role="status" aria-live="polite">{{ message }}</p>
  </div>
</template>
