<script setup lang="ts">
import { ref } from "vue";
import {
  Activity,
  BookOpen,
  Bug,
  CheckCheck,
  CircleGauge,
  ExternalLink,
  ImageOff,
  Info,
  MapPinned,
  MemoryStick,
  MessageCircle,
  Users,
} from "@lucide/vue";
import type { Scenario } from "../model";

defineProps<{ scenario: Scenario }>();
const section = ref<"current" | "resolved" | "help">("current");
const emit = defineEmits<{ sectionChange: [] }>();

const showSection = (nextSection: typeof section.value) => {
  section.value = nextSection;
  emit("sectionChange");
};
</script>

<template>
  <div class="section-layout">
    <aside class="section-sidebar">
      <span class="eyebrow">Help</span>
      <h1>Known issues</h1>
      <nav aria-label="Issue sections">
        <button type="button" :class="{ active: section === 'current' }" :aria-pressed="section === 'current'" @click="showSection('current')"><Activity aria-hidden="true" />Current</button>
        <button type="button" :class="{ active: section === 'resolved' }" :aria-pressed="section === 'resolved'" @click="showSection('resolved')"><CheckCheck aria-hidden="true" />Fixed</button>
        <button type="button" :class="{ active: section === 'help' }" :aria-pressed="section === 'help'" @click="showSection('help')"><Info aria-hidden="true" />Get help</button>
      </nav>
      <div class="help-shortcuts">
        <a href="https://github.com/Mat4m0/gwonmac/issues/new?template=bug-report.yml" target="_blank" rel="noreferrer"><Bug aria-hidden="true" />Report a bug<ExternalLink aria-hidden="true" /></a>
        <a href="https://discord.gg/Z9ft52RBD3" target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true" />Open Discord<ExternalLink aria-hidden="true" /></a>
      </div>
    </aside>

    <section class="section-content issues-screen">
      <template v-if="section === 'current'">
        <div class="content-heading">
          <div><span class="eyebrow">Status and help</span><h1>Known issues</h1><p>Check what is affected and what you can do now.</p></div>
          <span class="last-checked">Checked 10:52</span>
        </div>

        <div class="status-metrics">
          <article><span>Guild Wars</span><strong class="good-text">Playable</strong></article>
          <article><span>Optional Tools</span><strong>{{ scenario === "degraded" ? "Some unavailable" : "Available" }}</strong></article>
          <article><span>Launcher</span><strong>{{ scenario === "offline" ? "Offline" : "Online" }}</strong></article>
        </div>

        <section v-if="scenario === 'degraded'" class="incident-group" aria-labelledby="current-incidents">
          <div class="group-heading"><span class="status-dot degraded"></span><div><h2 id="current-incidents">Current incident</h2><p>Guild Wars still works.</p></div></div>
          <article class="issue-card compact-issue"><MapPinned aria-hidden="true" /><div><h3>Quick Travel is temporarily unavailable</h3><p>Your saved destinations are safe while compatibility is checked.</p></div><span class="pill warning">Checking</span></article>
          <article class="issue-card compact-issue"><Users aria-hidden="true" /><div><h3>Apply teams is temporarily unavailable</h3><p>You can still edit, import, and export builds and teams.</p></div><span class="pill warning">Checking</span></article>
        </section>

        <section class="known-limitations" aria-labelledby="known-limitations">
          <div class="group-heading"><Info aria-hidden="true" /><div><h2 id="known-limitations">Known game issues</h2><p>These do not stop you from playing.</p></div></div>
          <article class="issue-detail-card">
            <div class="issue-detail-icon"><ImageOff aria-hidden="true" /></div>
            <div class="issue-detail-copy"><span class="eyebrow">Graphics</span><h3>Textures can look wrong or disappear</h3><p>This can happen after changing areas or playing for a long time.</p><div class="workaround"><strong>What to do</strong><span>Close and reopen the game window. If it happens often, lower the render scale in Display settings.</span></div></div>
            <span class="pill">Workaround</span>
          </article>
          <article class="issue-detail-card">
            <div class="issue-detail-icon"><MemoryStick aria-hidden="true" /></div>
            <div class="issue-detail-copy"><span class="eyebrow">Memory</span><h3>Long sessions can use too much memory</h3><p>Performance can drop after many area changes. The game may eventually close.</p><div class="workaround"><strong>What to do</strong><span>Restart the game window when it becomes slow. Other open accounts are not affected.</span></div></div>
            <span class="pill warning">Investigating</span>
          </article>
        </section>

        <section class="support-strip">
          <div><strong>Still stuck?</strong><span>Check the steps, ask on Discord, or send a bug report.</span></div>
          <button class="secondary-button" type="button" @click="showSection('help')">Get help</button>
        </section>
      </template>

      <template v-else-if="section === 'resolved'">
        <div class="content-heading"><div><span class="eyebrow">History</span><h1>Fixed issues</h1><p>Recent problems that no longer need a workaround.</p></div></div>
        <div class="resolved-list">
          <article><CheckCheck aria-hidden="true" /><div><h2>Skill templates save and load again</h2><p>Fixed in version 2026.7.0-beta.1.</p></div><span>Aug 12</span></article>
          <article><CheckCheck aria-hidden="true" /><div><h2>Identification and salvage kits respond to double-click</h2><p>Fixed in version 2026.7.0-beta.1.</p></div><span>Aug 12</span></article>
          <article><CheckCheck aria-hidden="true" /><div><h2>Context cursors restored</h2><p>Native game cursors now update for actions such as salvaging and travel.</p></div><span>Aug 9</span></article>
        </div>
      </template>

      <template v-else>
        <div class="content-heading"><div><span class="eyebrow">Support</span><h1>Get help</h1><p>Start with the quick checks. Send a report if the problem continues.</p></div></div>
        <div class="help-grid">
          <article class="help-card">
            <BookOpen aria-hidden="true" /><span class="eyebrow">First</span><h2>Try the common fixes</h2>
            <ol><li>Update to the latest launcher version.</li><li>Close and reopen the affected game window.</li><li>Lower the render scale if the game is slow.</li><li>Let the full game download finish if audio stutters.</li></ol>
          </article>
          <article class="help-card">
            <CircleGauge aria-hidden="true" /><span class="eyebrow">For performance problems</span><h2>Include useful diagnostics</h2>
            <p>Diagnostics are optional and are never uploaded automatically.</p>
            <ol><li>Open Help → Diagnostics.</li><li>Start a performance capture.</li><li>Reproduce the problem, then stop the capture.</li><li>Attach the exported ZIP to your report.</li></ol>
          </article>
        </div>
        <section class="contact-panel">
          <div><span class="eyebrow">Contact</span><h2>Ask a question or report a problem</h2><p>Discord is best for quick help. GitHub is best when you have clear steps to reproduce a bug.</p></div>
          <div class="contact-actions">
            <a class="secondary-button" href="https://discord.gg/Z9ft52RBD3" target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true" />Open Discord<ExternalLink aria-hidden="true" /></a>
            <a class="primary-button" href="https://github.com/Mat4m0/gwonmac/issues/new?template=bug-report.yml" target="_blank" rel="noreferrer"><Bug aria-hidden="true" />Report a bug<ExternalLink aria-hidden="true" /></a>
          </div>
        </section>
      </template>
    </section>
  </div>
</template>
