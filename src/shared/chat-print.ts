/**
 * Bounded local chat lines and their private one-line game-thread mailbox.
 * A line is printed only in this player's own chat log; nothing is sent.
 */
export const CHAT_PRINT_UNITS = 120;
export const CHAT_PRINT_PREFIX = "[gwonmac] ";
// queued holds the encoded line: two literal-string markers, the text, the
// literal end marker and a terminator.
export const CHAT_PRINT_MAILBOX = Object.freeze({ bytes: 512, status: 0, length: 4, source: 8, queued: 248 });
export const CHAT_PRINT_STATUS = Object.freeze({ queued: 1, printed: 2 });

/** Printable ASCII only; `<` and `>` would start a game markup tag. */
export function isChatPrintText(text: string): boolean {
  return text.length > 0 && text.length <= CHAT_PRINT_UNITS && /^[\x20-\x3b=\x3f-\x7e]+$/u.test(text);
}
