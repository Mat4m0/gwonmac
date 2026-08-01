/**
 * The two throttled readouts on the loading screen: the minutes-remaining
 * estimate and the detail line under the bar.
 *
 * Both exist because progress arrives on every chunk completion, in bursts, and
 * a number rewritten that often is unreadable even while it is correct. Neither
 * smooths the underlying values — the rate is already smoothed where it is
 * computed — they decide only when a changed value is allowed to reach the
 * screen, and a value that stops being available is shown immediately rather
 * than left stale.
 */
import type { DownloadActivity } from "../shared/contracts.js";

/**
 * The stable minutes-remaining readout behind "6 min remaining". The
 * estimate derives from the already-smoothed rate, so its residual jitter is
 * a few percent — but near a minute boundary that still flips a ceil()ed
 * display back and forth on every progress event. The shown minute covers
 * ((m − 1) · 60, m · 60] and moves only once the estimate leaves that band by
 * half a minute; jitter cannot cross the band, a genuine change re-anchors
 * in one step, and no second smoothing layer adds lag.
 */
export class EtaDisplay {
  private shownMinutes: number | null = null;

  update(secondsRemaining: number | null): number | null {
    if (secondsRemaining === null || !Number.isFinite(secondsRemaining)) {
      this.shownMinutes = null;
      return null;
    }
    const shown = this.shownMinutes;
    if (
      shown === null ||
      secondsRemaining > shown * 60 + 30 ||
      secondsRemaining < (shown - 1) * 60 - 30
    ) {
      this.shownMinutes = Math.max(1, Math.ceil(secondsRemaining / 60));
    }
    return this.shownMinutes;
  }
}

const bytesText = (n: number) =>
  n >= 1e9
    ? (n / 1e9).toFixed(2) + " GB"
    : (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + " MB";

/**
 * The loading screen's "112 MB of 3.2 GB · 0.9 MB/s avg · 6 min remaining"
 * line. Progress arrives on every chunk completion, in bursts, and a line
 * rewritten that often flickers, so numeric churn commits at most once a
 * second. An event that clears the rate or the estimate renders immediately:
 * PatchClient emits one right before file assembly, a stretch with no
 * further events, and throttling it would freeze the old speed on screen for
 * the whole stretch.
 */
export class DownloadDetailLine {
  private readonly eta = new EtaDisplay();
  private shownAtMs = 0;
  private shown = "";

  update(
    p: Pick<
      DownloadActivity,
      "received" | "total" | "bytesPerSecond" | "secondsRemaining"
    >,
    nowMs = Date.now(),
  ): string {
    const minutes = this.eta.update(p.secondsRemaining);
    const clearing = p.bytesPerSecond <= 0 || minutes === null;
    if (this.shown && !clearing && nowMs - this.shownAtMs < 1_000) {
      return this.shown;
    }
    this.shownAtMs = nowMs;
    this.shown = [
      p.total ? `${bytesText(p.received)} of ${bytesText(p.total)}` : "",
      p.bytesPerSecond > 0
        ? `${(p.bytesPerSecond / 1e6).toFixed(1)} MB/s avg`
        : "",
      minutes !== null ? `${minutes} min remaining` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return this.shown;
  }
}
