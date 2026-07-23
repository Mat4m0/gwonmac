const PLAUSIBLE_SCRIPT_ID = "-X4qMlLVyMnUW4L8emwE_";

export function useAnalytics(): void {
  useScriptPlausibleAnalytics({
    scriptId: PLAUSIBLE_SCRIPT_ID,
  });
}
