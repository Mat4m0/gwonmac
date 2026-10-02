// Shared CI runners add scheduling jitter of tens of milliseconds, so wall-clock
// budgets get three times the room there. Real regressions (hundreds of ms of
// synchronous work) still fail in both places.
export const timeBudget = (ms: number) => (process.env.CI ? ms * 3 : ms);
