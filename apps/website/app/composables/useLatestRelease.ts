// The Vue half of the download button. Everything it decides lives in
// `app/utils/release-download.ts`, which has no Nuxt in it and is what
// `tests/website-smoke.ts` executes; this file is only the binding between that
// policy and the rendered state, and so it is the only half that needs Nuxt's
// auto-imported `useState` and `onMounted`.
import { loadWebsiteDownload, RELEASES_FALLBACK_URL } from "../utils/release-download.ts";

export function useLatestRelease() {
  const url = useState("release-url", () => RELEASES_FALLBACK_URL);
  const version = useState<string | null>("release-version", () => null);

  onMounted(async () => {
    const download = await loadWebsiteDownload();
    if (!download) return;
    url.value = download.url;
    version.value = download.version;
  });

  return { url, version };
}
