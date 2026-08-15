import site from "../site.json";

export default defineAppConfig({
  ginkoDocs: {
    theme: { neutral: "custom", primary: "custom" },
    site: {
      url: site.url,
      name: { en: "GWonMac", de: "GWonMac" },
      description: {
        en: "Play Guild Wars on your Apple Silicon Mac without Windows, Wine, or a virtual machine. Free, signed, and notarized.",
        de: "Spiele Guild Wars auf deinem Apple-Silicon-Mac – ohne Windows, Wine oder eine virtuelle Maschine. Kostenlos, signiert und notarisiert.",
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
        en: "Unofficial Guild Wars Reforged app — a fan project not affiliated with ArenaNet or NCSOFT",
        de: "Inoffizielle App für Guild Wars Reforged – ein Fanprojekt ohne Verbindung zu ArenaNet oder NCSOFT",
      },
    },
    social: {
      github: site.links.github,
    },
  },
});
