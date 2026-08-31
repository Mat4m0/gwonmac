<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

const props = withDefaults(defineProps<{
  labelledby: string;
  dismissible?: boolean;
  wide?: boolean;
}>(), { dismissible: true, wide: false });
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
let priorFocus: HTMLElement | null = null;
let shell: HTMLElement | null = null;

function focusable(): HTMLElement[] {
  if (!dialog.value) return [];
  return [...dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.dismissible) {
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusable();
  if (items.length === 0) {
    event.preventDefault();
    dialog.value?.focus();
    return;
  }
  const first = items[0]!;
  const last = items.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(async () => {
  priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  shell = document.querySelector(".app-shell");
  if (shell) shell.inert = true;
  await nextTick();
  (dialog.value?.querySelector<HTMLElement>("[autofocus]") ?? focusable()[0] ?? dialog.value)?.focus();
});

onBeforeUnmount(() => {
  if (shell) shell.inert = false;
  priorFocus?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @pointerdown.self="dismissible && emit('close')">
      <section ref="dialog" class="modal" :class="{ 'modal-wide': wide }" role="dialog" aria-modal="true" :aria-labelledby="labelledby" tabindex="-1" @keydown="onKeydown">
        <slot />
      </section>
    </div>
  </Teleport>
</template>
