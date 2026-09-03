<script setup lang="ts">
import { ref, useId, watch } from "vue";

const props = defineProps<{ label: string; value: string }>();
const emit = defineEmits<{ change: [value: `#${string}`] }>();
const errorId = useId();
const draft = ref(props.value);
const error = ref("");
watch(() => props.value, value => { draft.value = value; error.value = ""; });

function commit(value: string) {
  const hex = value.trim().replace(/^#?/, "#").toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(hex)) {
    error.value = "Enter six hex digits, for example #e8b75c.";
    return;
  }
  draft.value = hex;
  error.value = "";
  emit("change", hex as `#${string}`);
}
</script>

<template>
  <div class="color-control">
    <input class="color-swatch" type="color" :aria-label="`${label} picker`" :value="value"
      @change="commit(($event.currentTarget as HTMLInputElement).value)" />
    <input v-model="draft" class="color-hex" type="text" :aria-label="`${label} hex`"
      :aria-invalid="!!error" :aria-describedby="error ? errorId : undefined"
      spellcheck="false" autocomplete="off" autocapitalize="off"
      @change="commit(draft)" @keydown.enter.prevent="($event.currentTarget as HTMLInputElement).blur()"
      @keydown.esc.prevent="draft = value; error = ''" />
    <small v-if="error" :id="errorId" role="alert" class="control-error">{{ error }}</small>
  </div>
</template>

<style scoped>
.color-control { display: grid; grid-template-columns: 34px minmax(0, 104px); align-items: center; gap: 8px; max-width: 100%; }
.color-control .color-swatch { width: 34px; height: 34px; padding: 4px; cursor: pointer; border-radius: 5px; }
.color-swatch::-webkit-color-swatch-wrapper { padding: 0; }
.color-swatch::-webkit-color-swatch { border: 0; border-radius: 4px; }
.color-control .color-hex { width: 100%; min-width: 0; height: 34px; padding: 6px 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-error { grid-column: 1 / -1; }
</style>
