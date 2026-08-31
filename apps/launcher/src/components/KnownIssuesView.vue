<script setup lang="ts">
import { AlertTriangle, Check, ExternalLink, Github, MessageCircle, RotateCcw, Smartphone, Wrench } from "lucide-vue-next";
import type { LauncherExternalLink } from "@shared/launcher-contracts";

defineProps<{ availability: "fixture" | "placeholder" }>();
const emit = defineEmits<{ external: [kind: LauncherExternalLink] }>();
</script>

<template>
  <section class="page issues-page">
    <div class="page-head"><div><span class="eyebrow">Support</span><h1>Known issues</h1><p>Problems we know about, what they look like, and what you can do now.</p></div><span class="issue-review-note">Bundled with this launcher version</span></div>

    <ul class="issue-catalogue" aria-label="Known issue list">
      <li class="issue-card issue-open">
        <div class="issue-heading"><span class="issue-symbol"><AlertTriangle /></span><div><span class="issue-kind">Graphics</span><h2>Some textures appear black or missing</h2></div><span class="issue-status">Workaround available</span></div>
        <p>Parts of a character, map, or effect can render as a flat black area. Saved data is not affected.</p>
        <div class="workaround"><Wrench /><div><strong>Workaround</strong><p>Close only the affected game window and open that account again. Other open accounts can stay running.</p></div></div>
      </li>

      <li class="issue-card issue-open">
        <div class="issue-heading"><span class="issue-symbol"><AlertTriangle /></span><div><span class="issue-kind">Performance</span><h2>Memory use can grow during long sessions</h2></div><span class="issue-status">Workaround available</span></div>
        <p>A game window can use more memory after many map changes or a long play session.</p>
        <div class="workaround"><RotateCcw /><div><strong>Workaround</strong><p>Reopen that game window if macOS shows a memory warning. Extended memory can delay the warning, but it does not remove the underlying problem.</p></div></div>
      </li>

      <li class="issue-card issue-resolved">
        <div class="issue-heading"><span class="issue-symbol"><Check /></span><div><span class="issue-kind">Maps</span><h2>Map reveal could close the game</h2></div><span class="issue-status">Resolved</span></div>
        <p>This was fixed in the current launcher version. No workaround is needed.</p>
      </li>
    </ul>

    <section class="issue-help" aria-labelledby="issue-help-title">
      <span class="issue-help-icon"><Smartphone /></span>
      <div>
        <span class="issue-kind">How to help</span>
        <h2 id="issue-help-title">Check whether the problem also happens on your phone</h2>
        <ol>
          <li>Repeat the same action in ArenaNet’s official Guild Wars Reforged phone app, if possible.</li>
          <li>Write down the map, action, and whether the game crashed.</li>
          <li>If it also happens on your phone, report it to ArenaNet. If it happens only on Mac, report it to gwonmac.</li>
        </ol>
        <div class="issue-help-actions">
          <button class="primary" @click="emit('external', 'arenaNetSupport')">Report to ArenaNet <ExternalLink /></button>
          <button class="secondary" @click="emit('external', 'discord')"><MessageCircle />Ask on Discord</button>
          <button class="secondary" @click="emit('external', 'bugReport')"><Github />Report Mac issue</button>
        </div>
      </div>
    </section>

    <p v-if="availability === 'placeholder'" class="issue-source-note">This list ships with the launcher and may not include a newly reported issue yet. Check Discord or GitHub for the latest discussion.</p>
  </section>
</template>
