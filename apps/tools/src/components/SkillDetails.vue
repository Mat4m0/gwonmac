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
/** The character's current rank in the skill's attribute, when observed. */
const props = defineProps<{ skill: SkillPresentation; rank?: number | null }>();
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
/**
 * Values that grow with the attribute read "10...45". With an observed rank the
 * game shows the one value that applies; ranks above 15 continue the same line.
 */
const description = computed(() => (props.skill.description ?? "").split(/(\d+\.\.\.\d+)/u).map((text, index) => {
  if (index % 2 === 0) return { text, scaled: false, range: "" };
  const [low, high] = text.split("...").map(Number) as [number, number];
  const rank = props.rank;
  return { text: rank === null || rank === undefined ? text : String(Math.round(low + (high - low) * rank / 15)), scaled: true, range: text };
}));
const attributeLabel = computed(() => props.skill.attribute?.replace(/([a-z])([A-Z])/gu, "$1 $2") ?? null);
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
        <small><ProfessionIcon :profession="skill.profession" /> {{ skill.profession ? PROFESSIONS[skill.profession].name : "PvE" }}<template v-if="attributeLabel"> · {{ attributeLabel }}<span v-if="rank !== null && rank !== undefined" class="skill-rank"> ({{ rank }})</span></template></small>
      </span>
    </div>
    <dl v-if="stats.length || aftercast" class="skill-stats" aria-label="Skill costs and timings">
      <div v-for="stat in stats" :key="stat.label" :title="`${stat.label}: ${stat.value}${stat.unit}`">
        <dt><img :src="stat.icon" :alt="stat.label" width="20" height="20" draggable="false"></dt>
        <dd>{{ stat.text }}</dd>
      </div>
      <div v-if="aftercast" class="skill-aftercast" title="Aftercast differs from the usual ¾ second"><dt>Aftercast</dt><dd>{{ aftercast }}</dd></div>
    </dl>
    <p v-if="skill.availability === 'player-only-pve'" class="skill-restriction">Player only · Heroes cannot equip this skill</p>
    <div v-if="skill.description" class="skill-description"><p><template v-for="(part, index) in description" :key="index"><span v-if="part.scaled" class="skill-scaled" :title="rank === null || rank === undefined ? `Grows with ${attributeLabel ?? 'the attribute'}, rank 0 to 15` : `${part.range} across ${attributeLabel} 0–15 · you have ${rank}`">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></p></div>
    <p v-else class="description-unavailable">Description is unavailable from this installed client.</p>
    <slot name="context" />
  </div>
</template>
