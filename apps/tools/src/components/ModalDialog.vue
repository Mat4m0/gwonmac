<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  labelledby: string;
  describedby?: string;
  initialFocus?: string;
}>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
let invoker: HTMLElement | null = null;

const focusable = () => [...(dialog.value?.querySelectorAll<HTMLElement>(
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
) ?? [])].filter((element) => !element.hidden);

const focusInitial = () => {
  const target = props.initialFocus
    ? dialog.value?.querySelector<HTMLElement>(props.initialFocus)
    : null;
  (target ?? dialog.value?.querySelector<HTMLElement>("[autofocus]") ?? focusable()[0])?.focus();
};

const restoreFocus = () => {
  const target = invoker;
  invoker = null;
  void nextTick(() => target?.isConnected && target.focus());
};

watch(
  () => props.open,
  async (open) => {
    const element = dialog.value;
    if (!element) return;
    if (open) {
      invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
      await nextTick();
      focusInitial();
    } else if (element.open || element.hasAttribute("open")) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
      restoreFocus();
    }
  },
  { flush: "post" },
);

const requestClose = (event?: Event) => {
  event?.preventDefault();
  emit("close");
};

const clickBackdrop = (event: MouseEvent) => {
  if (event.target === dialog.value) requestClose();
};

const trapFocus = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    event.stopPropagation();
    return;
  }
  if (event.key !== "Tab") return;
  const elements = focusable();
  if (elements.length === 0) {
    event.preventDefault();
    return;
  }
  const first = elements[0]!;
  const last = elements.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

onBeforeUnmount(() => {
  if (props.open) restoreFocus();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="ui-modal"
    :aria-labelledby="labelledby"
    :aria-describedby="describedby"
    @cancel="requestClose"
    @click="clickBackdrop"
    @keydown="trapFocus"
  >
    <slot v-if="open" />
  </dialog>
</template>
