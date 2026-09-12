<!-- Shared skill information for Builds and Elite Skills; actions belong to each consumer. -->
<script setup lang="ts">
import { computed } from "vue";
import type { SkillPresentation } from "../skill-catalog";
import { PROFESSIONS } from "../../../../src/shared/builds/heroes";
import energyIcon from "../assets/skill-stats/energy.png";
import adrenalineIcon from "../assets/skill-stats/adrenaline.png";
import activationIcon from "../assets/skill-stats/activation.png";
import rechargeIcon from "../assets/skill-stats/recharge.png";
import sacrificeIcon from "../assets/skill-stats/sacrifice.png";
import overcastIcon from "../assets/skill-stats/overcast.png";
import "../styles/skill-details.css";
const props = defineProps<{ skill: SkillPresentation }>();
const stats = computed(() => [
  { label: "Energy", value: props.skill.energyCost, suffix: "", icon: energyIcon },
  { label: "Adrenaline", value: props.skill.adrenalineCost, suffix: "", icon: adrenalineIcon },
  { label: "Activation", value: props.skill.activationSeconds, suffix: "s", icon: activationIcon },
  { label: "Recharge", value: props.skill.rechargeSeconds, suffix: "s", icon: rechargeIcon },
  { label: "Health sacrifice", value: props.skill.healthCost, suffix: "%", icon: sacrificeIcon },
  { label: "Overcast", value: props.skill.overcast, suffix: "", icon: overcastIcon },
].filter(stat => stat.value !== 0));
function hideBrokenIcon(event: Event): void {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true;
}
</script>
<template>
  <div class="skill-details">
    <div class="inspector-identity">
      <span class="ui-slot skill" :data-elite="skill.elite ? '' : undefined" :data-profession="skill.profession"
        :data-icon-missing="skill.iconUrl ? undefined : ''">
        <img v-if="skill.iconUrl" :src="skill.iconUrl" alt="" draggable="false" @error="hideBrokenIcon">
        <span class="skill-fallback" aria-hidden="true">{{ skill.name.split(" ").map(part => part[0]).join("").slice(0, 3) }}</span>
      </span>
      <span>
        <strong>{{ skill.name }}</strong>
        <small>{{ skill.profession ? PROFESSIONS[skill.profession].name : "PvE" }}<template v-if="skill.attribute"> · {{ skill.attribute.replace(/([a-z])([A-Z])/gu, "$1 $2") }}</template></small>
        <small v-if="skill.elite" class="skill-elite-label">Elite · One per bar</small>
      </span>
    </div>
    <slot name="context" />
    <dl v-if="stats.length || skill.aftercastSeconds" class="skill-stats" aria-label="Skill costs and timings">
      <div v-for="stat in stats" :key="stat.label" :title="`${stat.label}: ${stat.value}${stat.suffix}`">
        <dt><img :src="stat.icon" :alt="stat.label" width="20" height="20" draggable="false"></dt>
        <dd>{{ stat.value }}{{ stat.suffix }}</dd>
      </div>
      <div v-if="skill.aftercastSeconds" class="skill-aftercast"><dt>Aftercast</dt><dd>{{ skill.aftercastSeconds }}s</dd></div>
    </dl>
    <p v-if="skill.availability === 'player-only-pve'" class="skill-restriction">Player only · Heroes cannot equip this skill</p>
    <div v-if="skill.description" class="skill-description"><p>{{ skill.description }}</p></div>
    <p v-else class="description-unavailable">Description is unavailable from this installed client.</p>
  </div>
</template>
