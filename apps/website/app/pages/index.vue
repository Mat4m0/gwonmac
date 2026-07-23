<script setup lang="ts">
import { EXTERNAL_URLS } from "../../../../src/shared/contracts";

const BUG_REPORT_URL =
  `${EXTERNAL_URLS.github}/issues/new?template=bug-report.yml`;

const FACTS = [
  { title: "Up to 4K", detail: "Sharp native resolution on Retina and external displays." },
  { title: "Up to 60 FPS", detail: "Smooth frame rates tuned for Apple Silicon." },
  { title: "Full graphics settings", detail: "Every in-game quality option, fully available." },
  // { title: "Quick Start downloads", detail: "Start playing while areas download on demand." },
] as const;

const SCREENSHOTS = [
  { src: "/images/bg1.webp", caption: "Gameplay at high resolution" },
  { src: "/images/bg2.webp", caption: "Explorable areas, rendered natively" },
  { src: "/images/bg3.webp", caption: "The original client on macOS" },
] as const;
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="relative overflow-hidden">
      <img
        src="/images/bg0.webp"
        alt=""
        class="hero-drift absolute inset-0 h-full w-full object-cover"
      />
      <div class="scrim absolute inset-0" />
      <div class="relative mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-24 text-center sm:px-6 sm:py-32">
        <img src="/images/logo.webp" alt="Guild Wars" class="w-64 drop-shadow-[0_3px_14px_rgba(0,0,0,0.65)] sm:w-80" />
        <h1 class="text-4xl text-parchment-100 sm:text-5xl">Guild Wars on Apple Silicon</h1>
        <p class="max-w-xl text-lg text-parchment-300/90">
          Run the official Guild Wars client in a performant macOS app.
        </p>
        <div class="gold-rule h-px w-40" aria-hidden="true" />
        <DownloadCta size="large" />
        <NuxtLink to="/install" class="text-sm text-parchment-300/70 underline hover:text-gold-200">
          How to install
        </NuxtLink>
      </div>
    </section>

    <!-- Capability facts -->
    <section class="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div class="grid gap-4 sm:grid-cols-1 lg:grid-cols-3">
        <div v-for="fact in FACTS" :key="fact.title" class="panel px-5 py-6 text-center">
          <p class="text-xl text-gold-200">{{ fact.title }}</p>
          <p class="mt-2 text-sm text-parchment-300/80">{{ fact.detail }}</p>
        </div>
      </div>
    </section>

    <!-- Screenshots -->
    <section id="screenshots" class="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
      <SectionTitle>Screenshots</SectionTitle>
      <h2 class="mt-6 text-center text-3xl text-parchment-100">
        The original game, built for your Mac.
      </h2>
      <p class="mx-auto mt-3 max-w-2xl text-center text-parchment-300/80">
        Guild Wars for macOS runs ArenaNet's official client inside a native application. No
        Windows installation or compatibility-layer setup is required.
      </p>
      <div class="mt-8 grid gap-4 sm:grid-cols-3">
        <figure v-for="shot in SCREENSHOTS" :key="shot.src" class="panel overflow-hidden">
          <img :src="shot.src" :alt="shot.caption" class="aspect-video w-full object-cover" loading="lazy" />
          <!-- <figcaption class="px-4 py-3 text-sm text-parchment-300/70">{{ shot.caption }}</figcaption> -->
        </figure>
      </div>
      <p class="mt-3 text-center text-xs text-parchment-300/50">
        Photography by
        <a href="https://bloogum.net/guildwars/" class="underline hover:text-gold-200">Snapshot Henchman</a>
      </p>
    </section>

    <!-- Native section -->
    <section class="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <SectionTitle>Native on macOS</SectionTitle>
      <div class="mt-8 grid items-center gap-10 lg:grid-cols-2">
        <div>
          <h2 class="text-3xl text-parchment-100">Less setup. More Guild Wars.</h2>
          <p class="mt-4 text-parchment-300/90">
            Open the app, sign in, and play. Quick Start fetches areas when needed, while an
            optional full download can continue in the background.
          </p>
        </div>
        <ul class="space-y-3 text-parchment-300/90">
          <li v-for="item in [
            'Purpose-built macOS application',
            'Fullscreen, audio, keyboard, mouse, and native window behavior',
            'Official game files downloaded directly from ArenaNet',
            'Local diagnostics with no telemetry uploads',
          ]" :key="item" class="flex gap-3">
            <span class="text-gold-400" aria-hidden="true">✦</span>{{ item }}
          </li>
        </ul>
      </div>
    </section>

    <!-- Final CTA -->
    <section class="relative overflow-hidden border-y border-bordergold-dim/50">
      <img src="/images/bg2.webp" alt="" class="absolute inset-0 h-full w-full object-cover" />
      <div class="scrim absolute inset-0" />
      <div class="relative mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6">
        <h2 class="text-3xl text-parchment-100 sm:text-4xl">Return to Tyria.</h2>
        <p class="text-parchment-300/90">
          Download Guild Wars for macOS and follow the short first-open guide.
        </p>
        <div class="flex flex-wrap items-center justify-center gap-4">
          <DownloadCta size="large" />
          <NuxtLink to="/install" class="btn-secondary">Installation guide</NuxtLink>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section id="faq" class="mx-auto max-w-3xl scroll-mt-20 px-4 py-16 sm:px-6">
      <SectionTitle>FAQ</SectionTitle>
      <div class="mt-8 space-y-3">
        <FaqItem question="Is Guild Wars for macOS safe?">
          <p>
            The app is open source and runs ArenaNet's official Guild Wars client. Game files are
            downloaded directly from ArenaNet and verified before use. The application does not
            upload telemetry, credentials, account identifiers, or game traffic.
          </p>
        </FaqItem>
        <FaqItem question="Why does macOS show a security warning?">
          <p>
            Current releases are ad-hoc signed, but they are not yet signed with an Apple Developer
            ID or notarized by Apple. macOS therefore asks you to confirm the first launch
            manually. You should never disable Gatekeeper globally.
          </p>
        </FaqItem>
        <FaqItem question="How do I open the app?">
          <p>
            Move Guild Wars to Applications and open it once — macOS will block it. Then go to
            System Settings → Privacy &amp; Security, click Open Anyway, and confirm. This is only
            needed for the first launch. The
            <NuxtLink to="/install" class="underline hover:text-gold-200">install guide</NuxtLink>
            walks through each step.
          </p>
        </FaqItem>
        <FaqItem question="Will this get me banned?">
          <p>
            Probably not, but we cannot make promises on ArenaNet's behalf. The app runs the
            official, unmodified Guild Wars client and downloads it directly from ArenaNet. It does
            not alter gameplay, automate play, inject code into the game, or give any in-game
            advantage, it is an interoperability layer that lets the client run on macOS.
          </p>
          <p>
            Still, use it at your own discretion:
            only ArenaNet decides what its terms of service allow.
          </p>
        </FaqItem>
        <FaqItem question="How do I report bugs or performance problems?">
          <p>
            Inside the app, choose Help → Report a Problem…. For crashes, download, graphics,
            input, audio, or login issues, pick Export Recent Diagnostics. For stutter, pick
            Record Performance Problem, reproduce the issue, and press Cmd+Shift+M when it happens.
          </p>
          <p>
            The app creates a single <code>.gwdiag</code> file and can open the
            <a
              :href="BUG_REPORT_URL"
              class="underline hover:text-gold-200"
            >GitHub bug form</a> for you. The export is redacted: credentials, account
            identifiers, packet contents, and crash dumps are never included.
          </p>
        </FaqItem>
        <FaqItem question="Why is the app not notarized?">
          <p>
            Apple requires a paid Developer Program membership for Developer ID signing and
            notarization. It costs about €100 each year. We are collecting donations to cover this
            recurring cost.
          </p>
          <p>
            <a :href="EXTERNAL_URLS.donate" class="btn-primary mt-2 px-4 py-2 text-sm">
              Support us on Ko-fi
            </a>
          </p>
        </FaqItem>
        <FaqItem question="Does it include Guild Wars?">
          <p>
            No. The application does not bundle proprietary game binaries. It downloads the
            official client and required game data directly from ArenaNet.
          </p>
        </FaqItem>
        <FaqItem question="Do I need a Guild Wars account?">
          <p>
            Yes. You sign in with your existing Guild Wars account — the app does not create
            accounts or bypass the login. If you don't own the game yet, you can buy it from the
            official store.
          </p>
          <p>
            <a :href="EXTERNAL_URLS.store" class="btn-primary mt-2 px-4 py-2 text-sm">
              Buy Guild Wars
            </a>
          </p>
        </FaqItem>
        <FaqItem question="Is this affiliated with ArenaNet?">
          <p>
            No. This is an independent interoperability project and is not affiliated with or
            endorsed by ArenaNet or NCSoft.
          </p>
        </FaqItem>
      </div>
    </section>
  </div>
</template>
