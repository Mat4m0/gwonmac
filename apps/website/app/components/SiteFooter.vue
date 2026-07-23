<script setup lang="ts">
import { EXTERNAL_URLS } from "../../../../src/shared/contracts";

const LINKS = {
  github: EXTERNAL_URLS.github,
  discord: EXTERNAL_URLS.discord,
  kofi: EXTERNAL_URLS.donate,
  store: EXTERNAL_URLS.store,
} as const;
</script>

<template>
  <footer class="border-t border-bordergold-dim/50 bg-ink-900">
    <div class="mx-auto max-w-6xl space-y-6 px-4 py-10 text-sm sm:px-6">
      <div class="flex flex-wrap gap-6">
        <a :href="LINKS.github" class="text-parchment-300/80 hover:text-gold-200">GitHub</a>
        <a :href="LINKS.discord" class="text-parchment-300/80 hover:text-gold-200">Discord</a>
        <a :href="LINKS.store" class="text-parchment-300/80 hover:text-gold-200">Buy Guild Wars</a>
        <a :href="LINKS.kofi" class="text-parchment-300/80 hover:text-gold-200">Support us on Ko-fi</a>
        <NuxtLink to="/install" class="text-parchment-300/80 hover:text-gold-200">Install guide</NuxtLink>
      </div>
      <div class="space-y-2 text-parchment-300/60">
        <p class="text-parchment-300/80">
          An independent fan project, in no way affiliated with or endorsed by ArenaNet or NCSoft.
        </p>
        <p>
          Guild Wars and all associated game content are © 2005–2026 ArenaNet, Inc. All rights
          reserved. NCsoft, the interlocking NC logo, ArenaNet, Arena.net, Guild Wars and all
          associated logos and designs are trademarks or registered trademarks of NCsoft
          Corporation. All other trademarks are the property of their respective owners.
          Fan-project imagery is not included in the GPL source-code license.
        </p>
        <p>
          Application source is licensed under GPL-3.0 and published as
          <a :href="LINKS.github" class="underline hover:text-gold-200">Mat4m0/gwonmac</a>.
          Originally created by
          <a href="https://github.com/3vcloud" class="underline hover:text-gold-200">3vcloud</a>.
          Screenshots by <a href="https://bloogum.net/guildwars/" class="underline hover:text-gold-200">Snapshot Henchman</a>.
          QT Friz Quad font © QualiType, used under the
          <a href="/fonts/COPYING-QUALITYPE" class="underline hover:text-gold-200">SIL Open Font License 1.1</a>.
        </p>
        <p>
          This website uses cookie-free
          <a href="https://plausible.io" class="underline hover:text-gold-200">Plausible Analytics</a>
          for aggregate page views, download clicks, and FAQ opens. The Guild Wars application
          itself uploads no telemetry.
        </p>
      </div>
    </div>
  </footer>
</template>
