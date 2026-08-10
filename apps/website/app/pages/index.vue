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
// server-side, beta channel during the launch phase). Fetched in the browser so
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
    en: "Play Guild Wars on Mac — Native Apple Silicon App (Free) | GWonMac",
    de: "Guild Wars auf dem Mac spielen — Native App für Apple Silicon (kostenlos) | GWonMac",
  },
  description: {
    en: "Run ArenaNet’s official Guild Wars client natively on Apple Silicon, without Windows, Wine, CrossOver, or Parallels. Free, open source, signed and notarized, with selectable Retina render scale.",
    de: "Führe ArenaNets offiziellen Guild-Wars-Client nativ auf Apple Silicon aus, ohne Windows, Wine, CrossOver oder Parallels. Kostenlos, Open Source, signiert und notarisiert, mit wählbarer Retina-Skalierung.",
  },
};

const HERO = {
  title: {
    en: "Play Guild Wars natively on your Mac",
    de: "Spiele Guild Wars nativ auf deinem Mac",
  },
  sub: {
    en: "GWonMac starts the official client as a native macOS app. You don’t need a virtual machine, and there is nothing to patch by hand.",
    de: "GWonMac startet den offiziellen Client als native macOS-App. Du brauchst keine virtuelle Maschine, und nichts muss von Hand gepatcht werden.",
  },
  download: { en: "Direct Download", de: "Direkter Download" },
  docs: { en: "Read the docs", de: "Dokumentation lesen" },
  finePrint: {
    en: "Free · Open source (GPL-3.0) · Signed & notarized",
    de: "Kostenlos · Open Source (GPL-3.0) · Signiert & notarisiert",
  },
};

const STATS = [
  { value: "1-click", label: { en: "install, then it updates itself", de: "Installation, danach hält es sich aktuell" } },
  { value: "1×–2×", label: { en: "selectable render scale", de: "wählbare Render-Skalierung" } },
  { value: "arm64", label: { en: "built for Apple Silicon", de: "für Apple Silicon gebaut" } },
  { value: "GPL-3.0", label: { en: "fully open source", de: "vollständig Open Source" } },
];

const FEATURES_HEADING = {
  title: { en: "Set it up once, then just play", de: "Einmal einrichten, dann einfach spielen" },
  sub: {
    en: "GWonMac handles installation, game data, and updates. All you need is your existing Guild Wars account.",
    de: "GWonMac kümmert sich um Installation, Spieldaten und Updates. Du brauchst nur deinen bestehenden Guild-Wars-Account.",
  },
};

const FEATURES = [
  {
    kicker: { en: "Install", de: "Installation" },
    title: { en: "Installed in a few steps", de: "In wenigen Schritten installiert" },
    description: {
      en: "Download the DMG, drag the app to Applications, and open it. Every release is signed and notarized by Apple. You never need to disable security settings.",
      de: "DMG herunterladen, App in „Programme“ ziehen und öffnen. Jedes Release ist signiert und von Apple notarisiert. Du musst keine Sicherheitseinstellungen deaktivieren.",
    },
  },
  {
    kicker: { en: "Updates", de: "Updates" },
    title: { en: "Updates without manual work", de: "Updates ohne manuelle Arbeit" },
    description: {
      en: "Game data stays up to date automatically. When a new app version is available, the launcher lets you know and installs it in one click.",
      de: "Die Spieldaten werden automatisch aktuell gehalten. Sobald eine neue App-Version verfügbar ist, informiert dich der Launcher und installiert sie mit einem Klick.",
    },
  },
  {
    kicker: { en: "Display", de: "Anzeige" },
    title: { en: "Selectable Retina render scale", de: "Wählbare Retina-Skalierung" },
    description: {
      en: "Native rendering on internal and external displays, with selectable render scale and the client’s graphics settings.",
      de: "Natives Rendering auf internen und externen Displays, mit wählbarer Render-Skalierung und den Grafikeinstellungen des Clients.",
    },
  },
  {
    kicker: { en: "Performance", de: "Leistung" },
    title: { en: "Built for Apple Silicon", de: "Für Apple Silicon gebaut" },
    description: {
      en: "The arm64 app runs ArenaNet’s WebAssembly client directly in bundled Chromium. Actual performance depends on your Mac, render scale, and the client’s graphics settings.",
      de: "Die arm64-App führt ArenaNets WebAssembly-Client direkt im mitgelieferten Chromium aus. Die tatsächliche Leistung hängt von deinem Mac, der Render-Skalierung und den Grafikeinstellungen des Clients ab.",
    },
  },
  {
    kicker: { en: "Authentic", de: "Authentisch" },
    title: { en: "The official client from ArenaNet", de: "Der offizielle Client von ArenaNet" },
    description: {
      en: "GWonMac uses ArenaNet’s WebAssembly client and downloads game data directly from ArenaNet. Your existing account and Steam login are supported.",
      de: "GWonMac verwendet ArenaNets WebAssembly-Client und lädt die Spieldaten direkt von ArenaNet. Dein bestehender Account und der Steam-Login werden unterstützt.",
    },
  },
  {
    kicker: { en: "Open", de: "Offen" },
    title: { en: "Free and open source", de: "Kostenlos und Open Source" },
    description: {
      en: "The source code is available on GitHub under GPL-3.0. Optional GWonMac Tools for managing PvE builds and teams are available in Beta.",
      de: "Der Quellcode ist unter GPL-3.0 auf GitHub verfügbar. Die optionalen GWonMac Tools zum Verwalten von PvE-Builds und Teams sind als Beta verfügbar.",
    },
  },
];

const VOICES_HEADING = {
  eyebrow: { en: "From r/GuildWars", de: "Aus r/GuildWars" },
  title: { en: "Reports from different Macs", de: "Erfahrungen auf verschiedenen Macs" },
  sub: {
    en: "Real feedback from users on M1, M2, M4, and M5 machines, straight from the Reddit release threads.",
    de: "Echte Rückmeldungen von Nutzern mit M1-, M2-, M4- und M5-Geräten, direkt aus den Reddit-Release-Threads.",
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
  title: { en: "Frequently asked questions", de: "Häufige Fragen" },
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
      en: "Nobody outside ArenaNet can guarantee that, so here is what we actually know. We contacted ArenaNet before launch: in late July 2026 a staff member ran GWonMac on their own Mac and said they are fine with what the project does as things stand. That is not an endorsement or a policy, and ArenaNet could take a different view later. GWonMac downloads and verifies ArenaNet’s official client and preserves that download unchanged. A separate hash-verified copy runs only after the exact build passes GWonMac’s bounded compatibility proof; live Tools additionally require shipped exact-build facts. It injects no native code and performs no autonomous gameplay. If ArenaNet ever says stop, the project is deprecated and everyone is told the same day.",
      de: "Niemand außerhalb von ArenaNet kann das garantieren, deshalb hier, was wir tatsächlich wissen. Wir haben ArenaNet vor dem Launch kontaktiert: Ende Juli 2026 hat ein Mitarbeiter GWonMac auf seinem eigenen Mac ausgeführt und gesagt, dass er nach aktuellem Stand damit einverstanden ist. Das ist keine Freigabe und keine Richtlinie, und ArenaNet kann das künftig anders bewerten. GWonMac lädt und prüft ArenaNets offiziellen Client und bewahrt diesen Download unverändert auf. Eine separate, per Hash geprüfte Kopie läuft erst, wenn der exakte Build GWonMacs begrenzte Kompatibilitätsprüfung besteht; Live-Tools benötigen zusätzlich mit der App ausgelieferte Fakten für den exakten Build. Nativer Code wird nicht injiziert und das Spiel nicht selbstständig gesteuert. Sagt ArenaNet jemals Stopp, wird das Projekt eingestellt und alle erfahren es am selben Tag.",
    },
    link: {
      label: { en: "Read the full safety page", de: "Zur ausführlichen Sicherheitsseite" },
      href: SAFETY_PATH,
    },
  },
  {
    q: { en: "Is GWonMac free?", de: "Ist GWonMac kostenlos?" },
    a: {
      en: "Yes. Free and open source under GPL-3.0. The app costs nothing and always will.",
      de: "Ja. Kostenlos und Open Source unter GPL-3.0. Die App kostet nichts und wird es auch nie.",
    },
  },
  {
    q: { en: "Does it include Guild Wars?", de: "Ist Guild Wars enthalten?" },
    a: {
      en: "No. GWonMac downloads the official client and game files directly from ArenaNet instead of bundling them. You need your own Guild Wars account to play.",
      de: "Nein. GWonMac lädt den offiziellen Client und die Spieldaten direkt von ArenaNet, statt sie mitzuliefern. Zum Spielen brauchst du dein eigenes Guild-Wars-Konto.",
    },
  },
  {
    q: { en: "Which Macs are supported?", de: "Welche Macs werden unterstützt?" },
    a: {
      en: "Every Apple Silicon Mac, from the M1 MacBook Air to the latest Pro machines, running macOS 12 Monterey or later. Performance depends on the Mac, render scale, and the client’s graphics settings. Intel Macs are not supported.",
      de: "Jeder Apple-Silicon-Mac, vom M1 MacBook Air bis zu den neuesten Pro-Geräten, mit macOS 12 Monterey oder neuer. Die Leistung hängt vom Mac, der Render-Skalierung und den Grafikeinstellungen des Clients ab. Intel-Macs werden nicht unterstützt.",
    },
  },
  {
    q: { en: "How do I install it?", de: "Wie installiere ich es?" },
    a: {
      en: "Download the DMG, drag Guild Wars to Applications, and open it. Releases are signed with Developer ID, notarized by Apple, and verified by Gatekeeper. You never need to disable security settings to run it.",
      de: "DMG herunterladen, Guild Wars in „Programme“ ziehen und öffnen. Releases sind mit Developer ID signiert, von Apple notarisiert und werden von Gatekeeper geprüft. Du musst dafür keine Sicherheitseinstellungen deaktivieren.",
    },
    link: {
      label: { en: "Step-by-step install guide", de: "Schritt-für-Schritt-Anleitung" },
      href: DOCS_PATH,
    },
  },
  {
    q: {
      en: "What about CrossOver, Parallels, or Whisky?",
      de: "Was ist mit CrossOver, Parallels oder Whisky?",
    },
    a: {
      en: "They can work, but all of them run the Windows client through a compatibility layer or a virtual machine. That means extra cost and more parts that can break. GWonMac runs the official client natively.",
      de: "Sie können funktionieren, führen aber alle den Windows-Client über eine Kompatibilitätsschicht oder eine virtuelle Maschine aus. Das bedeutet Zusatzkosten und mehr Teile, die kaputtgehen können. GWonMac führt den offiziellen Client nativ aus.",
    },
    link: {
      label: { en: "Every option compared", de: "Alle Optionen im Vergleich" },
      href: COMPARE_PATH,
    },
  },
  {
    q: { en: "Does it update automatically?", de: "Aktualisiert es sich automatisch?" },
    a: {
      en: "Yes. The game data stays current automatically, and the launcher tells you when a new app version is ready. Updating is one click.",
      de: "Ja. Die Spieldaten bleiben automatisch aktuell, und der Launcher meldet sich, wenn eine neue App-Version bereitsteht. Das Update ist ein Klick.",
    },
  },
  {
    q: { en: "Do I need a Guild Wars account? Does Steam login work?", de: "Brauche ich ein Guild-Wars-Konto? Geht der Steam-Login?" },
    a: {
      en: "Yes. You sign in with your existing Guild Wars account; Steam login works too. Credentials are sent only to the selected provider and ArenaNet’s official client and services—never to a GWonMac service. If you enable saved login, they are kept in this Mac’s device-only Keychain.",
      de: "Ja. Du meldest dich mit deinem bestehenden Guild-Wars-Konto an; auch der Steam-Login funktioniert. Zugangsdaten werden nur an den gewählten Anbieter sowie ArenaNets offiziellen Client und Dienste gesendet – niemals an einen GWonMac-Dienst. Wenn du die gespeicherte Anmeldung aktivierst, liegen sie ausschließlich im gerätegebundenen Schlüsselbund dieses Macs.",
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
      en: "No. It hooks into the Windows client, and GWonMac doesn’t run that client. GWonMac Tools Beta is the native alternative for local build and team management. It is optional, limited to supported PvE outposts, and automatically unavailable in PvP, guild halls, and unknown regions.",
      de: "Nein. Es klinkt sich in den Windows-Client ein, und GWonMac führt diesen Client nicht aus. GWonMac Tools Beta ist die native Alternative für die lokale Build- und Teamverwaltung. Sie ist optional, auf unterstützte PvE-Außenposten beschränkt und in PvP, Gildenhallen und unbekannten Gebieten automatisch nicht verfügbar.",
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
      en: "Join the Discord for quick help, or use the GitHub bug form. Inside the app, Help → Report a Problem collects redacted diagnostics for you. Credentials and account data are never included.",
      de: "Komm für schnelle Hilfe auf den Discord oder nutze das GitHub-Bug-Formular. In der App sammelt Hilfe → Problem melden bereinigte Diagnosedaten für dich. Zugangsdaten und Kontodaten sind nie enthalten.",
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
    en: "New releases, known issues, quick help: it all lands on Discord first.",
    de: "Neue Releases, bekannte Probleme, schnelle Hilfe: Alles landet zuerst auf Discord.",
  },
  cta: { en: "Join the Discord", de: "Discord beitreten" },
};

// Discord brand mark — the bundled icon set has none (see SiteSocialLinks.vue).
const DISCORD_PATH =
  "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z";

const CTA = {
  title: { en: "Install Guild Wars on your Mac", de: "Guild Wars auf deinem Mac installieren" },
  sub: {
    en: "Download GWonMac for free, sign in with your existing account, and start the official client.",
    de: "Lade GWonMac kostenlos herunter, melde dich mit deinem bestehenden Account an und starte den offiziellen Client.",
  },
  download: { en: "Direct Download", de: "Direkter Download" },
  docs: { en: "See the install guide", de: "Installationsanleitung ansehen" },
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
          <span
            class="absolute top-5 right-5 text-[10px] tracking-[0.14em] text-(--gw-accent-quiet) uppercase"
          >
            {{ localize(feature.kicker) }}
          </span>
          <h3 class="mt-6 font-(family-name:--font-display) text-xl text-(--gw-text)">
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
        <p class="text-xs font-semibold tracking-[0.22em] text-(--gw-accent) uppercase">
          {{ localize(VOICES_HEADING.eyebrow) }}
        </p>
        <h2 class="mt-3 font-(family-name:--font-display) text-3xl text-foreground sm:text-4xl">
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
