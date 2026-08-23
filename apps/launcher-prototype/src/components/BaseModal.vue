<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{
  title: string;
}>();

const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
const inertSiblings: HTMLElement[] = [];

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    emit("close");
    return;
  }
  if (event.key !== "Tab" || !dialog.value) return;
  const focusable = Array.from(
    dialog.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
    ),
  );
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

onMounted(async () => {
  document.addEventListener("keydown", handleKeydown);
  const layer = dialog.value?.parentElement;
  const launcher = layer?.parentElement;
  if (layer && launcher) {
    Array.from(launcher.children).forEach((element) => {
      if (element instanceof HTMLElement && element !== layer && !element.inert) {
        element.inert = true;
        inertSiblings.push(element);
      }
    });
  }
  await nextTick();
  dialog.value?.querySelector<HTMLElement>("button, input, select, a[href]")?.focus();
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleKeydown);
  inertSiblings.forEach((element) => {
    element.inert = false;
  });
  previouslyFocused?.focus();
});
</script>

<template>
  <div class="modal-layer" @mousedown.self="emit('close')">
    <section
      ref="dialog"
      class="modal"
      role="dialog"
      aria-modal="true"
      :aria-label="props.title"
      tabindex="-1"
    >
      <slot />
    </section>
  </div>
</template>
