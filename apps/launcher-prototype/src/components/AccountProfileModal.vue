<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { X } from "@lucide/vue";
import AccountAvatar from "./AccountAvatar.vue";
import BaseModal from "./BaseModal.vue";
import type { AccountColor, AccountIcon, AccountProfile } from "../model";

const props = defineProps<{
  account?: AccountProfile;
}>();

const emit = defineEmits<{
  close: [];
  save: [profile: AccountProfile];
}>();

const iconOptions: Array<{ value: AccountIcon; label: string }> = [
  { value: "user", label: "Character" },
  { value: "chest", label: "Storage" },
  { value: "swords", label: "Combat" },
  { value: "shield", label: "Support" },
  { value: "crown", label: "Leader" },
];

const colorOptions: Array<{ value: AccountColor; label: string }> = [
  { value: "amber", label: "Amber" },
  { value: "red", label: "Red" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "violet", label: "Violet" },
];

const profile = reactive<AccountProfile>({ name: "", icon: "user", color: "amber" });
const isEditing = computed(() => Boolean(props.account));

watch(
  () => props.account,
  (account) => {
    Object.assign(profile, account ?? { name: "", icon: "user", color: "amber" });
  },
  { immediate: true },
);

const submit = () => {
  const name = profile.name.trim();
  if (!name) return;
  emit("save", { name, icon: profile.icon, color: profile.color });
};
</script>

<template>
  <BaseModal :title="isEditing ? 'Edit account' : 'Add an account'" @close="emit('close')">
    <button class="modal-close" type="button" aria-label="Close" @click="emit('close')"><X aria-hidden="true" /></button>
    <span class="eyebrow">Accounts</span>
    <h1>{{ isEditing ? "Edit account" : "Add an account" }}</h1>
    <p>Choose a name and appearance for this game window.</p>

    <form class="account-profile-form" @submit.prevent="submit">
      <div class="account-profile-preview">
        <AccountAvatar :icon="profile.icon" :color="profile.color" />
        <div><strong>{{ profile.name.trim() || "New account" }}</strong><small>Preview</small></div>
      </div>

      <label class="field-label" for="account-profile-name">Account name</label>
      <input id="account-profile-name" v-model="profile.name" name="account-name" autocomplete="off" placeholder="Storage account" required />

      <fieldset class="profile-choice-group">
        <legend>Icon</legend>
        <div class="profile-icon-options">
          <label v-for="option in iconOptions" :key="option.value" :title="option.label">
            <input v-model="profile.icon" type="radio" name="account-icon" :value="option.value" />
            <AccountAvatar :icon="option.value" :color="profile.color" />
            <span>{{ option.label }}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="profile-choice-group">
        <legend>Color</legend>
        <div class="profile-color-options">
          <label v-for="option in colorOptions" :key="option.value" :title="option.label">
            <input v-model="profile.color" type="radio" name="account-color" :value="option.value" />
            <span class="profile-color-dot" :class="`account-color-${option.value}`"></span>
            <span>{{ option.label }}</span>
          </label>
        </div>
      </fieldset>

      <div class="modal-actions">
        <button class="secondary-button" type="button" @click="emit('close')">Cancel</button>
        <button class="primary-button" type="submit">{{ isEditing ? "Save account" : "Add account" }}</button>
      </div>
    </form>
  </BaseModal>
</template>
