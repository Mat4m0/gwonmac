<!-- Shared skill information for Builds and Elite Skills, in the order and notation of the game's own skill description; actions belong to each consumer. -->
<script setup lang="ts">
import ProfessionIcon from "./ProfessionIcon.vue";
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
/** The game writes quarter seconds as fractions: ¼, ½, ¾, 1½. */
const FRACTIONS: Readonly<Record<number, string>> = { 0: "", 0.25: "¼", 0.5: "½", 0.75: "¾" };
function seconds(value: number): string {
  const whole = Math.floor(value); const fraction = FRACTIONS[Math.round((value - whole) * 100) / 100];
  if (fraction === undefined) return String(value);
  return `${whole > 0 ? whole : ""}${fraction}` || "0";
}
const stats = computed(() => [
  { label: "Adrenaline", value: props.skill.adrenalineCost, text: String(props.skill.adrenalineCost), unit: " strikes", icon: adrenalineIcon },
  { label: "Energy", value: props.skill.energyCost, text: String(props.skill.energyCost), unit: "", icon: energyIcon },
  { label: "Overcast", value: props.skill.overcast, text: String(props.skill.overcast), unit: "", icon: overcastIcon },
  { label: "Health sacrifice", value: props.skill.healthCost, text: `${props.skill.healthCost}%`, unit: "", icon: sacrificeIcon },
  { label: "Activation", value: props.skill.activationSeconds, text: seconds(props.skill.activationSeconds), unit: " seconds", icon: activationIcon },
  { label: "Recharge", value: props.skill.rechargeSeconds, text: seconds(props.skill.rechargeSeconds), unit: " seconds", icon: rechargeIcon },
].filter(stat => stat.value !== 0));
/** Aftercast is noted only where it differs from the usual ¾ second after a cast. */
const aftercast = computed(() => props.skill.activationSeconds > 0 && props.skill.aftercastSeconds !== 0.75 ? seconds(props.skill.aftercastSeconds) : null);
/** Values that grow with the attribute read "10...45"; the game highlights them. */
const description = computed(() => (props.skill.description ?? "").split(/(\d+\.\.\.\d+)/u)
  .map((text, index) => ({ text, scaled: index % 2 === 1 })));
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
        <small class="skill-type" :data-elite="skill.elite ? '' : undefined">{{ skill.elite ? `Elite ${skill.type}` : skill.type }}</small>
        <small><ProfessionIcon :profession="skill.profession" /> {{ skill.profession ? PROFESSIONS[skill.profession].name : "PvE" }}<template v-if="skill.attribute"> · {{ skill.attribute.replace(/([a-z])([A-Z])/gu, "$1 $2") }}</template></small>
      </span>
    </div>
    <slot name="context" />
    <dl v-if="stats.length || aftercast" class="skill-stats" aria-label="Skill costs and timings">
      <div v-for="stat in stats" :key="stat.label" :title="`${stat.label}: ${stat.value}${stat.unit}`">
        <dt><img :src="stat.icon" :alt="stat.label" width="20" height="20" draggable="false"></dt>
        <dd>{{ stat.text }}</dd>
      </div>
      <div v-if="aftercast" class="skill-aftercast" title="Aftercast differs from the usual ¾ second"><dt>Aftercast</dt><dd>{{ aftercast }}</dd></div>
    </dl>
    <p v-if="skill.availability === 'player-only-pve'" class="skill-restriction">Player only · Heroes cannot equip this skill</p>
    <div v-if="skill.description" class="skill-description"><p><template v-for="(part, index) in description" :key="index"><span v-if="part.scaled" class="skill-scaled" title="Grows with the attribute, from rank 0 to rank 15">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></p></div>
    <p v-else class="description-unavailable">Description is unavailable from this installed client.</p>
  </div>
</template>
