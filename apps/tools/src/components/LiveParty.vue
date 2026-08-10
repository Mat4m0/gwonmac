<script setup lang="ts">
import { computed } from "vue";
import type { LiveParty } from "../../../../src/shared/builds/live-party";
import { heroLabel } from "../../../../src/shared/builds/heroes";

const props = defineProps<{ party: LiveParty; saving: boolean }>();
defineEmits<{ capture: [] }>();

const BEHAVIOUR_LABELS = {
  fight: "Fight",
  guard: "Guard",
  avoid: "Avoid",
} as const;

/**
 * How many heroes are counted but not named.
 *
 * The companion counts every hero the player owns and can currently identify
 * only some of them, so this is the honest size of the gap rather than a
 * loading state — nothing further is on its way until the party region lands.
 */
const unnamed = computed(() =>
  Math.max(0, props.party.heroCount - props.party.heroes.length),
);
const shownHeroes = computed(() => props.party.heroes.slice(0, 3));
const remaining = computed(() =>
  Math.max(0, props.party.heroCount - shownHeroes.value.length),
);
const canCapture = computed(() =>
  props.party.status === "ready"
  && (props.party.player !== null || props.party.heroes.length > 0)
);
</script>

<template>
  <details class="live-party" open>
    <summary class="live-party-head">
      <span class="live-party-title">Party in Guild Wars</span>
      <span
        v-if="party.status === 'ready'"
        class="ui-chip"
        :data-level="party.partial ? 'warn' : 'good'"
      >{{ party.heroCount }} {{ party.heroCount === 1 ? "hero" : "heroes" }}</span>
    </summary>

    <div class="live-party-body">
      <p v-if="party.status === 'unavailable'" class="live-party-note">
        No party observed. Guild Wars may still be loading.
      </p>

      <template v-else>
        <ul v-if="party.heroes.length" class="live-party-list">
          <li v-for="hero in shownHeroes" :key="hero.hero" class="live-party-row">
            <span class="ui-mark" aria-hidden="true">{{ heroLabel(hero.hero)[0] }}</span>
            <span class="live-party-name">{{ heroLabel(hero.hero) }}</span>
          <!--
            Only what was read. A hero whose professions the kernel could not
            reach shows no professions rather than a dash that reads like a
            monoclass character, and behaviour is absent rather than defaulted
            to Guard, which is a real setting somebody might act on.
          -->
            <span v-if="hero.professions" class="live-party-meta">
              {{ hero.professions[1] ? `${hero.professions[0]}/${hero.professions[1]}` : hero.professions[0] }}
            </span>
            <span v-if="hero.behaviour" class="ui-chip live-party-behaviour">
              {{ BEHAVIOUR_LABELS[hero.behaviour] }}
            </span>
          </li>
        </ul>

      <!--
        Said plainly rather than shown as an empty row per missing hero. A
        placeholder row is a promise that something is loading; this is a limit
        of what the companion currently publishes, and the difference matters to
        anyone deciding whether to trust the list.
      -->
        <p v-if="remaining" class="live-party-note">
          {{ remaining }} more {{ remaining === 1 ? "hero is" : "heroes are" }} in your party.
          <template v-if="unnamed">
            GWonMac cannot identify {{ unnamed === 1 ? "one" : unnamed }} yet.
          </template>
        </p>
        <p v-else-if="!party.heroes.length" class="live-party-note">
          No heroes in your party.
        </p>

      <!--
        Absent rather than disabled when there is nothing to save. A greyed-out
        button is a promise that some state makes it work, and the state that
        makes this work is "you have heroes" — which the list above already says
        plainly.
      -->
        <button
          v-if="canCapture"
          class="ui-button"
          data-variant="primary"
          :disabled="saving"
          @click="$emit('capture')"
        >
          Save as new team
        </button>
      </template>
    </div>
  </details>
</template>

<style scoped>
.live-party {
  padding: var(--ui-space-2) 0;
}

.live-party-head {
  display: flex;
  min-height: var(--ui-control-height);
  padding: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-2);
  color: var(--ui-text-bright);
  cursor: pointer;
  list-style: none;
}

.live-party-head::-webkit-details-marker { display: none; }
.live-party-head::before {
  content: "▸";
  flex: 0 0 auto;
  color: var(--ui-text-faint);
  font-size: var(--ui-font-size-sm);
  transition: transform var(--ui-duration) var(--ui-ease-out);
}
.live-party[open] > .live-party-head::before { transform: rotate(90deg); }

.live-party-title {
  min-width: 0;
  flex: 1;
  font-size: var(--ui-font-size);
  font-weight: 600;
}

.live-party-body {
  display: grid;
  padding-top: var(--ui-space-2);
  gap: var(--ui-space-2);
}

.live-party-list {
  display: grid;
  margin: 0;
  padding: 0;
  gap: var(--ui-space-1);
  list-style: none;
}

.live-party-row {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
  min-width: 0;
}

.live-party-meta {
  color: var(--ui-text-faint);
  font-size: var(--ui-font-size-sm);
  white-space: nowrap;
}

.live-party-behaviour { margin-left: auto; }

.live-party-name {
  overflow: hidden;
  font-size: var(--ui-font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-party-row .ui-chip { padding: 0 var(--ui-space-1); }

.live-party-body > .ui-button { justify-self: start; }

.live-party-note {
  margin: 0;
  color: var(--ui-text-faint);
  font-size: var(--ui-font-size-sm);
}
</style>
