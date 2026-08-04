// Loads the consumer theme after the layer's stylesheets (see layer README:
// a plugin import follows the merged `css` array instead of replacing it).
// Island renders (OG images) are drawn by Satori from the layer's own tokens
// and never see this stylesheet, so skip them.
import "~/assets/css/theme.css";

export default defineNuxtPlugin({
  name: "site-theme",
  env: { islands: false },
  setup() {},
});
