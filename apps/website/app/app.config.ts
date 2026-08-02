import site from "../site.json";

export default defineAppConfig({
  ginkoDocs: {
    theme: { neutral: "stone", primary: "custom" },
    site: {
      url: site.url,
      name: { en: "GWonMac", de: "GWonMac" },
      description: {
        en: "Play Guild Wars on your Mac. GWonMac runs ArenaNet's official client natively on Apple Silicon — free, open source, signed and notarized.",
        de: "Spiele Guild Wars auf deinem Mac. GWonMac führt ArenaNets offiziellen Client nativ auf Apple Silicon aus — kostenlos, Open Source, signiert und notarisiert.",
      },
      logo: { light: "/reforged-logo.webp", dark: "/reforged-logo.webp" },
      docsSidebarSwitcher: "dropdown",
      lupinumAttribution: false,
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
