<script setup lang="ts">
import { EXTERNAL_URLS } from "../../../../src/shared/contracts";

const BUG_REPORT_URL =
  `${EXTERNAL_URLS.github}/issues/new?template=bug-report.yml`;

useSeoMeta({
  title: "Install Guide — Guild Wars for macOS",
  description:
    "Install Guild Wars on your Mac in four short steps, including the one-time first-launch confirmation.",
});

const STEPS = [
  {
    title: "Download",
    detail:
      "Download the latest release — a .zip containing the app. Safari unzips it automatically; otherwise double-click the file.",
  },
  {
    title: "Move to Applications",
    detail: "Drag Guild Wars from Downloads into the Applications folder.",
  },
  {
    title: "Open it once — macOS blocks it",
    detail:
      "Open the app from Applications. macOS shows “Apple is not able to verify that it is free from malware” with only Move to Bin and Done. Click Done — do not click Move to Bin.",
  },
  {
    title: "Allow it in System Settings",
    detail:
      "Open System Settings → Privacy & Security and scroll down. Next to “‘Guild Wars’ was blocked to protect your Mac”, click Open Anyway.",
  },
  {
    title: "Confirm and play",
    detail:
      "The warning appears one more time, now with an Open Anyway button — click it. The app opens, checks the official client, and downloads the files needed to begin. This is only required for the first launch.",
  },
] as const;
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-16 sm:px-6">
    <h1 class="text-center text-4xl text-parchment-100">Install Guild Wars on your Mac</h1>
    <p class="mx-auto mt-4 max-w-xl text-center text-parchment-300/80">
      Current releases require a one-time approval in System Settings on first launch because they
      are not yet notarized by Apple.
    </p>
    <div class="mt-6 flex justify-center">
      <DownloadCta size="large" />
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
        Do not disable Gatekeeper or change global macOS security settings. Use the per-app Open
        Anyway confirmation described above.
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
