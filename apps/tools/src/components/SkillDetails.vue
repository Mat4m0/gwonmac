<!-- Shared skill information for Builds and Elite Skills; actions belong to each consumer. -->
<script setup lang="ts">
import type { SkillPresentation } from "../skill-catalog";
defineProps<{ skill: SkillPresentation }>();
function hideBrokenIcon(event: Event): void {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true;
}
</script>
<template>
  <div class="skill-details">
          <div class="inspector-identity">
            <span
              class="ui-slot skill"
              :data-elite="skill.elite ? '' : undefined"
              :data-profession="skill.profession"
              :data-icon-missing="skill.iconUrl ? undefined : ''"
            >
              <img
                v-if="skill.iconUrl"
                :src="skill.iconUrl"
                alt=""
                draggable="false"
                @error="hideBrokenIcon"
              >
              <span class="skill-fallback" aria-hidden="true">
                {{ skill.name.split(" ").map((part) => part[0]).join("").slice(0, 3) }}
              </span>
            </span>
            <span>
              <strong>{{ skill.name }}</strong>
              <small>
                {{ skill.profession ?? "PvE" }}
                <template v-if="skill.attribute"> · {{ skill.attribute.replace(/([a-z])([A-Z])/gu, "$1 $2") }}</template>
              </small>
            </span>
          </div>
          <div class="mechanic-list">
            <span v-if="skill.elite"><strong>Elite</strong><small>One per bar</small></span>
            <span v-if="skill.availability === 'player-only-pve'">
              <strong>Player only</strong><small>Heroes cannot equip this skill</small>
            </span>
            <span v-if="skill.energyCost"><strong>{{ skill.energyCost }}</strong><small>Energy</small></span>
            <span v-if="skill.adrenalineCost"><strong>{{ skill.adrenalineCost }}</strong><small>Adrenaline</small></span>
            <span v-if="skill.healthCost"><strong>{{ skill.healthCost }}%</strong><small>Health</small></span>
            <span v-if="skill.overcast"><strong>{{ skill.overcast }}</strong><small>Overcast</small></span>
            <span v-if="skill.activationSeconds"><strong>{{ skill.activationSeconds }}s</strong><small>Activation</small></span>
            <span v-if="skill.aftercastSeconds"><strong>{{ skill.aftercastSeconds }}s</strong><small>Aftercast</small></span>
            <span v-if="skill.rechargeSeconds"><strong>{{ skill.rechargeSeconds }}s</strong><small>Recharge</small></span>
          </div>
          <div v-if="skill.description" class="skill-description">
            <strong>Description</strong>
            <p>{{ skill.description }}</p>
          </div>
          <p v-else class="description-unavailable">
            Description is unavailable from this installed client.
          </p>
  </div>
</template>
