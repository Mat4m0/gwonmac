<script setup lang="ts">
/**
 * The launcher's one help destination: the bundled Guide, open issues in
 * ArenaNet's official client, and where to report a problem. The feedback form
 * shows success only after main confirms that Basin accepted the report.
 */
import { computed, nextTick, ref } from "vue";
import { Check, ExternalLink, Github, Info, Smartphone } from "lucide-vue-next";
import { LAUNCHER_FEEDBACK_MESSAGE_LIMIT, parseLauncherFeedback, type LauncherExternalLink, type LauncherFeedback, type LauncherFeedbackKind } from "@shared/launcher-contracts";
import type { MarkdownBlock, MarkdownInline as Inline } from "@shared/launcher-markdown";
import type { SettingsTarget } from "@shared/settings-catalogue";
import { GUIDE_HELP_PAGES, GUIDE_PAGES, parseGuideAction, type GuidePageId } from "../guide";
import DiscordIcon from "./DiscordIcon.vue";
import MarkdownBody from "./MarkdownBody.vue";
import MarkdownInline from "./MarkdownInline.vue";

export type HelpPage = GuidePageId | "report";

const props = defineProps<{ send: (feedback: LauncherFeedback) => Promise<void>; page?: HelpPage | undefined }>();
const emit = defineEmits<{ external: [kind: LauncherExternalLink]; url: [url: string]; settings: [target: SettingsTarget] }>();

const active = ref<HelpPage>(props.page ?? "known-issues");
const content = ref<HTMLElement | null>(null);
const guidePage = computed(() => GUIDE_PAGES.find((candidate) => candidate.id === active.value));
const helpNav = GUIDE_PAGES.filter((candidate) => GUIDE_HELP_PAGES.includes(candidate.id));
const featureNav = GUIDE_PAGES.filter((candidate) => !GUIDE_HELP_PAGES.includes(candidate.id));

async function show(target: HelpPage, anchor?: string) {
  active.value = target;
  await nextTick();
  const heading = anchor ? content.value?.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`) : null;
  if (heading) heading.scrollIntoView({ block: "start" });
  else content.value?.closest(".page")?.scrollTo({ top: 0 });
}

function follow(actionId: string) {
  const action = parseGuideAction(actionId);
  if (action?.kind === "guide") void show(action.page, action.anchor);
  else if (action?.kind === "settings") emit("settings", action.target);
  else if (action?.kind === "url") emit("url", action.url);
}

// A known issue is a `##` section of the known-issues page; its
// "**What you can do:**" paragraph becomes the highlighted workaround.
const HINT = "What you can do:";
const issues = computed(() => {
  const blocks = GUIDE_PAGES.find((candidate) => candidate.id === "known-issues")!.blocks;
  const result: { title: string; symptom: MarkdownBlock[]; hint: readonly Inline[] }[] = [];
  for (const block of blocks) {
    if (block.type === "heading" && !block.level) result.push({ title: block.text, symptom: [], hint: [] });
    else if (!result.length) continue;
    else if (block.type === "paragraph" && block.content[0]?.emphasis === "strong" && block.content[0].text === HINT) {
      result.at(-1)!.hint = block.content.slice(1).map((part, index) => index === 0 ? { ...part, text: part.text.trimStart() } : part);
    } else result.at(-1)!.symptom.push(block);
  }
  return result;
});
const issueIntro = computed(() => {
  const blocks = GUIDE_PAGES.find((candidate) => candidate.id === "known-issues")!.blocks;
  const first = blocks.findIndex((block) => block.type === "heading");
  return blocks.slice(0, first < 0 ? blocks.length : first);
});

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
</script>

<template>
  <section class="page help-page">
    <div class="help-layout">
      <nav class="help-nav" aria-label="Help">
        <div class="help-nav-group">
          <h2>Get help</h2>
          <button v-for="item in helpNav" :key="item.id" :class="{ active: active === item.id }" :aria-current="active === item.id ? 'page' : undefined" @click="show(item.id)">{{ item.title }}</button>
          <button :class="{ active: active === 'report' }" :aria-current="active === 'report' ? 'page' : undefined" @click="show('report')">Report a problem</button>
        </div>
        <div class="help-nav-group">
          <h2>Features</h2>
          <button v-for="item in featureNav" :key="item.id" :class="{ active: active === item.id }" :aria-current="active === item.id ? 'page' : undefined" @click="show(item.id)">{{ item.title }}</button>
        </div>
      </nav>

      <div ref="content" class="help-content">
        <template v-if="active === 'known-issues'">
          <div class="page-head"><div><h1>Known issues</h1><MarkdownBody class="help-intro" :blocks="issueIntro" @link="follow" /></div></div>
          <ul class="issue-catalogue" aria-label="Known issue list">
            <li v-for="issue in issues" :key="issue.title" class="issue-card">
              <h2>{{ issue.title }}</h2>
              <MarkdownBody :blocks="issue.symptom" @link="follow" />
              <div v-if="issue.hint.length" class="workaround"><Info /><div><strong>What you can do</strong><p><MarkdownInline :parts="issue.hint" @link="follow" /></p></div></div>
            </li>
          </ul>
        </template>

        <template v-else-if="active === 'report'">
          <div class="page-head"><div><h1>Report a problem</h1><p>Ask on Discord, open a GitHub issue, or send us a message below.</p></div></div>
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
        </template>

        <article v-else-if="guidePage" class="guide-page">
          <div class="page-head"><div><h1>{{ guidePage.title }}</h1><p>{{ guidePage.summary }}</p></div></div>
          <MarkdownBody :blocks="guidePage.blocks" @link="follow" />
        </article>
      </div>
    </div>
  </section>
</template>
