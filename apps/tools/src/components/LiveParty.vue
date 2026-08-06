<script setup lang="ts">
import { computed } from "vue";
import type { LiveParty } from "../../../../src/shared/builds/live-party";
import { heroLabel } from "../model";

const props = defineProps<{ party: LiveParty }>();

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
</script>

<template>
  <section class="live-party" aria-label="Current party in game">
    <header class="live-party-head">
      <h2>In game now</h2>
      <span
        v-if="party.status === 'ready'"
        class="ui-chip"
        :data-level="party.partial ? 'warn' : 'good'"
      >{{ party.heroCount }} {{ party.heroCount === 1 ? "hero" : "heroes" }}</span>
    </header>

    <p v-if="party.status === 'unavailable'" class="live-party-note">
      No party observed. Guild Wars may still be loading.
    </p>

    <template v-else>
      <ul v-if="party.heroes.length" class="live-party-list">
        <li v-for="hero in party.heroes" :key="hero.hero" class="live-party-row">
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
      <p v-if="unnamed" class="live-party-note">
        {{ unnamed }} more {{ unnamed === 1 ? "hero is" : "heroes are" }} in your
        party. Naming them needs the party observer.
      </p>
      <p v-else-if="!party.heroes.length" class="live-party-note">
        No heroes in your party.
      </p>
    </template>
  </section>
</template>

<style scoped>
.live-party {
  display: grid;
  padding: var(--ui-space-2) var(--ui-space-3);
  gap: var(--ui-space-2);
  border-top: 1px solid var(--ui-line-soft);
}

.live-party-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-2);
}

.live-party-head h2 {
  margin: 0;
  color: var(--ui-text-faint);
  font-size: var(--ui-font-size-sm);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
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

.live-party-note {
  margin: 0;
  color: var(--ui-text-faint);
  font-size: var(--ui-font-size-sm);
}
</style>
