/**
 * Bounded whisper text and the private one-request game-thread mailbox.
 * Message content is session-local; this contract exposes no IPC or storage.
 */
export const WHISPER_NAME_UNITS = 20;
export const WHISPER_MESSAGE_UNITS = 120;
// The certified sender copies into 138 UTF-16 units, including the terminator.
export const WHISPER_LINE_UNITS = 137;
export const WHISPER_MAILBOX = Object.freeze({
  bytes: 592, status: 0, length: 4, source: 8, queued: 288,
  characterLow: 568, characterHigh: 572, map: 576,
});
export type WhisperDirection = "incoming" | "outgoing";
export interface ObservedWhisper {
  readonly id: number;
  readonly sender: string;
  readonly message: string;
  readonly direction: WhisperDirection;
}

export interface ObservedChatParticipant {
  readonly id: number;
  readonly sender: string;
  readonly direction: "participant";
}

export type ObservedChatEvent = ObservedWhisper | ObservedChatParticipant;

function hasControl(value: string): boolean {
  return Array.from(value).some(unit => unit.charCodeAt(0) < 32 || unit.charCodeAt(0) === 127);
}

/** Whether Guild Wars can address this exact text as a character name. */
export function isCharacterName(value: string): boolean {
  return !!value.trim() && value.length <= WHISPER_NAME_UNITS
    && !/[,"]/u.test(value) && !hasControl(value) && !/[\ud800-\udfff]/u.test(value);
}

/** The chat command that invites one character by name into the player's party. */
export const PARTY_INVITE_PREFIX = "/invite ";

/** The exact line the certified sender accepts for a party invite. */
export function partyInviteLine(name: string): string {
  if (!isCharacterName(name) || name !== name.trim()) {
    throw new Error("Enter a valid character name (up to 20 characters).");
  }
  return `${PARTY_INVITE_PREFIX}${name}`;
}

export function whisperLine(recipient: string, message: string): string {
  if (!isCharacterName(recipient)) {
    throw new Error("Enter a valid character name (up to 20 characters).");
  }
  if (!message.trim() || message.length > WHISPER_MESSAGE_UNITS
    || hasControl(message) || /[\ud800-\udfff]/u.test(message)) {
    throw new Error("Write a single-line message of up to 120 characters.");
  }
  const line = `"${recipient},${message}`;
  if (line.length > WHISPER_LINE_UNITS) {
    throw new Error(`Shorten the message to ${WHISPER_LINE_UNITS - recipient.length - 2} characters.`);
  }
  return line;
}
