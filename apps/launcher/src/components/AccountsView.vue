<script setup lang="ts">
import { computed } from "vue";
import { Archive, Crown, Flame, Map as MapIcon, Pencil, Play, Plus, RotateCcw, ScrollText, Shield, Star, Swords } from "lucide-vue-next";
import type { LauncherProfileSummary, LauncherReadiness } from "@shared/launcher-contracts";
import type { ProfileId } from "@shared/multiple-accounts";
import { profileStatus } from "../launcher-view-model";

const props = defineProps<{
  profiles: readonly LauncherProfileSummary[];
  selected: readonly ProfileId[];
  readiness: LauncherReadiness;
}>();
const activeProfiles = computed(() => props.profiles.filter(profile => !profile.archived));
const openCount = computed(() => activeProfiles.value.filter(profile => profile.state === "running").length);
const failedCount = computed(() => activeProfiles.value.filter(profile => profile.state === "failed").length);
const emit = defineEmits<{
  add: [];
  toggle: [id: ProfileId];
  customize: [profile: LauncherProfileSummary];
  show: [id: ProfileId];
  play: [id: ProfileId];
  cancel: [id: ProfileId];
  restore: [id: ProfileId];
  delete: [id: ProfileId];
}>();

const profileIcons = { swords: Swords, archive: Archive, map: MapIcon, scroll: ScrollText, shield: Shield, star: Star, crown: Crown, flame: Flame } as const;
</script>

<template>
  <section class="page accounts-page">
    <div class="page-head">
      <div><h1>Accounts</h1><p>{{ activeProfiles.length }} accounts · {{ openCount }} open<span v-if="failedCount"> · {{ failedCount }} need attention</span></p></div>
      <button class="secondary" @click="emit('add')"><Plus />Add account</button>
    </div>
    <div class="accounts-list-heading"><span>Select accounts to open together.</span><span>Play or show one account</span></div>
    <div class="account-cards">
      <article v-for="profile in activeProfiles" :key="profile.id" class="account-card" :class="{ selected: selected.includes(profile.id) }">
        <input class="account-select" type="checkbox" :disabled="selected.length === 1 && selected.includes(profile.id)" :title="selected.length === 1 && selected.includes(profile.id) ? 'Select another account before removing this one' : undefined" :checked="selected.includes(profile.id)" :aria-label="`Select ${profile.name}`" @change="emit('toggle', profile.id)" />
        <div class="avatar" :style="{ background: profile.appearance.color }" aria-hidden="true"><component :is="profileIcons[profile.appearance.icon as keyof typeof profileIcons] ?? Swords" /></div>
        <div class="account-details"><h2>{{ profile.name }}</h2></div>
        <p class="account-state" :class="{ failed: profile.state === 'failed' }" :role="profile.state === 'opening' || profile.state === 'checking' ? 'status' : undefined"><span class="status-dot" :class="profile.state" aria-hidden="true" />{{ profileStatus(profile) }}</p>
        <div class="account-actions">
          <button v-if="profile.state === 'running'" class="profile-action" :aria-label="`Show ${profile.name}`" @click="emit('show', profile.id)">Show</button>
          <button v-else-if="profile.state === 'ready' || profile.state === 'failed'" class="profile-action" :aria-label="`${readiness.state === 'repair-required' ? 'Repair game files for' : profile.state === 'failed' ? 'Try again for' : 'Play'} ${profile.name}`" @click="emit('play', profile.id)"><RotateCcw v-if="profile.state === 'failed' || readiness.state === 'repair-required'" aria-hidden="true" /><Play v-else aria-hidden="true" />{{ readiness.state === 'repair-required' ? 'Repair' : profile.state === 'failed' ? 'Try again' : 'Play' }}</button>
          <button v-else-if="profile.state === 'queued'" class="profile-action" :aria-label="`Cancel waiting for ${profile.name}`" @click="emit('cancel', profile.id)">Cancel</button>
          <button v-else class="profile-action" disabled>Opening</button>
          <button class="account-appearance" :aria-label="`Edit ${profile.name}`" @click="emit('customize', profile)"><Pencil aria-hidden="true" /><span>Edit</span></button>
        </div>
      </article>
    </div>
    <details v-if="profiles.some(profile => profile.archived)" class="archived-accounts">
      <summary>Archived accounts</summary>
      <article v-for="profile in profiles.filter(candidate => candidate.archived)" :key="profile.id"><span>{{ profile.name }}</span><button class="secondary" @click="emit('restore', profile.id)">Restore</button><button class="danger-button" @click="emit('delete', profile.id)">Delete permanently</button></article>
    </details>
  </section>
</template>
