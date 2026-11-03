import GuideMediaPlaceholder from "~/components/content/GuideMediaPlaceholder.vue";
import GuideSetting from "~/components/content/GuideSetting.vue";

// The renderer resolves a Markdown tag only through the app's global
// components; `content.markdown.tags` in nuxt.config.ts maps the tags here.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component("GuideMediaPlaceholder", GuideMediaPlaceholder);
  nuxtApp.vueApp.component("GuideSetting", GuideSetting);
});
