/**
 * Owns the one transient status line beside the Guild Wars login screen.
 * Steam refusal and automatic return share this owner so an older timeout
 * cannot hide a newer message.
 */

export type LoginStatus = Readonly<{
  show(text: string, durationMs?: number): void;
  clear(): void;
  dispose(): void;
}>;

export function installLoginStatus(element: HTMLElement | null): LoginStatus {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (element) element.hidden = true;
  };

  const show = (text: string, durationMs?: number) => {
    clear();
    if (!element) return;
    element.textContent = text;
    element.hidden = false;
    if (durationMs === undefined) return;
    timer = setTimeout(() => {
      timer = null;
      element.hidden = true;
    }, durationMs);
  };

  return Object.freeze({ show, clear, dispose: clear });
}
