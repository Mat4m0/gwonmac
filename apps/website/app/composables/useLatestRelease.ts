// Single source of truth for project links lives in the app's shared contracts.
import { EXTERNAL_URLS, RELEASE_REPO } from "../../../../src/shared/contracts";

const FALLBACK_URL = EXTERNAL_URLS.releases;
const API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export function useLatestRelease() {
  const url = useState("release-url", () => FALLBACK_URL);
  const version = useState<string | null>("release-version", () => null);

  onMounted(async () => {
    if (version.value) return;
    try {
      const response = await fetch(API_URL);
      if (!response.ok) return;
      const release: { tag_name?: string; assets?: ReleaseAsset[] } = await response.json();
      const assets = release.assets ?? [];
      // Releases ship the zipped .app; prefer an arch-tagged asset.
      const asset =
        assets.find((a) => /arm64.*\.zip$/.test(a.name)) ??
        assets.find((a) => /\.zip$/.test(a.name));
      if (asset) url.value = asset.browser_download_url;
      version.value = release.tag_name ?? null;
    } catch {
      // Offline or rate-limited: keep the releases-page fallback.
    }
  });

  return { url, version };
}
