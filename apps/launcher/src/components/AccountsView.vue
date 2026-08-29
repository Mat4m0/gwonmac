<script setup lang="ts">
import { Archive, Crown, Flame, Map as MapIcon, Play, Plus, RotateCcw, ScrollText, Settings, Shield, Star, Swords } from "lucide-vue-next";
import type { LauncherProfileSummary } from "@shared/launcher-contracts";
import type { ProfileId } from "@shared/multiple-accounts";
import { profileStatus } from "../launcher-view-model";

defineProps<{ profiles: readonly LauncherProfileSummary[] }>();
const emit = defineEmits<{
  add: [];
  customize: [profile: LauncherProfileSummary];
  show: [id: ProfileId];
  play: [id: ProfileId];
  archive: [id: ProfileId];
  restore: [id: ProfileId];
  delete: [id: ProfileId];
}>();

const profileIcons = { swords: Swords, archive: Archive, map: MapIcon, scroll: ScrollText, shield: Shield, star: Star, crown: Crown, flame: Flame } as const;
</script>

<template>
  <section class="page accounts-page">
    <div class="page-head"><div><span class="eyebrow">Accounts</span><h1>Game windows</h1><p>Add another account when you want another game window.</p></div><button class="secondary" @click="emit('add')"><Plus />Add account</button></div>
    <div class="account-cards">
      <article v-for="(profile, index) in profiles.filter(candidate => !candidate.archived)" :key="profile.id" class="account-card">
        <div class="avatar" :style="{ background: profile.appearance.color }"><component :is="profileIcons[profile.appearance.icon as keyof typeof profileIcons] ?? Swords" /></div>
        <div><h3>{{ profile.name }}</h3><p>{{ profileStatus(profile) }}</p></div>
        <span class="status-dot" :class="profile.state" />
        <div class="account-actions">
          <button class="secondary" @click="emit('customize', profile)"><Settings />Customize</button>
          <button v-if="profile.state === 'running'" class="secondary" @click="emit('show', profile.id)">Show</button>
          <template v-else>
            <button v-if="index > 0" class="text-link" @click="emit('archive', profile.id)">Archive</button>
            <button class="secondary" @click="emit('play', profile.id)"><RotateCcw v-if="profile.state === 'failed'" /><Play v-else />{{ profile.state === 'failed' ? 'Try again' : 'Play' }}</button>
          </template>
        </div>
      </article>
    </div>
    <details v-if="profiles.some(profile => profile.archived)" class="archived-accounts">
      <summary>Archived accounts</summary>
      <article v-for="profile in profiles.filter(candidate => candidate.archived)" :key="profile.id"><span>{{ profile.name }}</span><button class="secondary" @click="emit('restore', profile.id)">Restore</button><button class="danger-button" @click="emit('delete', profile.id)">Delete permanently</button></article>
    </details>
  </section>
</template>
