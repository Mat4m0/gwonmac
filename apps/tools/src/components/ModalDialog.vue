<script setup lang="ts">
import UiDialog from "../ui/UiDialog.vue";

defineOptions({ inheritAttrs: false });

defineProps<{
  open: boolean;
  labelledby: string;
  describedby?: string;
  initialFocus?: string;
}>();
defineEmits<{ close: [] }>();
</script>

<template>
  <UiDialog
    v-bind="$attrs"
    :open="open"
    :labelledby="labelledby"
    :describedby="describedby"
    :initial-focus="initialFocus"
    @close="$emit('close')"
  >
    <slot />
  </UiDialog>
</template>
