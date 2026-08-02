import site from "./site.json" with { type: "json" };

export default defineNuxtConfig({
  extends: ["@lupinum/ginko-docs"],
  site: { url: site.url },
  app: {
    head: {
      link: [
        { rel: "icon", type: "image/png", href: "/favicon-96x96.png", sizes: "96x96" },
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "shortcut icon", href: "/favicon.ico" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
      meta: [{ name: "apple-mobile-web-app-title", content: "gwonmac" }],
      script: [
        {
          async: true,
          src: "https://plausible.io/js/pa--X4qMlLVyMnUW4L8emwE_.js",
        },
        {
          innerHTML:
            "window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)},window.plausible.init=window.plausible.init||function(i){window.plausible.o=i||{}};window.plausible.init()",
        },
      ],
    },
  },
  colorMode: { preference: "dark", fallback: "dark" },
  i18n: {
    baseUrl: site.url,
    defaultLocale: "en",
    locales: [
      { code: "en", language: "en-US", name: "English" },
      { code: "de", language: "de-DE", name: "Deutsch" },
    ],
  },
  content: {
    i18n: {
      fallback: { de: ["en"] },
    },
  },
});
