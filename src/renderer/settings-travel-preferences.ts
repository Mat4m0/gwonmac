/**
 * Owns Travel's Recent limit and clear-history flows inside Settings.
 * Travel remains the only persistence authority for these preferences.
 */
import type { TravelUserPreferences } from '../shared/travel.js';

type FeedbackTone = 'neutral' | 'progress' | 'success' | 'warning' | 'error';

export type TravelPreferenceSettingsBinder = Readonly<{
  render: (toolsEnabled: boolean, preferences: TravelUserPreferences | null) => void;
}>;

export function bindTravelPreferenceSettings(options: Readonly<{
  limit: HTMLSelectElement;
  clear: HTMLButtonElement;
  current: () => TravelUserPreferences | null;
  accept: (preferences: TravelUserPreferences | null) => void;
  renderSettings: () => void;
  feedback: (message: string, tone: FeedbackTone, resetAfter?: number) => void;
}>): TravelPreferenceSettingsBinder {
  function render(
    toolsEnabled: boolean,
    preferences: TravelUserPreferences | null,
  ): void {
    options.limit.value = String(preferences?.recentLimit ?? 5);
    options.limit.disabled = !toolsEnabled;
    options.clear.disabled =
      !toolsEnabled || (preferences?.recentMapIds.length ?? 0) === 0;
  }

  async function reconcileAfterFailure(message: string): Promise<void> {
    const current = options.current();
    const active = await window.gwNative.travelPreferences.get()
      .catch(() => current);
    options.accept(active);
    options.renderSettings();
    options.feedback(message, 'error');
  }

  options.limit.addEventListener('change', () => {
    const value = Number(options.limit.value);
    const expected = options.current();
    if (expected === null || (value !== 0 && value !== 3 && value !== 5 && value !== 10)) {
      return;
    }
    options.feedback('Saving…', 'progress');
    void window.gwNative.travelPreferences
      .set({ expected, patch: { recentLimit: value } })
      .then((saved) => {
        options.accept(saved);
        options.renderSettings();
        options.feedback('Saved.', 'success', 2200);
      })
      .catch(() => reconcileAfterFailure(
        'Settings could not confirm which Recent limit is active. Review the current value, then try again.',
      ));
  });

  options.clear.addEventListener('click', () => {
    const expected = options.current();
    if (options.clear.disabled || expected === null) return;
    options.feedback('Clearing Recent…', 'progress');
    options.clear.disabled = true;
    void window.gwNative.travelPreferences
      .set({ expected, patch: { recentMapIds: [] } })
      .then((saved) => {
        options.accept(saved);
        options.renderSettings();
        options.feedback('Recent destinations cleared.', 'success', 2200);
      })
      .catch(() => reconcileAfterFailure(
        'GWonMac could not confirm whether Recent was cleared. Review the current list, then try again.',
      ));
  });

  return Object.freeze({ render });
}
