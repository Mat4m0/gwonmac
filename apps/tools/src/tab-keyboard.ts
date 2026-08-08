/** Complete the keyboard contract for a tablist without owning its state. */
export function navigateTabs(event: KeyboardEvent): void {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>(
    '[role="tab"]:not([disabled])',
  )];
  if (tabs.length === 0) return;
  const current = tabs.indexOf(event.target as HTMLElement);
  if (current < 0) return;

  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : event.key === "ArrowLeft"
        ? (current - 1 + tabs.length) % tabs.length
        : event.key === "ArrowRight"
          ? (current + 1) % tabs.length
          : null;
  if (next === null) return;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}

/** Optional arrow-key acceleration for a native-button navigation list. */
export function navigateRows(event: KeyboardEvent): void {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(".library-row")];
  if (rows.length === 0) return;
  const current = rows.indexOf(event.target as HTMLElement);
  if (current < 0) return;

  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? rows.length - 1
      : event.key === "ArrowUp"
        ? Math.max(0, current - 1)
        : event.key === "ArrowDown"
          ? Math.min(rows.length - 1, current + 1)
          : null;
  if (next === null || next === current) return;
  event.preventDefault();
  rows[next]?.focus();
}
