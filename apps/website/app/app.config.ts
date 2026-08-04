import site from "../site.json";

export default defineAppConfig({
  ginkoDocs: {
    theme: { neutral: "custom", primary: "custom" },
    site: {
      url: site.url,
      name: { en: "GWonMac", de: "GWonMac" },
      description: {
        en: "Play Guild Wars on your Mac. GWonMac runs ArenaNet's official client natively on Apple Silicon — free, open source, signed and notarized.",
        de: "Spiele Guild Wars auf deinem Mac. GWonMac führt ArenaNets offiziellen Client nativ auf Apple Silicon aus — kostenlos, Open Source, signiert und notarisiert.",
      },
      // PNG, not the webp wordmark: this logo is rendered into OG images by
      // Satori, which cannot decode WebP.
      logo: { light: "/reforged-logo.png", dark: "/reforged-logo.png" },
      docsSidebarSwitcher: "dropdown",
      lupinumAttribution: false,
    },
    nav: {
      links: [
        { label: { en: "Home", de: "Startseite" }, to: { en: "/", de: "/de" }, icon: "lucide:home" },
        {
          label: { en: "Documentation", de: "Dokumentation" },
          to: { en: "/docs", de: "/de/dokumentation" },
          icon: "lucide:book-open",
        },
        { label: "Blog", to: { en: "/blog", de: "/de/blog" }, icon: "lucide:file-text" },
      ],
    },
    banner: {
      enabled: true,
      id: "unofficial",
      showOnLanding: true,
      text: {
        en: "Unofficial Guild Wars Reforged App — a fan project, not affiliated with ArenaNet or NCSoft",
        de: "Inoffizieller Guild Wars Reforged App — ein Fan-Projekt, nicht mit ArenaNet oder NCSoft verbunden",
      },
    },
    social: {
      github: site.links.github,
    },
  },
});
