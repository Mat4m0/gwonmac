<script setup lang="ts">
// Fully custom marketing landing in the Reforged launcher chrome (the layer's
// config-driven landing page is not used). Sections, per design exploration:
// Shrine hero with fused stat band, panel-grid features, bracket screenshot
// gallery, marching testimonial strip, forge-line roadmap, hairline FAQ, and
// the "Return to Tyria" closing call. Copy is localized inline; testimonial
// quotes stay in their original English. The global unofficial banner and
// header render above this page as on every other page.
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

const RELEASES_URL = "https://github.com/Mat4m0/gwonmac/releases/latest";
// /api/latest resolves the newest downloadable release from GitHub (cached
// server-side, beta channel during the launch phase). Fetched in the browser so
// the prerendered page never bakes in a stale version; until it answers, the
// buttons link to the releases page.
const { data: latestRelease } = useFetch<LatestRelease>("/api/latest", { server: false });
const downloadUrl = computed(() => latestRelease.value?.url ?? RELEASES_URL);

const { trackDownload, trackFaqOpen } = useTracking();

function handleDownload(source: DownloadSource): void {
  trackDownload(source, latestRelease.value?.version ?? null);
}

const DOCS_PATH = { en: "/docs/guides/install", de: "/de/dokumentation/anleitungen/installation" };
const COMPARE_PATH = {
  en: "/docs/guides/play-guild-wars-on-mac",
  de: "/de/dokumentation/anleitungen/guild-wars-auf-dem-mac-spielen",
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
    en: "Run ArenaNet’s official Guild Wars client natively on Apple Silicon, without Windows, Wine, CrossOver, or Parallels. Free, open source, signed and notarized. Testers report up to 5K and 60–120 FPS.",
    de: "Führe ArenaNets offiziellen Guild-Wars-Client nativ auf Apple Silicon aus, ohne Windows, Wine, CrossOver oder Parallels. Kostenlos, Open Source, signiert und notarisiert. Tester berichten bis zu 5K und 60–120 FPS.",
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
  { value: "4K–5K", label: { en: "Retina-sharp on any display", de: "Retina-scharf auf jedem Display" } },
  { value: "60–120", label: { en: "FPS on Apple Silicon", de: "FPS auf Apple Silicon" } },
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
    title: { en: "Retina, up to 5K", de: "Retina, bis 5K" },
    description: {
      en: "Native rendering on internal and external displays, with selectable render scale and the client’s graphics settings.",
      de: "Natives Rendering auf internen und externen Displays, mit wählbarer Render-Skalierung und den Grafikeinstellungen des Clients.",
    },
  },
  {
    kicker: { en: "Performance", de: "Leistung" },
    title: { en: "Up to 120 FPS on Apple Silicon", de: "Bis zu 120 FPS auf Apple Silicon" },
    description: {
      en: "Testers report steady 60 FPS on an M1 MacBook Air and up to 120 FPS on newer Pro models. Actual performance depends on your machine, resolution, and graphics settings.",
      de: "Tester berichten von stabilen 60 FPS auf einem MacBook Air mit M1 und bis zu 120 FPS auf neueren Pro-Modellen. Die tatsächliche Leistung hängt von Gerät, Auflösung und Grafikeinstellungen ab.",
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
      en: "The source code is available on GitHub under GPL-3.0. Optional quality-of-life features for PvE are already in development.",
      de: "Der Quellcode ist unter GPL-3.0 auf GitHub verfügbar. Zusätzliche optionale Funktionen für PvE sind bereits in Entwicklung.",
    },
  },
];

const GALLERY_HEADING = {
  eyebrow: { en: "Screenshots", de: "Screenshots" },
  title: { en: "Guild Wars on macOS", de: "Guild Wars auf macOS" },
  sub: {
    en: "See how the official client runs on Apple Silicon Macs at high resolution.",
    de: "Sieh dir an, wie der offizielle Client auf Apple-Silicon-Macs in hoher Auflösung läuft.",
  },
};

const SHOTS = [
  {
    src: "/shots/shot-1.webp",
    alt: "Gameplay at high resolution",
    caption: { en: "Explorable Tyria, rendered natively", de: "Tyria, nativ gerendert" },
    meta: { en: "Native · 4K", de: "Nativ · 4K" },
    tall: true,
  },
  {
    src: "/shots/shot-2.webp",
    alt: "Explorable areas, rendered natively",
    caption: { en: "Max settings", de: "Maximale Einstellungen" },
    meta: { en: "120 FPS · M5 Pro", de: "120 FPS · M5 Pro" },
    tall: false,
  },
  {
    src: "/shots/shot-3.webp",
    alt: "The original client on macOS",
    caption: { en: "The original client on macOS", de: "Der Original-Client auf macOS" },
    meta: { en: "Apple Silicon", de: "Apple Silicon" },
    tall: false,
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

// Avatar plate hues cycle per card: ember, gold, rust.
const AVATAR_HUES = ["#8a2508", "#6d5222", "#45280f"];

const TESTIMONIALS = [
  {
    quote:
      "I was getting a steady 120 FPS on max settings. I’m very happy. Thanks for the work you’ve put into this!",
    user: "Banton1992",
    device: "MacBook M5 Pro",
    href: "https://reddit.com/r/GuildWars/comments/1v4sehu/guild_wars_native_experience_achieved_on_apple/ozfnd0a/",
  },
  {
    quote: "This is amazing! Getting 60 fps on a M2 Air at full 5k. Max settings.",
    user: "Zarraya",
    device: "MacBook Air M2",
    href: "https://reddit.com/r/GuildWars/comments/1v4sehu/guild_wars_native_experience_achieved_on_apple/ozi9sny/",
  },
  {
    quote:
      "Made a reddit account to say thank you so much for sharing this! Wow, I can’t even believe I’m able to play gw1 again.",
    user: "aer0_dynamic",
    device: "MacBook Pro M1",
    href: "https://reddit.com/r/GuildWars/comments/1v4sehu/guild_wars_native_experience_achieved_on_apple/ozrm8xi/",
  },
  {
    quote:
      "Playing on an M4 MBA. It plays great, solid 60fps on my default screen resolution. Controller works too. Amazing job.",
    user: "Eshiik",
    device: "MacBook Air M4",
    href: "https://reddit.com/r/GuildWars/comments/1v4sehu/guild_wars_native_experience_achieved_on_apple/ozdr9x1/",
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

const ROAD_HEADING = {
  eyebrow: { en: "Roadmap", de: "Roadmap" },
  title: {
    en: "What works today and what comes next",
    de: "Was heute funktioniert und was als Nächstes kommt",
  },
  sub: {
    en: "The main development steps, from the alpha to the planned GWonMac Tools.",
    de: "Die wichtigsten Entwicklungsschritte von der Alpha bis zu den geplanten GWonMac Tools.",
  },
};

const ROADMAP = [
  {
    state: "done",
    when: { en: "July 2026 · shipped", de: "Juli 2026 · veröffentlicht" },
    title: { en: "Alpha: the first working version", de: "Alpha: erste lauffähige Version" },
    body: {
      en: "ArenaNet’s WebAssembly client running on Apple Silicon. Testing reached steady 60 FPS at 4K on an M1 Pro.",
      de: "ArenaNets WebAssembly-Client läuft auf Apple Silicon. Im Test wurden auf einem M1 Pro stabile 60 FPS bei 4K erreicht.",
    },
  },
  {
    state: "done",
    when: { en: "July 2026 · shipped", de: "Juli 2026 · veröffentlicht" },
    title: { en: "Beta: the major issues fixed", de: "Beta: wichtige Probleme behoben" },
    body: {
      en: "Auto-run, camera, kits, templates, and native cursor support reworked based on user feedback.",
      de: "Auto-Run, Kamera, Kits, Templates und native Cursor-Unterstützung wurden anhand des Nutzerfeedbacks überarbeitet.",
    },
  },
  {
    state: "now",
    when: { en: "Now", de: "Aktuell" },
    title: { en: "Signed releases, simple updates", de: "Signierte Releases und einfache Updates" },
    body: {
      en: "New versions are signed with an Apple Developer ID, notarized, and update directly through the launcher.",
      de: "Neue Versionen sind mit einer Apple Developer ID signiert, notarisiert und direkt über den Launcher aktualisierbar.",
    },
  },
  {
    state: "next",
    when: { en: "Next", de: "Als Nächstes" },
    title: { en: "GWonMac Tools", de: "GWonMac Tools" },
    body: {
      en: "Optional convenience features for PvE are planned. They stay disabled in PvP.",
      de: "Geplant sind optionale Komfortfunktionen für PvE. In PvP bleiben diese Funktionen deaktiviert.",
    },
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
      en: "GWonMac is an independent, open-source project and is not affiliated with or endorsed by ArenaNet or NCSoft. It runs ArenaNet’s official client, downloads official files directly from ArenaNet, and does not automate gameplay. ArenaNet has not published a policy covering hosts like this one and could take a different view in future. Use it at your own discretion; only ArenaNet decides what its Terms of Service allow.",
      de: "GWonMac ist ein unabhängiges Open-Source-Projekt und weder mit ArenaNet noch mit NCSoft verbunden oder von ihnen freigegeben. Es führt ArenaNets offiziellen Client aus, lädt die offiziellen Dateien direkt von ArenaNet und automatisiert kein Gameplay. ArenaNet hat keine Richtlinie zu Hosts wie diesem veröffentlicht und könnte das künftig anders bewerten. Nutzung auf eigene Verantwortung; was die Nutzungsbedingungen erlauben, entscheidet allein ArenaNet.",
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
      en: "Every Apple Silicon Mac, from the M1 MacBook Air to the latest Pro machines, running macOS 12 Monterey or later. Testers report steady 60 FPS on an M1 Air and up to 120 FPS on newer chips. Intel Macs are not supported.",
      de: "Jeder Apple-Silicon-Mac, vom M1 MacBook Air bis zu den neuesten Pro-Geräten, mit macOS 12 Monterey oder neuer. Tester berichten von konstant 60 FPS auf einem M1 Air und bis zu 120 FPS auf neueren Chips. Intel-Macs werden nicht unterstützt.",
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
      en: "Yes. You sign in with your existing Guild Wars account; Steam login works too. The app never sees or stores your credentials.",
      de: "Ja. Du meldest dich mit deinem bestehenden Guild-Wars-Konto an; auch der Steam-Login funktioniert. Die App sieht und speichert deine Zugangsdaten nie.",
    },
  },
  {
    q: { en: "Can I use GWToolbox++?", de: "Kann ich GWToolbox++ nutzen?" },
    a: {
      en: "No. It hooks into the Windows client, and GWonMac doesn’t run that client. GWonMac Tools, our own optional set of PvE quality-of-life features, is in development. Soon™.",
      de: "Nein. Es klinkt sich in den Windows-Client ein, und GWonMac führt diesen Client nicht aus. GWonMac Tools, unser eigenes optionales Set an PvE-Quality-of-Life-Features, ist in Entwicklung. Soon™.",
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

const CREDIT = {
  en: "Screenshots by",
  de: "Screenshots von",
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
    <section class="relative border-b border-border bg-[#0a0806]">
      <div class="absolute inset-0 overflow-hidden" aria-hidden="true">
        <img
          src="/bg-reforged.jpg"
          alt=""
          class="gw-drift absolute inset-0 size-full object-cover object-[center_30%]"
          loading="eager"
        />
        <div
          class="absolute inset-0 bg-[radial-gradient(90%_65%_at_50%_42%,transparent_30%,#0a0806cc_100%),linear-gradient(180deg,#0a0806b3_0%,#0a080626_30%,#0a08061a_55%,#0a0806f2_100%)]"
        />
      </div>
      <div
        class="relative mx-auto flex max-w-3xl flex-col items-center px-6 pt-20 pb-16 text-center sm:pt-24 sm:pb-20"
      >
        <img
          src="/reforged-logo.webp"
          alt="Guild Wars Reforged"
          class="w-[min(430px,80vw)] drop-shadow-[0_4px_22px_#0a0806]"
          loading="eager"
        />
        <h1
          class="mt-8 font-(family-name:--font-display) text-4xl leading-[1.08] font-normal text-balance text-[#fdf3e3] [text-shadow:0_2px_14px_#0a0806] sm:text-5xl"
        >
          {{ localize(HERO.title) }}
        </h1>
        <div class="gw-rule mt-6 w-[min(420px,80%)]">◆</div>
        <p
          class="mt-6 max-w-[56ch] text-base leading-7 text-(--gw-parch-dim) [text-shadow:0_1px_8px_#0a0806] sm:text-lg sm:leading-8"
        >
          {{ localize(HERO.sub) }}
        </p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <NuxtLink
            :to="downloadUrl"
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
        <p class="mt-5 text-[12.5px] tracking-[0.04em] text-(--gw-parch-faint)">
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
            class="absolute top-5 right-5 text-[10px] tracking-[0.14em] text-(--gw-gold-dark) uppercase"
          >
            {{ localize(feature.kicker) }}
          </span>
          <h3 class="mt-6 font-(family-name:--font-display) text-xl text-(--gw-parch)">
            {{ localize(feature.title) }}
          </h3>
          <p class="mt-2 text-[13.5px] leading-relaxed text-(--gw-parch-faint)">
            {{ localize(feature.description) }}
          </p>
        </article>
      </div>
    </section>

    <!-- Screenshot gallery — bracket frames (temporarily disabled)
    <section class="border-y border-border bg-(--hero-bg-muted)/40">
      <div class="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <div class="mx-auto max-w-2xl text-center">
          <p class="text-xs font-semibold tracking-[0.22em] text-(--gw-gold-mid) uppercase">
            {{ localize(GALLERY_HEADING.eyebrow) }}
          </p>
          <h2 class="mt-3 font-(family-name:--font-display) text-3xl text-foreground sm:text-4xl">
            {{ localize(GALLERY_HEADING.title) }}
          </h2>
          <p class="mt-3 text-base leading-7 text-muted-foreground">
            {{ localize(GALLERY_HEADING.sub) }}
          </p>
        </div>
        <div class="mt-10 grid gap-4 md:grid-cols-[2fr_1fr]">
          <figure class="gw-bracket relative m-0 overflow-hidden">
            <span class="gw-bkt"></span>
            <img
              :src="SHOTS[0]!.src"
              :alt="SHOTS[0]!.alt"
              class="block h-full w-full rounded-[4px] object-cover md:aspect-[16/11]"
              loading="lazy"
            />
            <figcaption
              class="absolute inset-x-0 bottom-0 flex justify-between gap-3 rounded-b-[4px] bg-linear-to-b from-transparent to-[#0a0806e6] px-4 pt-7 pb-2.5 text-xs tracking-[0.05em] text-(--gw-parch-dim)"
            >
              <span>{{ localize(SHOTS[0]!.caption) }}</span>
              <span class="text-(--gw-gold-mid)">{{ localize(SHOTS[0]!.meta) }}</span>
            </figcaption>
          </figure>
          <div class="grid gap-4">
            <figure
              v-for="shot in SHOTS.slice(1)"
              :key="shot.src"
              class="gw-bracket relative m-0 overflow-hidden"
            >
              <span class="gw-bkt"></span>
              <img
                :src="shot.src"
                :alt="shot.alt"
                class="block aspect-video w-full rounded-[4px] object-cover"
                loading="lazy"
              />
              <figcaption
                class="absolute inset-x-0 bottom-0 flex justify-between gap-3 rounded-b-[4px] bg-linear-to-b from-transparent to-[#0a0806e6] px-4 pt-7 pb-2.5 text-xs tracking-[0.05em] text-(--gw-parch-dim)"
              >
                <span>{{ localize(shot.caption) }}</span>
                <span class="text-(--gw-gold-mid)">{{ localize(shot.meta) }}</span>
              </figcaption>
            </figure>
          </div>
        </div>
        <p class="mt-4 text-right text-[11.5px] text-(--gw-parch-faint)">
          {{ localize(CREDIT) }}
          <a
            href="https://bloogum.net/guildwars/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-(--gw-gold-mid) hover:underline"
            >Snapshot Henchman</a
          >
        </p>
      </div>
    </section>
    -->

    <!-- Testimonials — masonry wall with bottom fade -->
    <section class="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
      <div class="mx-auto flex max-w-2xl flex-col items-center text-center">
        <p class="text-xs font-semibold tracking-[0.22em] text-(--gw-gold-mid) uppercase">
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
                  class="block truncate font-semibold text-(--gw-gold) hover:underline"
                >
                  u/{{ item.user }}
                </NuxtLink>
                <span class="text-(--gw-parch-faint)">{{ item.device }}</span>
              </span>
            </figcaption>
            <blockquote class="mt-4 text-sm leading-7 text-(--gw-parch-dim)">
              <q>{{ item.quote }}</q>
            </blockquote>
          </figure>
        </div>
      </div>
    </section>

    <!-- Roadmap — the forging (temporarily disabled)
    <section class="border-y border-border bg-(--hero-bg-muted)/40">
      <div class="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <p class="text-xs font-semibold tracking-[0.22em] text-(--gw-gold-mid) uppercase">
          {{ localize(ROAD_HEADING.eyebrow) }}
        </p>
        <h2
          class="mt-3 max-w-xl font-(family-name:--font-display) text-3xl text-balance text-foreground sm:text-4xl"
        >
          {{ localize(ROAD_HEADING.title) }}
        </h2>
        <p class="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          {{ localize(ROAD_HEADING.sub) }}
        </p>
        <div class="gw-road mt-12">
          <div v-for="step in ROADMAP" :key="step.title.en" class="gw-road-step" :class="step.state">
            <p class="text-[11px] tracking-[0.16em] text-(--gw-gold-mid) uppercase">
              {{ localize(step.when) }}
            </p>
            <h3 class="mt-1 font-(family-name:--font-display) text-xl text-(--gw-parch)">
              {{ localize(step.title) }}
            </h3>
            <p class="mt-1.5 max-w-[58ch] text-sm leading-6 text-(--gw-parch-faint)">
              {{ localize(step.body) }}
            </p>
          </div>
        </div>
      </div>
    </section>
    -->



    <!-- FAQ — hairline accordion -->
    <section class="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-24">
      <h2 class="font-(family-name:--font-display) text-3xl text-foreground sm:text-4xl">
        {{ localize(FAQ_HEADING.title) }}
      </h2>
      <div class="gw-faq mt-10 border-t border-[#32281c]">
        <details
          v-for="(item, index) in FAQ"
          :key="localize(item.q)"
          :open="index === 0"
          @toggle="handleFaqToggle($event, item.q)"
        >
          <summary>{{ localize(item.q) }}</summary>
          <p class="max-w-[64ch] px-1 pb-5 pl-[27px] text-sm leading-6 text-(--gw-parch-faint)">
            {{ localize(item.a) }}
            <NuxtLink
              v-if="item.link"
              :to="localize(item.link.href)"
              class="mt-1 block w-fit font-medium text-(--gw-gold-mid) hover:text-(--gw-gold) hover:underline"
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
    <section class="relative border-t border-border bg-[#0a0806]">
      <div class="absolute inset-0 overflow-hidden" aria-hidden="true">
        <img
          src="/bg-reforged.jpg"
          alt=""
          class="absolute inset-0 size-full object-cover object-[center_70%]"
          loading="lazy"
        />
        <div
          class="absolute inset-0 bg-[linear-gradient(180deg,#0a0806f5_0%,#0a080699_50%,#0a0806f5_100%)]"
        />
      </div>
      <div
        class="relative mx-auto flex max-w-6xl flex-col items-center px-5 py-20 text-center sm:px-8 sm:py-28"
      >
        <h2
          class="font-(family-name:--font-display) text-4xl text-balance text-[#fdf3e3] [text-shadow:0_2px_14px_#0a0806] sm:text-5xl"
        >
          {{ localize(CTA.title) }}
        </h2>
        <p class="mt-3 text-base text-(--gw-parch-dim) sm:text-lg">{{ localize(CTA.sub) }}</p>
        <div class="gw-rule mt-6 w-[min(360px,80%)] text-xs">◆</div>
        <div class="mt-7 flex flex-wrap items-center justify-center gap-3">
          <NuxtLink
            :to="downloadUrl"
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
