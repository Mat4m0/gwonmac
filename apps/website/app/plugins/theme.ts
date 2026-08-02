// Loads the consumer theme after the layer's stylesheets (see layer README:
// a plugin import follows the merged `css` array instead of replacing it).
// The site is dark-only: the header's mode toggle is removed (SiteHeader
// shadow), and any previously stored preference is pinned back to dark here.
// Island renders (OG images) have no color-mode state, so skip them.
import "~/assets/css/theme.css";

export default defineNuxtPlugin({
  name: "site-theme",
  env: { islands: false },
  setup() {
    const colorMode = useColorMode();
    colorMode.preference = "dark";
  },
});
