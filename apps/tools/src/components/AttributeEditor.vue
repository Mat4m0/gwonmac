<script setup lang="ts">
import { computed } from "vue";
import {
  attributePointsRemaining,
  attributePointsSpent,
  availableAttributes,
  canSetAttributeRank,
} from "../../../../src/shared/builds/authoring";
import {
  ATTRIBUTE_POINT_COST,
  ATTRIBUTES,
  PROFESSIONS,
} from "../../../../src/shared/builds/heroes";
import type {
  Attribute,
  AttributeRank,
  Profession,
} from "../../../../src/shared/builds/library";
import {
  LEVEL_20_ATTRIBUTE_BUDGET,
  PRIMARY_ATTRIBUTE,
} from "../../../../src/shared/builds/validate";
import type { BuildDraftController } from "../use-build-draft";

const props = defineProps<{ editor: BuildDraftController }>();
const professions = Object.entries(PROFESSIONS) as readonly [
  Profession,
  { id: number; name: string },
][];

const label = (attribute: Attribute) =>
  attribute.replace(/([a-z])([A-Z])/gu, "$1 $2");

const attributes = computed(() =>
  availableAttributes(props.editor.draft.value.professions),
);
const primaryAttributes = computed(() => {
  const profession = props.editor.draft.value.professions[0];
  const primary = PRIMARY_ATTRIBUTE[profession];
  return [
    primary,
    ...attributes.value.filter(
      (attribute) =>
        attribute !== primary && ATTRIBUTES[attribute].profession === profession,
    ),
  ];
});
const secondaryAttributes = computed(() => {
  const secondary = props.editor.draft.value.professions[1];
  return secondary === null
    ? []
    : attributes.value.filter(
        (attribute) => ATTRIBUTES[attribute].profession === secondary,
      );
});
const spent = computed(() =>
  attributePointsSpent(props.editor.draft.value.attributes),
);
const remaining = computed(() =>
  attributePointsRemaining(props.editor.draft.value.attributes),
);

function rank(attribute: Attribute): AttributeRank {
  return props.editor.draft.value.attributes[attribute] ?? 0;
}

function change(attribute: Attribute, delta: -1 | 1): void {
  const next = Math.max(0, Math.min(12, rank(attribute) + delta)) as AttributeRank;
  if (delta < 0 || canSetAttributeRank(
    props.editor.draft.value.attributes,
    attribute,
    next,
  )) {
    props.editor.setRank(attribute, next);
  }
}

function nextCost(attribute: Attribute): number | null {
  const current = rank(attribute);
  if (current >= 12) return null;
  return ATTRIBUTE_POINT_COST[(current + 1) as AttributeRank]
    - ATTRIBUTE_POINT_COST[current];
}

function unaffordable(attribute: Attribute): boolean {
  const current = rank(attribute);
  return current >= 12 || !canSetAttributeRank(
    props.editor.draft.value.attributes,
    attribute,
    (current + 1) as AttributeRank,
  );
}

function onRankKeydown(attribute: Attribute, event: KeyboardEvent): void {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  change(attribute, event.key === "ArrowUp" ? 1 : -1);
}
</script>

<template>
  <section class="attribute-workspace" aria-labelledby="attributes-title">
    <header class="workspace-heading">
      <div>
        <h2 id="attributes-title">Professions & attributes</h2>
        <p>Set the character first. Skills and available attributes follow this pair.</p>
      </div>
      <output class="attribute-budget" aria-live="polite">
        <strong>{{ spent }} invested</strong>
        <span>{{ remaining }} remaining · {{ LEVEL_20_ATTRIBUTE_BUDGET }} total</span>
      </output>
    </header>

    <div class="profession-editor">
      <label>
        <span>Primary profession</span>
        <select
          class="ui-select"
          :value="editor.draft.value.professions[0]"
          @change="editor.setPrimary(($event.target as HTMLSelectElement).value as Profession)"
        >
          <option v-for="[key, facts] in professions" :key="key" :value="key">
            {{ facts.name }} ({{ key }})
          </option>
        </select>
      </label>
      <label>
        <span>Secondary profession</span>
        <select
          class="ui-select"
          :value="editor.draft.value.professions[1] ?? ''"
          @change="editor.setSecondary(
            ($event.target as HTMLSelectElement).value
              ? ($event.target as HTMLSelectElement).value as Profession
              : null,
          )"
        >
          <option value="">None</option>
          <option
            v-for="[key, facts] in professions"
            :key="key"
            :value="key"
            :disabled="key === editor.draft.value.professions[0]"
          >
            {{ facts.name }} ({{ key }})
          </option>
        </select>
      </label>
    </div>

    <div class="attribute-groups">
      <section>
        <h3>{{ PROFESSIONS[editor.draft.value.professions[0]].name }}</h3>
        <div class="attribute-lines">
          <div
            v-for="attribute in primaryAttributes"
            :key="attribute"
            class="attribute-line"
          >
            <span>
              <strong>{{ label(attribute) }}</strong>
              <small v-if="PRIMARY_ATTRIBUTE[editor.draft.value.professions[0]] === attribute">
                Primary only
              </small>
            </span>
            <div
              class="rank-stepper"
              role="group"
              :aria-label="`${label(attribute)} rank`"
              @keydown="onRankKeydown(attribute, $event)"
            >
              <button
                class="ui-button"
                data-icon
                :disabled="rank(attribute) === 0"
                :aria-label="`Decrease ${label(attribute)}`"
                @click="change(attribute, -1)"
              >−</button>
              <output :aria-label="`${label(attribute)} rank ${rank(attribute)}`">
                {{ rank(attribute) }}
              </output>
              <button
                class="ui-button"
                data-icon
                :disabled="unaffordable(attribute)"
                :aria-label="`Increase ${label(attribute)}`"
                @click="change(attribute, 1)"
              >+</button>
            </div>
            <small class="rank-cost">
              {{ ATTRIBUTE_POINT_COST[rank(attribute)] }} pt
              <template v-if="nextCost(attribute) !== null">
                · next +{{ nextCost(attribute) }}
              </template>
            </small>
          </div>
        </div>
      </section>

      <section v-if="editor.draft.value.professions[1]">
        <h3>{{ PROFESSIONS[editor.draft.value.professions[1]].name }}</h3>
        <div class="attribute-lines">
          <div
            v-for="attribute in secondaryAttributes"
            :key="attribute"
            class="attribute-line"
          >
            <span><strong>{{ label(attribute) }}</strong></span>
            <div
              class="rank-stepper"
              role="group"
              :aria-label="`${label(attribute)} rank`"
              @keydown="onRankKeydown(attribute, $event)"
            >
              <button
                class="ui-button"
                data-icon
                :disabled="rank(attribute) === 0"
                :aria-label="`Decrease ${label(attribute)}`"
                @click="change(attribute, -1)"
              >−</button>
              <output :aria-label="`${label(attribute)} rank ${rank(attribute)}`">
                {{ rank(attribute) }}
              </output>
              <button
                class="ui-button"
                data-icon
                :disabled="unaffordable(attribute)"
                :aria-label="`Increase ${label(attribute)}`"
                @click="change(attribute, 1)"
              >+</button>
            </div>
            <small class="rank-cost">
              {{ ATTRIBUTE_POINT_COST[rank(attribute)] }} pt
              <template v-if="nextCost(attribute) !== null">
                · next +{{ nextCost(attribute) }}
              </template>
            </small>
          </div>
        </div>
      </section>
    </div>

    <p class="workspace-note">
      Runes, equipment, and other bonuses are not included in the saved rank.
    </p>
  </section>
</template>
