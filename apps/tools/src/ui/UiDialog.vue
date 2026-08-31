<script setup lang="ts">
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
} from "reka-ui";
import { nextTick } from "vue";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  open: boolean;
  labelledby: string;
  describedby?: string | undefined;
  initialFocus?: string | undefined;
}>();
const emit = defineEmits<{ close: [] }>();

const focusInitial = (event: Event) => {
  if (!props.initialFocus) return;
  const content = event.currentTarget as HTMLElement;
  const target = content.querySelector<HTMLElement>(props.initialFocus);
  if (!target) return;
  event.preventDefault();
  void nextTick(() => target.focus());
};
</script>

<template>
  <DialogRoot :open="open" @update:open="!$event && emit('close')">
    <DialogPortal disabled>
      <DialogOverlay class="ui-dialog-overlay" />
      <DialogContent
        v-bind="$attrs"
        class="ui-dialog"
        :aria-labelledby="labelledby"
        :aria-describedby="describedby"
        @open-auto-focus="focusInitial"
      >
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
