<script setup lang="ts">
/**
 * Guild Wars template files: a Templates folder or .txt files imported into the
 * game, and every saved template exported to a folder. The preview is the
 * confirmation; nothing is written until the player chooses Import.
 *
 * Every sentence comes from the host, which owns the mount and the format.
 */
import { computed, ref, watch } from "vue";
import type {
  TemplateCollisionPolicy,
  TemplateFiles,
  TemplateFilesState,
  TemplateSelection,
} from "../../../../src/shared/tools-bundle-contracts";
import UiDialog from "../ui/UiDialog.vue";

const props = defineProps<{ open: boolean; files: TemplateFiles | null; unavailable: string | null }>();
const emit = defineEmits<{ close: [] }>();

const NO_HOST = "Template files can be imported and exported from a game window.";

const state = ref<TemplateFilesState>({ available: false, reason: NO_HOST });
const outcome = ref("");
const selection = ref<TemplateSelection | null>(null);
const preview = ref<ReturnType<TemplateSelection["preview"]> | null>(null);
const policy = ref<TemplateCollisionPolicy>("skip");
const busy = ref(false);
const folderInput = ref<HTMLInputElement | null>(null);
const filesInput = ref<HTMLInputElement | null>(null);

const status = computed(() => preview.value?.summary
  ?? (outcome.value || (state.value.available ? state.value.stored : state.value.reason)));

function refresh() {
  state.value = props.files?.state() ?? { available: false, reason: props.unavailable ?? NO_HOST };
}

watch(() => props.open, (open) => {
  if (!open) return;
  outcome.value = "";
  selection.value = null;
  policy.value = "skip";
  refresh();
}, { immediate: true });

// Planned again whenever the choice changes, against what is saved now.
watch([selection, policy], () => {
  if (!selection.value) { preview.value = null; return; }
  try { preview.value = selection.value.preview(policy.value); }
  catch { selection.value = null; refresh(); }
});

async function run(task: () => Promise<string | null>) {
  if (busy.value) return;
  busy.value = true;
  try {
    const sentence = await task();
    if (sentence !== null) outcome.value = sentence;
  } catch (error) {
    outcome.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
    refresh();
  }
}

function pick(input: HTMLInputElement | null) {
  const files = [...(input?.files ?? [])];
  if (input) input.value = "";
  const host = props.files;
  if (!files.length || !host) return;
  outcome.value = "";
  void run(async () => {
    try { selection.value = await host.read(files); }
    catch { return "Those templates could not be read. Choose Guild Wars .txt files and try again."; }
    return null;
  });
}

function confirm() {
  const chosen = selection.value;
  if (!chosen) return;
  void run(async () => {
    try { return await chosen.apply(policy.value); }
    finally { selection.value = null; }
  });
}
</script>

<template>
  <UiDialog :open="open" labelledby="template-files-title" @close="emit('close')">
    <section class="ui-frame composer-dialog template-files">
      <header>
        <div>
          <h2 id="template-files-title">Guild Wars template files</h2>
          <p>Move skill and equipment templates between this Mac and other Guild Wars installations.</p>
        </div>
        <button type="button" class="ui-button" data-icon aria-label="Close" @click="emit('close')">×</button>
      </header>

      <p class="template-files-status" role="status" aria-live="polite">{{ status }}</p>

      <template v-if="state.available && preview">
        <p v-if="preview.skipped" class="template-files-note">{{ preview.skipped }}</p>
        <div class="template-files-choice">
          <span id="template-collision">If a name is already used</span>
          <div class="ui-segment" role="group" aria-labelledby="template-collision">
            <button type="button" :aria-pressed="policy === 'skip'" @click="policy = 'skip'">Keep existing</button>
            <button type="button" :aria-pressed="policy === 'replace'" @click="policy = 'replace'">Replace</button>
          </div>
        </div>
        <footer>
          <button type="button" class="ui-button" :disabled="busy" @click="selection = null">Cancel</button>
          <button
            type="button"
            class="ui-button"
            data-variant="primary"
            :disabled="busy || preview.count === 0"
            @click="confirm"
          >
            {{ preview.count === 0 ? "Import" : `Import ${preview.count} ${preview.count === 1 ? "template" : "templates"}` }}
          </button>
        </footer>
      </template>

      <template v-else-if="state.available">
        <div class="template-files-task">
          <h3>Import</h3>
          <p>
            Choose a Guild Wars Templates folder or single .txt files. Imported templates appear
            directly in Skills or Equipment. A Windows subfolder name stays in the template name.
          </p>
          <div class="template-files-actions">
            <button type="button" class="ui-button" :disabled="busy" @click="folderInput?.click()">Folder…</button>
            <button type="button" class="ui-button" :disabled="busy" @click="filesInput?.click()">Files…</button>
          </div>
        </div>
        <div v-if="state.count > 0" class="template-files-task">
          <h3>Export</h3>
          <p>Save every template as a .txt file that another Guild Wars installation can read.</p>
          <div class="template-files-actions">
            <button type="button" class="ui-button" :disabled="busy" @click="run(() => files!.exportAll())">Export all…</button>
          </div>
        </div>
        <div v-if="state.stranded" class="template-files-task">
          <p>{{ state.stranded }} Moving keeps the folder name as part of the template name.</p>
          <div class="template-files-actions">
            <button type="button" class="ui-button" :disabled="busy" @click="run(() => files!.rescue())">Move to top level</button>
          </div>
        </div>
        <!-- Chromium's own pickers. `webkitdirectory` gives every file a relative
             path, so no absolute path ever crosses into the main process. -->
        <input ref="folderInput" type="file" webkitdirectory hidden @change="pick(folderInput)">
        <input ref="filesInput" type="file" accept=".txt,text/plain" multiple hidden @change="pick(filesInput)">
      </template>
    </section>
  </UiDialog>
</template>
