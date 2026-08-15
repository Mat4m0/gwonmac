<script setup lang="ts">
// Fully custom marketing landing in the Reforged launcher chrome (the layer's
// config-driven landing page is not used). Sections, per design exploration:
// Shrine hero with fused stat band, panel-grid features, marching testimonial
// strip, hairline FAQ, and the "Return to Tyria" closing call. (A screenshot
// gallery and roadmap existed as parked sections; recover them from git
// history if they return.) Copy is localized inline; testimonial quotes stay
// in their original English. The global unofficial banner and header render
// above this page as on every other page.
import { computed } from "vue";
import { useFetch, useI18n, useSeoMeta } from "#imports";
import { useTracking, type DownloadSource } from "../composables/useTracking";
import type { LatestRelease } from "../../server/utils/release-select";
import { getLocalizedSiteText } from "#ginko-docs/config/site.utils";
import { useGinkoDocsConfig } from "#ginko-docs/composables/useGinkoDocsConfig";
import { useSchemaJsonLd } from "#ginko-docs/composables/useSchemaJsonLd";

const config = useGinkoDocsConfig();
const { locale } = useI18n();

type Localized = string | { en: string; de?: string };
const localize = (value: Localized) => getLocalizedSiteText(value, locale.value);

// The buttons link to /download, the site's live redirect to the newest DMG, so
// the prerendered HTML carries the right target from the first paint. Resolving
// the DMG in the browser instead raced hydration: a third of clicks landed on
// the releases page because the fetch had not answered yet.
const DOWNLOAD_PATH = "/download";
// /api/latest resolves the newest downloadable release from GitHub (cached
// server-side, Stable by default). Fetched in the browser so
// the prerendered page never bakes in a stale version; it only names the
// version in the fine print and the click event, so a late answer costs nothing.
const { data: latestRelease } = useFetch<LatestRelease>("/api/latest", { server: false });

const { trackDownload, trackFaqOpen } = useTracking();

function handleDownload(source: DownloadSource): void {
  trackDownload(source, latestRelease.value?.version ?? null);
}

const DOCS_PATH = { en: "/docs/guides/install", de: "/de/dokumentation/anleitungen/installation" };
const COMPARE_PATH = {
  en: "/docs/guides/play-guild-wars-on-mac",
  de: "/de/dokumentation/anleitungen/guild-wars-auf-dem-mac-spielen",
};
const ACCOUNTS_PATH = {
  en: "/docs/guides/accounts",
  de: "/de/dokumentation/anleitungen/konten",
};
const SAFETY_PATH = { en: "/docs/project/safety", de: "/de/dokumentation/projekt/sicherheit" };
const TROUBLE_PATH = {
  en: "/docs/guides/troubleshooting",
  de: "/de/dokumentation/anleitungen/fehlerbehebung",
};

// The head query this page exists to win: "play guild wars on mac".
const SEO = {
  title: {
    en: "Play Guild Wars on Mac | GWonMac",
    de: "Guild Wars auf dem Mac spielen | GWonMac",
  },
  description: {
    en: "Play ArenaNet’s official Guild Wars client on an Apple Silicon Mac without Windows, Wine, CrossOver, or Parallels. Free, signed, and notarized.",
    de: "Spiele ArenaNets offiziellen Guild-Wars-Client auf einem Apple-Silicon-Mac – ohne Windows, Wine, CrossOver oder Parallels. Kostenlos, signiert und notarisiert.",
  },
};

const HERO = {
  title: {
    en: "Play Guild Wars on your Mac",
    de: "Spiele Guild Wars auf deinem Mac",
  },
  sub: {
    en: "Download GWonMac, sign in with your Guild Wars account, and play. You don’t need Windows, Wine, or a virtual machine.",
    de: "Lade GWonMac herunter, melde dich mit deinem Guild-Wars-Konto an und spiele. Du brauchst weder Windows noch Wine oder eine virtuelle Maschine.",
  },
  download: { en: "Download for Mac", de: "Für Mac herunterladen" },
  docs: { en: "Installation guide", de: "Installationsanleitung" },
  finePrint: {
    en: "Free · For Apple Silicon · Signed & notarized",
    de: "Kostenlos · Für Apple Silicon · Signiert & notarisiert",
  },
};

const STATS = [
  { value: "3 steps", label: { en: "download, move, open", de: "laden, verschieben, öffnen" } },
  { value: "M1+", label: { en: "Apple Silicon Macs", de: "Apple-Silicon-Macs" } },
  { value: "macOS 12+", label: { en: "Monterey or later", de: "Monterey oder neuer" } },
  { value: "Free", label: { en: "to download and use", de: "herunterladen und nutzen" } },
];

const FEATURES_HEADING = {
  title: { en: "Everything you need to start playing", de: "Alles, was du zum Spielen brauchst" },
  sub: {
    en: "Install the app, sign in with your existing account, and let GWonMac take care of the game files and updates.",
    de: "Installiere die App und melde dich mit deinem bestehenden Konto an. GWonMac kümmert sich um die Spieldaten und Updates.",
  },
};

const FEATURES = [
  {
    title: { en: "Download, move, open", de: "Laden, verschieben, öffnen" },
    description: {
      en: "Download the DMG, move Guild Wars to Applications, and open it. That’s all you need to install GWonMac.",
      de: "Lade die DMG-Datei herunter, verschiebe Guild Wars in „Programme“ und öffne die App. Mehr ist für die Installation nicht nötig.",
    },
  },
  {
    title: { en: "Use your existing account", de: "Nutze dein bestehendes Konto" },
    description: {
      en: "Sign in with your Guild Wars account or Steam. You don’t need to create a separate GWonMac account.",
      de: "Melde dich mit deinem Guild-Wars-Konto oder über Steam an. Du brauchst kein eigenes GWonMac-Konto.",
    },
  },
  {
    title: { en: "A normal Mac installation", de: "Eine normale Mac-Installation" },
    description: {
      en: "Every release is signed and notarized by Apple. You don’t need to turn off any Mac security settings.",
      de: "Jede Version ist signiert und von Apple notarisiert. Du musst keine Sicherheitseinstellungen auf deinem Mac ausschalten.",
    },
  },
  {
    title: { en: "Made for M-series Macs", de: "Für Macs mit M-Chip" },
    description: {
      en: "GWonMac works on Apple Silicon Macs running macOS 12 Monterey or later. Intel Macs are not supported.",
      de: "GWonMac läuft auf Apple-Silicon-Macs mit macOS 12 Monterey oder neuer. Intel-Macs werden nicht unterstützt.",
    },
  },
  {
    title: { en: "Game files come from ArenaNet", de: "Spieldaten direkt von ArenaNet" },
    description: {
      en: "GWonMac uses ArenaNet’s official client and downloads the game files directly from ArenaNet. The files are not bundled with the app.",
      de: "GWonMac nutzt ArenaNets offiziellen Client und lädt die Spieldaten direkt von ArenaNet. Die App enthält keine Spieldaten.",
    },
  },
  {
    title: { en: "Updates are handled for you", de: "Updates ohne Handarbeit" },
    description: {
      en: "Game data stays up to date automatically. When a new GWonMac version is ready, the app lets you know before it installs.",
      de: "Die Spieldaten bleiben automatisch aktuell. Wenn eine neue GWonMac-Version bereitsteht, informiert dich die App vor der Installation.",
    },
  },
];

const VOICES_HEADING = {
  title: { en: "What Mac players say", de: "Das sagen Spieler auf dem Mac" },
  sub: {
    en: "Reports from people playing on M1, M2, M4, and M5 Macs in the Guild Wars subreddit.",
    de: "Erfahrungen von Spielern mit M1-, M2-, M4- und M5-Macs aus dem Guild-Wars-Subreddit.",
  },
};

// Avatar plate hues cycle per card: ember, gold, rust. The plates stay dark in
// both color modes, so the initial on top keeps the fixed --gw-gold.
const AVATAR_HUES = ["#8a2508", "#6d5222", "#45280f"];

const TESTIMONIALS = [
  {
    quote:
      "Made a reddit account to say thank you so much for sharing this! Wow, I can’t even believe I’m able to play gw1 again.",
    user: "aer0_dynamic",
    device: "MacBook Pro M1",
    href: "https://reddit.com/r/GuildWars/comments/1v4sehu/guild_wars_native_experience_achieved_on_apple/ozrm8xi/",
  },
  {
    quote:
      "Runs very very well on a MacBook Air M2. Way better than parallels version, which fps would drop and had some lag.",
    user: "Embr822",
    device: "MacBook Air M2",
    href: "https://reddit.com/r/GuildWars/comments/1v4sehu/guild_wars_native_experience_achieved_on_apple/ozece76/",
  },
  {
    quote: "Well done sir! Working great — buttery smooth and native-feeling! Impressive work!",
    user: "6davids",
    device: "r/GuildWars",
    href: "https://reddit.com/r/GuildWars/comments/1v4sehu/guild_wars_native_experience_achieved_on_apple/ozg7o11/",
  },
  {
    quote:
      "It’s so awesome to finally be able to play GW in full glory and without performance issues on my MacBook.",
    user: "Okay_sure_lets_post",
    device: "MacBook Air M4",
    href: "https://reddit.com/r/GuildWars/comments/1v7fb8k/guild_wars_on_macos_the_gwonmac_beta_is_here/p0di9x1/",
  },
  {
    quote: "It runs without any issue on my M2 Mac Mini as well. Guild Wars itself runs nicely.",
    user: "Kevjoe",
    device: "Mac Mini M2",
    href: "https://reddit.com/r/GuildWars/comments/1v4sehu/guild_wars_native_experience_achieved_on_apple/ozdq9y7/",
  },
  {
    quote: "This is working great on m1pro Mac with 16gb.",
    user: "Thrasher_Josh",
    device: "MacBook Pro M1",
    href: "https://reddit.com/r/GuildWars/comments/1v7fb8k/guild_wars_on_macos_the_gwonmac_beta_is_here/p058kvy/",
  },
];


const FAQ_HEADING = {
  title: { en: "Questions before you install", de: "Fragen vor der Installation" },
};

type FaqItem = {
  q: Localized;
  a: Localized;
  link?: { label: Localized; href: Localized };
};

const FAQ: FaqItem[] = [
  {
    q: { en: "Will this get me banned?", de: "Kann ich dafür gebannt werden?" },
    a: {
      en: "Nobody outside ArenaNet can promise that. Before launch, an ArenaNet staff member tested GWonMac and said they were fine with the project as it stood in July 2026. This was not an endorsement or a policy. GWonMac uses ArenaNet’s official client, does not automate gameplay, and will stop if ArenaNet asks.",
      de: "Niemand außerhalb von ArenaNet kann das versprechen. Vor dem Start hat ein ArenaNet-Mitarbeiter GWonMac getestet und im Juli 2026 gesagt, dass das Projekt für ihn in seiner damaligen Form in Ordnung war. Das war weder eine offizielle Freigabe noch eine Richtlinie. GWonMac nutzt ArenaNets offiziellen Client, automatisiert das Spiel nicht und wird eingestellt, wenn ArenaNet darum bittet.",
    },
    link: {
      label: { en: "Read the full safety page", de: "Zur ausführlichen Sicherheitsseite" },
      href: SAFETY_PATH,
    },
  },
  {
    q: { en: "Which Macs are supported?", de: "Welche Macs werden unterstützt?" },
    a: {
      en: "GWonMac supports Apple Silicon Macs running macOS 12 Monterey or later. Intel Macs are not supported. Performance depends on your Mac and the graphics settings you choose.",
      de: "GWonMac unterstützt Apple-Silicon-Macs mit macOS 12 Monterey oder neuer. Intel-Macs werden nicht unterstützt. Die Leistung hängt von deinem Mac und den gewählten Grafikeinstellungen ab.",
    },
  },
  {
    q: { en: "How do I install it?", de: "Wie installiere ich es?" },
    a: {
      en: "Download the DMG, move Guild Wars to Applications, and open it. Every release is signed and notarized, so you don’t need to turn off any Mac security settings.",
      de: "Lade die DMG-Datei herunter, verschiebe Guild Wars in „Programme“ und öffne die App. Jede Version ist signiert und notarisiert. Du musst keine Sicherheitseinstellungen auf deinem Mac ausschalten.",
    },
    link: {
      label: { en: "Step-by-step install guide", de: "Schritt-für-Schritt-Anleitung" },
      href: DOCS_PATH,
    },
  },
  {
    q: { en: "Do I need a Guild Wars account?", de: "Brauche ich ein Guild-Wars-Konto?" },
    a: {
      en: "Yes. Sign in with your existing Guild Wars account or Steam account. GWonMac does not include the game or create a separate account for you.",
      de: "Ja. Melde dich mit deinem bestehenden Guild-Wars-Konto oder Steam-Konto an. GWonMac enthält das Spiel nicht und erstellt kein eigenes Konto für dich.",
    },
  },
  {
    q: { en: "Is GWonMac free?", de: "Ist GWonMac kostenlos?" },
    a: {
      en: "Yes. GWonMac is free to download and use.",
      de: "Ja. Du kannst GWonMac kostenlos herunterladen und nutzen.",
    },
  },
  {
    q: {
      en: "What about CrossOver, Parallels, or Whisky?",
      de: "Was ist mit CrossOver, Parallels oder Whisky?",
    },
    a: {
      en: "They can work, but they run the Windows client through extra software or a virtual machine. GWonMac runs ArenaNet’s official client directly as a Mac app.",
      de: "Diese Programme können funktionieren, benötigen dafür aber zusätzliche Software oder eine virtuelle Maschine. GWonMac startet ArenaNets offiziellen Client direkt als Mac-App.",
    },
    link: {
      label: { en: "Every option compared", de: "Alle Optionen im Vergleich" },
      href: COMPARE_PATH,
    },
  },
  {
    q: { en: "Does it update automatically?", de: "Aktualisiert es sich automatisch?" },
    a: {
      en: "Yes. Game data updates automatically. When a new GWonMac version is available, the app tells you before it installs.",
      de: "Ja. Die Spieldaten werden automatisch aktualisiert. Wenn eine neue GWonMac-Version verfügbar ist, informiert dich die App vor der Installation.",
    },
  },
  {
    q: { en: "Does Steam login work?", de: "Funktioniert die Steam-Anmeldung?" },
    a: {
      en: "Yes. You can sign in with Steam or a regular Guild Wars account. Your password goes only to your login provider and ArenaNet, never to a GWonMac service. If you save your login, it stays in the Keychain on your Mac.",
      de: "Ja. Du kannst dich über Steam oder mit einem normalen Guild-Wars-Konto anmelden. Dein Passwort geht nur an deinen Anmeldeanbieter und ArenaNet, niemals an einen GWonMac-Dienst. Wenn du deine Anmeldung speicherst, bleibt sie im Schlüsselbund auf deinem Mac.",
    },
  },
  {
    q: {
      en: "I play on mobile with Sign in with Apple. Can I play on Mac without buying again?",
      de: "Ich spiele mobil mit Apple-Login. Kann ich ohne erneuten Kauf auf dem Mac spielen?",
    },
    a: {
      en: "Yes. A mobile account uses a Mobile ID, which the desktop client doesn’t accept, so link it once to an ArenaNet account from the mobile app. After that you sign in on your Mac with the ArenaNet credentials, and your characters and the campaigns you bought on mobile come with you.",
      de: "Ja. Ein Mobilkonto nutzt eine Mobile ID, die der Desktop-Client nicht annimmt. Verknüpfe es einmal in der Mobil-App mit einem ArenaNet-Konto. Danach meldest du dich auf dem Mac mit den ArenaNet-Zugangsdaten an, und deine Charaktere und die mobil gekauften Kampagnen kommen mit.",
    },
    link: {
      label: { en: "How to link your mobile account", de: "Mobilkonto verknüpfen" },
      href: ACCOUNTS_PATH,
    },
  },
  {
    q: { en: "Can I use GWToolbox++?", de: "Kann ich GWToolbox++ nutzen?" },
    a: {
      en: "No. GWToolbox++ only works with the Windows client. GWonMac Tools Beta provides its own build and team features. It is optional and works only in supported PvE outposts.",
      de: "Nein. GWToolbox++ funktioniert nur mit dem Windows-Client. GWonMac Tools Beta bietet eigene Funktionen für Builds und Teams. Die Tools sind optional und funktionieren nur in unterstützten PvE-Außenposten.",
    },
  },
  {
    q: { en: "Does GWonMac run Guild Wars 2?", de: "Läuft Guild Wars 2 mit GWonMac?" },
    a: {
      en: "No. GWonMac runs the original Guild Wars (Reforged) only. Guild Wars 2 is a different engine, and its native Mac client was discontinued by ArenaNet in February 2021.",
      de: "Nein. GWonMac führt nur das originale Guild Wars (Reforged) aus. Guild Wars 2 nutzt eine andere Engine, und dessen nativer Mac-Client wurde von ArenaNet im Februar 2021 eingestellt.",
    },
  },
  {
    q: { en: "How do I report bugs or get help?", de: "Wie melde ich Bugs oder bekomme Hilfe?" },
    a: {
      en: "Join the Discord for quick help. In the app, Help → Report a Bug or Help → Request a Feature opens the matching GitHub issue form immediately. Diagnostics are optional and never uploaded automatically.",
      de: "Komm für schnelle Hilfe auf den Discord. In der App öffnet Hilfe → Bug melden oder Hilfe → Feature vorschlagen sofort das passende GitHub-Issue-Formular. Diagnosedaten sind optional und werden nie automatisch hochgeladen.",
    },
    link: {
      label: { en: "Troubleshooting & known issues", de: "Fehlerbehebung & bekannte Probleme" },
      href: TROUBLE_PATH,
    },
  },
];

// Each FAQ item is tracked once per visit, on first open. Questions are
// tracked by their English text so both locales group under one event value.
// The first item renders open (browsers fire toggle for it on load), so it is
// pre-seeded and never tracked.
const faqKey = (question: Localized): string =>
  typeof question === "string" ? question : question.en;
const trackedFaqs = new Set<string>(FAQ[0] ? [faqKey(FAQ[0].q)] : []);

function handleFaqToggle(event: Event, question: Localized): void {
  const details = event.currentTarget as HTMLDetailsElement;
  const key = faqKey(question);
  if (!details.open || trackedFaqs.has(key)) return;
  trackedFaqs.add(key);
  trackFaqOpen(key);
}

const DISCORD = {
  url: "https://discord.gg/Z9ft52RBD3",
  text: {
    en: "Join Discord for release notes, known issues, and help.",
    de: "Auf Discord findest du Versionshinweise, bekannte Probleme und Hilfe.",
  },
  cta: { en: "Join the Discord", de: "Discord beitreten" },
};

// Discord brand mark — the bundled icon set has none (see SiteSocialLinks.vue).
const DISCORD_PATH =
  "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z";

const CTA = {
  title: { en: "Ready to play?", de: "Bereit zum Spielen?" },
  sub: {
    en: "Download GWonMac, move it to Applications, and sign in with your Guild Wars account.",
    de: "Lade GWonMac herunter, verschiebe die App in „Programme“ und melde dich mit deinem Guild-Wars-Konto an.",
  },
  download: { en: "Download for Mac", de: "Für Mac herunterladen" },
  docs: { en: "Installation guide", de: "Installationsanleitung" },
};

const docsPath = computed(() => localize(DOCS_PATH));

const seoTitle = computed(() => localize(SEO.title));
const seoDescription = computed(() => localize(SEO.description));
useSeoMeta({
  title: seoTitle,
  description: seoDescription,
  ogTitle: seoTitle,
  ogDescription: seoDescription,
});

// The layer's app.vue emits the WebSite node; the landing adds the publisher.
useSchemaJsonLd(() => [
  {
    "@type": "Organization",
    name: "GWonMac",
    url: config.site.url,
    logo: `${config.site.url}/reforged-logo.webp`,
    sameAs: ["https://github.com/Mat4m0/gwonmac", "https://discord.gg/Z9ft52RBD3"],
  },
]);
</script>

<template>
  <div class="overflow-hidden">
    <!-- Hero — "The Shrine": centered title-screen composition over key art. -->
    <section class="relative border-b border-border bg-(--gw-art-base)">
      <div class="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div class="gw-art gw-drift absolute inset-0 size-full bg-[position:center_30%]" />
        <div class="gw-hero-scrim absolute inset-0" />
      </div>
      <div
        class="relative mx-auto flex max-w-3xl flex-col items-center px-6 pt-20 pb-16 text-center sm:pt-24 sm:pb-20"
      >
        <img
          src="/reforged-logo.webp"
          alt="Guild Wars Reforged"
          class="w-[min(430px,80vw)] drop-shadow-[0_4px_22px_var(--gw-art-halo)]"
          loading="eager"
        />
        <h1
          class="mt-8 font-(family-name:--font-display) text-4xl leading-[1.08] font-normal text-balance text-(--gw-art-ink) [text-shadow:0_2px_14px_var(--gw-art-halo)] sm:text-5xl"
        >
          {{ localize(HERO.title) }}
        </h1>
        <div class="gw-rule mt-6 w-[min(420px,80%)]">◆</div>
        <p
          class="mt-6 max-w-[56ch] text-base leading-7 text-(--gw-art-ink-dim) [text-shadow:0_1px_8px_var(--gw-art-halo)] sm:text-lg sm:leading-8"
        >
          {{ localize(HERO.sub) }}
        </p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <NuxtLink
            :to="DOWNLOAD_PATH"
            target="_blank"
            rel="noopener noreferrer"
            class="gw-btn-primary"
            @click="handleDownload('hero')"
          >
            <Icon name="lucide:download" class="size-4" aria-hidden="true" />
            {{ localize(HERO.download) }}
          </NuxtLink>
          <NuxtLink :to="docsPath" class="gw-btn-secondary">{{ localize(HERO.docs) }}</NuxtLink>
        </div>
        <p class="mt-5 text-[12.5px] tracking-[0.04em] text-(--gw-art-ink-faint)">
          <template v-if="latestRelease?.version">{{ latestRelease.version }} · </template>{{ localize(HERO.finePrint) }}
        </p>
      </div>
      <!-- Stat band, fused into the hero's bottom edge -->
      <dl class="gw-stat-band">
        <div v-for="stat in STATS" :key="stat.value" class="gw-stat">
          <dt class="sr-only">{{ localize(stat.label) }}</dt>
          <dd class="gw-v">{{ stat.value }}</dd>
          <dd class="gw-l">{{ localize(stat.label) }}</dd>
        </div>
      </dl>
    </section>

    <!-- Features — panel grid -->
    <section class="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
      <div class="max-w-2xl">
        <h2 class="font-(family-name:--font-display) text-3xl text-foreground sm:text-4xl">
          {{ localize(FEATURES_HEADING.title) }}
        </h2>
        <p class="mt-3 text-base leading-7 text-muted-foreground">
          {{ localize(FEATURES_HEADING.sub) }}
        </p>
      </div>
      <div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="feature in FEATURES"
          :key="feature.title.en"
          class="gw-panel relative min-w-0 p-6"
        >
          <h3 class="font-(family-name:--font-display) text-xl text-(--gw-text)">
            {{ localize(feature.title) }}
          </h3>
          <p class="mt-2 text-[13.5px] leading-relaxed text-(--gw-text-faint)">
            {{ localize(feature.description) }}
          </p>
        </article>
      </div>
    </section>

    <!-- Testimonials — masonry wall with bottom fade -->
    <section class="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
      <div class="mx-auto flex max-w-2xl flex-col items-center text-center">
        <h2 class="font-(family-name:--font-display) text-3xl text-foreground sm:text-4xl">
          {{ localize(VOICES_HEADING.title) }}
        </h2>
        <p class="mt-3 text-base leading-7 text-muted-foreground">
          {{ localize(VOICES_HEADING.sub) }}
        </p>
      </div>
      <div
        class="relative mt-12 w-full after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-2 after:h-56 after:bg-linear-to-t after:from-background"
      >
        <div class="columns-1 gap-4 md:columns-2 lg:columns-3">
          <figure
            v-for="(item, index) in TESTIMONIALS"
            :key="item.href"
            class="gw-panel mb-4 break-inside-avoid p-5"
          >
            <figcaption class="flex items-center gap-3.5">
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#67583e66] font-(family-name:--font-display) text-lg text-(--gw-gold)"
                :style="{ background: AVATAR_HUES[index % AVATAR_HUES.length] }"
                aria-hidden="true"
              >
                {{ item.user[0]!.toUpperCase() }}
              </span>
              <span class="min-w-0 text-sm leading-5">
                <NuxtLink
                  :to="item.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block truncate font-semibold text-(--gw-accent-strong) hover:underline"
                >
                  u/{{ item.user }}
                </NuxtLink>
                <span class="text-(--gw-text-faint)">{{ item.device }}</span>
              </span>
            </figcaption>
            <blockquote class="mt-4 text-sm leading-7 text-(--gw-text-dim)">
              <q>{{ item.quote }}</q>
            </blockquote>
          </figure>
        </div>
      </div>
    </section>


    <!-- FAQ — hairline accordion -->
    <section class="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-24">
      <h2 class="font-(family-name:--font-display) text-3xl text-foreground sm:text-4xl">
        {{ localize(FAQ_HEADING.title) }}
      </h2>
      <div class="gw-faq mt-10 border-t border-(--gw-hairline)">
        <details
          v-for="(item, index) in FAQ"
          :key="localize(item.q)"
          :open="index === 0"
          @toggle="handleFaqToggle($event, item.q)"
        >
          <summary>{{ localize(item.q) }}</summary>
          <p class="max-w-[64ch] px-1 pb-5 pl-[27px] text-sm leading-6 text-(--gw-text-faint)">
            {{ localize(item.a) }}
            <NuxtLink
              v-if="item.link"
              :to="localize(item.link.href)"
              class="mt-1 block w-fit font-medium text-(--gw-accent) hover:text-(--gw-accent-strong) hover:underline"
            >
              {{ localize(item.link.label) }} →
            </NuxtLink>
          </p>
        </details>
      </div>
    </section>
        <!-- Discord ribbon — one line, one button -->
    <section class="bg-[#5865F2]">
      <div
        class="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-center gap-x-7 gap-y-3 px-5 py-3 sm:justify-between sm:px-8"
      >
        <p class="flex items-center gap-3 text-sm font-medium text-white">
          <svg viewBox="0 0 24 24" class="size-5 shrink-0" fill="currentColor" aria-hidden="true">
            <path :d="DISCORD_PATH" />
          </svg>
          {{ localize(DISCORD.text) }}
        </p>
        <NuxtLink
          :to="DISCORD.url"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex h-9 items-center rounded-[4px] border border-white/40 px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-white hover:text-[#5865F2]"
        >
          {{ localize(DISCORD.cta) }}
        </NuxtLink>
      </div>
    </section>

    <!-- Final CTA — return to Tyria -->
    <section class="relative border-t border-border bg-(--gw-art-base)">
      <div class="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div class="gw-art absolute inset-0 size-full bg-[position:center_70%]" />
        <div class="gw-cta-scrim absolute inset-0" />
      </div>
      <div
        class="relative mx-auto flex max-w-6xl flex-col items-center px-5 py-20 text-center sm:px-8 sm:py-28"
      >
        <h2
          class="font-(family-name:--font-display) text-4xl text-balance text-(--gw-art-ink) [text-shadow:0_2px_14px_var(--gw-art-halo)] sm:text-5xl"
        >
          {{ localize(CTA.title) }}
        </h2>
        <p class="mt-3 text-base text-(--gw-art-ink-dim) sm:text-lg">{{ localize(CTA.sub) }}</p>
        <div class="gw-rule mt-6 w-[min(360px,80%)] text-xs">◆</div>
        <div class="mt-7 flex flex-wrap items-center justify-center gap-3">
          <NuxtLink
            :to="DOWNLOAD_PATH"
            target="_blank"
            rel="noopener noreferrer"
            class="gw-btn-primary"
            @click="handleDownload('final-cta')"
          >
            <Icon name="lucide:download" class="size-4" aria-hidden="true" />
            {{ localize(CTA.download) }}
          </NuxtLink>
          <NuxtLink :to="docsPath" class="gw-btn-secondary">{{ localize(CTA.docs) }}</NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>
