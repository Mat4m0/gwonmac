<script setup lang="ts">
import { EXTERNAL_URLS } from "../../../../src/shared/contracts";

const BUG_REPORT_URL =
  `${EXTERNAL_URLS.github}/issues/new?template=bug-report.yml`;

const STEPS = [
  {
    title: "Download",
    detail:
      "Download the latest notarized .dmg release and open the disk image.",
  },
  {
    title: "Move to Applications",
    detail:
      "Drag Guild Wars Reforged into the Applications folder shown in the disk image.",
  },
  {
    title: "Open and play",
    detail:
      "Open Guild Wars Reforged from Applications. It checks the official client and downloads the files needed to begin.",
  },
] as const;

useSeoMeta({
  title: "Install Guide — Guild Wars Reforged",
  description: `Install the signed and notarized Guild Wars Reforged app on your Mac in ${STEPS.length} short steps.`,
});
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-16 sm:px-6">
    <h1 class="text-center text-4xl text-parchment-100">
      Install Guild Wars Reforged on your Mac
    </h1>
    <p class="mx-auto mt-4 max-w-xl text-center text-parchment-300/80">
      Releases are signed with Developer ID and notarized by Apple.
    </p>
    <div class="mt-6 flex justify-center">
      <DownloadCta size="large" source="install-guide" />
    </div>

    <ol class="mt-12 space-y-4">
      <li v-for="(step, index) in STEPS" :key="step.title" class="panel flex gap-5 px-6 py-5">
        <span class="text-4xl text-gold-400" aria-hidden="true">{{ index + 1 }}</span>
        <div>
          <h2 class="text-xl text-parchment-100">{{ step.title }}</h2>
          <p class="mt-1 text-parchment-300/85">{{ step.detail }}</p>
        </div>
      </li>
    </ol>

    <div class="panel mt-10 px-6 py-5">
      <h2 class="text-sm tracking-[0.12em] text-gold-400 uppercase">Security note</h2>
      <p class="mt-2 text-parchment-300/85">
        macOS verifies the Developer ID signature and stapled notarization ticket. Do not disable
        Gatekeeper or change global macOS security settings.
      </p>
    </div>

    <div class="mt-10 flex flex-wrap justify-center gap-6 text-sm">
      <NuxtLink to="/#faq" class="text-parchment-300/80 underline hover:text-gold-200">Read the FAQ</NuxtLink>
      <a
        :href="EXTERNAL_URLS.github"
        class="text-parchment-300/80 underline hover:text-gold-200"
      >Source on GitHub</a>
      <a
        :href="BUG_REPORT_URL"
        class="text-parchment-300/80 underline hover:text-gold-200"
      >Report a problem</a>
    </div>
  </div>
</template>
