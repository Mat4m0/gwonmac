<script setup lang="ts">
import type { Component } from "vue";
import { Crown, Shield, Swords, UserRound, Vault } from "@lucide/vue";
import type { AccountColor, AccountIcon } from "../model";

defineProps<{
  icon: AccountIcon;
  color: AccountColor;
}>();

const icons: Record<AccountIcon, Component> = {
  user: UserRound,
  chest: Vault,
  swords: Swords,
  shield: Shield,
  crown: Crown,
};
</script>

<template>
  <span class="account-avatar-base" :class="`account-color-${color}`" aria-hidden="true">
    <component :is="icons[icon]" />
  </span>
</template>
