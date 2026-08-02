type PlausibleApi = ((
  event: string,
  options?: { props?: Record<string, string | number> },
) => void) & {
  init: (options?: Record<string, unknown>) => void;
  o?: Record<string, unknown>;
  q?: unknown[][];
};

declare global {
  interface Window {
    plausible: PlausibleApi;
  }
}

export {};
