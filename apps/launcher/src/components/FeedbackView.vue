<script setup lang="ts">
import { computed, ref } from "vue";
import { FileText, MessageSquareText, Plus, X } from "lucide-vue-next";
import type { LauncherExternalLink } from "@shared/launcher-contracts";

defineProps<{ availability: "fixture" | "placeholder" }>();
const emit = defineEmits<{ external: [kind: LauncherExternalLink] }>();

const description = ref("");
const kind = ref("problem");
const email = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const attachments = ref<readonly File[]>([]);
const notice = ref("");
const canPreview = computed(() => description.value.trim().length > 0);

function chooseAttachments(event: Event) {
  const files = [...((event.currentTarget as HTMLInputElement).files ?? [])];
  const tooLarge = files.find((file) => file.size > 10 * 1024 * 1024);
  if (tooLarge) {
    notice.value = `${tooLarge.name} is larger than 10 MB.`;
    return;
  }
  attachments.value = files.slice(0, 3);
  notice.value = files.length > 3 ? "You can attach up to three files." : "";
}

function removeAttachment(index: number) {
  attachments.value = attachments.value.filter((_, candidate) => candidate !== index);
  if (fileInput.value) fileInput.value.value = "";
}

function previewFeedback() {
  if (!canPreview.value) return;
  notice.value = "Feedback preview is ready. Nothing was sent.";
}
</script>

<template>
  <section class="page feedback-page">
    <div class="page-head">
      <div><h1>Tell us what happened</h1><p>Small reports are useful. You do not need to write a perfect bug report.</p></div>
    </div>

    <form v-if="availability === 'fixture'" class="feedback-form" @submit.prevent="previewFeedback">
      <label>What would you like to share?<textarea v-model="description" rows="6" placeholder="A short description is enough." /></label>
      <div class="form-row">
        <label>Type<select v-model="kind"><option value="problem">Problem</option><option value="idea">Idea</option><option value="other">Something else</option></select></label>
        <label>Email (optional)<input v-model="email" type="email" autocomplete="email" placeholder="name@example.com" /></label>
      </div>
      <input ref="fileInput" class="visually-hidden" type="file" multiple accept="image/png,image/jpeg,text/plain,application/zip" @change="chooseAttachments" />
      <button type="button" class="attachment" @click="fileInput?.click()"><Plus />Add screenshot or file</button>
      <ul v-if="attachments.length" class="attachment-list" aria-label="Attachments">
        <li v-for="(file, index) in attachments" :key="`${file.name}-${file.lastModified}`"><FileText /><span>{{ file.name }}</span><button type="button" class="icon-button" :aria-label="`Remove ${file.name}`" @click="removeAttachment(index)"><X /></button></li>
      </ul>
      <p class="placeholder-note">Direct feedback is not connected yet. This preview does not upload files or send personal information.</p>
      <p v-if="notice" class="inline-message" role="status" aria-live="polite">{{ notice }}</p>
      <div class="form-actions"><button type="button" class="secondary" @click="emit('external', 'discord')">Open Discord</button><button type="submit" class="primary" :disabled="!canPreview">Review feedback</button></div>
    </form>

    <div v-else class="empty-state">
      <MessageSquareText />
      <h3>Direct feedback is not connected yet.</h3>
      <p>For now, send a problem or idea through GitHub or talk to us on Discord.</p>
      <div class="form-actions"><button class="secondary" @click="emit('external', 'discord')">Open Discord</button><button class="primary" @click="emit('external', 'bugReport')">Open GitHub issue</button></div>
    </div>
  </section>
</template>
