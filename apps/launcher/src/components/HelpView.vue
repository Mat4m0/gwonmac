<script setup lang="ts">
/**
 * The launcher's one help destination: open issues in ArenaNet's official
 * client, where to report a problem, and the feedback form. The form shows
 * success only after main confirms that Basin accepted the report.
 */
import { computed, ref } from "vue";
import { AlertTriangle, Check, ExternalLink, Github, Info, RotateCcw, Smartphone } from "lucide-vue-next";
import { LAUNCHER_FEEDBACK_MESSAGE_LIMIT, parseLauncherFeedback, type LauncherExternalLink, type LauncherFeedback, type LauncherFeedbackKind } from "@shared/launcher-contracts";
import DiscordIcon from "./DiscordIcon.vue";

const props = defineProps<{ send: (feedback: LauncherFeedback) => Promise<void> }>();
const emit = defineEmits<{ external: [kind: LauncherExternalLink] }>();

const kind = ref<LauncherFeedbackKind>("problem");
const message = ref("");
const email = ref("");
const state = ref<"editing" | "sending" | "sent" | "failed">("editing");
// The same parser main applies, so the button enables only for a report main accepts.
const feedback = computed(() => {
  try {
    return parseLauncherFeedback({ kind: kind.value, message: message.value, ...(email.value.trim() ? { email: email.value } : {}) });
  } catch {
    return null;
  }
});

async function submit() {
  if (!feedback.value || state.value === "sending") return;
  state.value = "sending";
  try {
    await props.send(feedback.value);
    message.value = "";
    state.value = "sent";
  } catch {
    state.value = "failed";
  }
}

// Only open defects of ArenaNet's client: gwonmac cannot fix these, so the
// list says what players can do now. Fixed issues leave the list.
const RELOAD = "Press ⌘Q in that game window and choose Reload Guild Wars. Only that account restarts; other accounts stay open.";
const issues = [
  {
    title: "Some textures appear black or corrupted",
    symptom: "Parts of a character, map, or effect can render as a flat black or broken area, for example in the ice dungeons of Eye of the North. Saved data is not affected.",
    status: "Reload helps",
    hint: RELOAD,
  },
  {
    title: "The game can close after a long session",
    symptom: "The official client can use at most 2 GB of memory. After many map changes or hours of play, it can reach this limit and close.",
    status: "Reload helps",
    hint: `Reload before a long run, or when the game starts to stutter. ${RELOAD} Select “Return to my character automatically” to log back in to the same character.`,
  },
  {
    title: "Key labels show the next key",
    symptom: "The Controls panel and menus name the wrong key for letters and numbers: a control on K reads L, and one on 1 reads 2.",
    status: "Display only",
    hint: "The key itself works correctly. Only the label is wrong.",
  },
  {
    title: "Adrenaline skill icons can flicker",
    symptom: "Icons of adrenaline skills can flicker on the skill bar. This also happens in ArenaNet’s phone app.",
    status: "Display only",
    hint: "The skills work normally.",
  },
] as const;
</script>

<template>
  <section class="page help-page">
    <div class="page-head"><div><h1>Known issues</h1><p>Open issues in ArenaNet’s official game client. gwonmac cannot fix them, but you can work around most of them.</p></div><span class="chip">Bundled with this launcher version</span></div>

    <ul class="issue-catalogue" aria-label="Known issue list">
      <li v-for="issue in issues" :key="issue.title" class="issue-card">
        <div class="issue-heading"><span class="issue-symbol"><AlertTriangle /></span><h2>{{ issue.title }}</h2><span class="chip accent issue-status">{{ issue.status }}</span></div>
        <p>{{ issue.symptom }}</p>
        <div class="workaround"><RotateCcw v-if="issue.status === 'Reload helps'" /><Info v-else /><div><strong>What you can do</strong><p>{{ issue.hint }}</p></div></div>
      </li>
    </ul>
    <p class="issue-source-note">This list may not include a newly reported issue yet. Check Discord for the latest discussion.</p>

    <section class="issue-help" aria-labelledby="issue-help-title">
      <span class="issue-help-icon"><Smartphone /></span>
      <div>
        <h2 id="issue-help-title">Check whether the problem also happens on your phone</h2>
        <ol>
          <li>Repeat the same action in ArenaNet’s official Guild Wars Reforged phone app, if possible.</li>
          <li>Write down the map, action, and whether the game crashed.</li>
          <li>If it also happens on your phone, report it to ArenaNet. If it happens only on Mac, report it to gwonmac.</li>
        </ol>
        <div class="issue-help-actions">
          <button class="secondary" @click="emit('external', 'discord')"><DiscordIcon />Ask on Discord</button>
          <button class="secondary" @click="emit('external', 'bugReport')"><Github />Report Mac issue</button>
          <button class="secondary" @click="emit('external', 'arenaNetSupport')">Report to ArenaNet <ExternalLink /></button>
        </div>
        <p class="issue-help-note">To attach diagnostics, choose <strong>Help → Diagnostics → Export Recent Diagnostics…</strong> in a game window.</p>
      </div>
    </section>

    <section class="feedback-card" aria-labelledby="feedback-title">
      <h2 id="feedback-title">Tell us about a problem or an idea</h2>
      <div v-if="state === 'sent'" class="feedback-sent" role="status"><Check /><strong>Thanks, we got your message.</strong><button class="text-link" @click="state = 'editing'">Send another</button></div>
      <form v-else class="feedback-form" @submit.prevent="submit">
        <label>Message<textarea v-model="message" rows="5" :maxlength="LAUNCHER_FEEDBACK_MESSAGE_LIMIT" placeholder="What did you do, and what happened? A short description is enough." /></label>
        <div class="form-row">
          <label>Type<select v-model="kind"><option value="problem">Problem</option><option value="idea">Idea</option><option value="other">Something else</option></select></label>
          <label>Email (optional)<input v-model="email" type="email" autocomplete="email" placeholder="Only if you want an answer" /></label>
        </div>
        <p class="feedback-note">Your message goes to the gwonmac team through Basin, a form service, together with your app version, update channel, and macOS version. Nothing else is sent.</p>
        <p v-if="state === 'failed'" class="inline-message" role="alert">Your message could not be sent. Check your connection and try again, or ask on Discord.</p>
        <div class="form-actions"><button type="submit" class="primary" :disabled="!feedback || state === 'sending'">{{ state === 'sending' ? 'Sending…' : 'Send' }}</button></div>
      </form>
    </section>
  </section>
</template>
