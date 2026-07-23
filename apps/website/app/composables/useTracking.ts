export type DownloadSource =
  | "final-cta"
  | "hero"
  | "install-guide"
  | "navigation";

export function useTracking() {
  const plausibleTrack = (
    event: string,
    props?: Record<string, string | number>,
  ): void => {
    if (!import.meta.client) return;
    window.plausible(event, props ? { props } : undefined);
  };

  const trackDownload = (
    source: DownloadSource,
    version: string | null,
  ): void => {
    plausibleTrack("Download Clicked", {
      source,
      version: version ?? "unknown",
    });
  };

  const trackFaqOpen = (question: string): void => {
    plausibleTrack("FAQ Clicked", { question });
  };

  return { trackDownload, trackFaqOpen };
}
