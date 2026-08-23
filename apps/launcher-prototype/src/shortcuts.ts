const keyLabels: Record<string, string> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Delete: "⌦",
  End: "End",
  Enter: "↩",
  Equal: "=",
  Home: "Home",
  Minus: "-",
  PageDown: "Page Down",
  PageUp: "Page Up",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  Space: "Space",
  Tab: "⇥",
};

const reservedShortcuts: Record<string, string> = {
  "⌘A": "Select All",
  "⌘C": "Copy",
  "⌘H": "Hide",
  "⌘M": "Minimize",
  "⌘Q": "Quit",
  "⌘V": "Paste",
  "⌘W": "Close Window",
  "⌘X": "Cut",
  "⌘Z": "Undo",
  "⇧⌘Z": "Redo",
  "⌘,": "Settings",
  "⌘Space": "Spotlight",
  "⌘⇥": "Switch Apps",
  "⌘`": "Switch Windows",
  "⇧⌘3": "Screenshot",
  "⇧⌘4": "Screenshot Selection",
  "⇧⌘5": "Screenshot Controls",
  "⌃⌘Q": "Lock Screen",
  "⌃⌘F": "Enter Full Screen",
  "⌃⌘Space": "Character Viewer",
  "⌥⌘D": "Show or Hide the Dock",
  "⌥⌘Esc": "Force Quit",
  "⌥⌘H": "Hide Other Apps",
  "⌥⌘M": "Minimize All Windows",
  "⌥⌘W": "Close All Windows",
  "⌃Space": "Change Input Source",
  "⌃↑": "Mission Control",
  "⌃↓": "App Exposé",
  "⌃←": "Move Between Spaces",
  "⌃→": "Move Between Spaces",
};

const modifierCodes = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

let cancelActiveShortcutRecorder: (() => void) | null = null;

export const activateShortcutRecorder = (cancel: () => void) => {
  if (cancelActiveShortcutRecorder !== cancel) cancelActiveShortcutRecorder?.();
  cancelActiveShortcutRecorder = cancel;
};

export const deactivateShortcutRecorder = (cancel: () => void) => {
  if (cancelActiveShortcutRecorder === cancel) cancelActiveShortcutRecorder = null;
};

const keyLabel = (event: KeyboardEvent) => {
  if (event.code.startsWith("Key")) return event.code.slice(3);
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  if (/^F\d{1,2}$/.test(event.code)) return event.code;
  if (event.code.startsWith("Numpad") && /^\d$/.test(event.code.slice(6))) {
    return `Num ${event.code.slice(6)}`;
  }
  return keyLabels[event.code] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
};

export const shortcutFromKeyboardEvent = (event: KeyboardEvent) => {
  if (modifierCodes.has(event.code)) return null;

  const modifiers = [
    event.ctrlKey ? "⌃" : "",
    event.altKey ? "⌥" : "",
    event.shiftKey ? "⇧" : "",
    event.metaKey ? "⌘" : "",
  ].join("");

  return `${modifiers}${keyLabel(event)}`;
};

export const validateShortcut = (shortcut: string, unavailableShortcuts: string[] = []) => {
  if (!/[⌃⌥⌘]/.test(shortcut)) {
    return "Add Command, Option, or Control so normal typing still works.";
  }

  const reservedAction = reservedShortcuts[shortcut];
  if (reservedAction) {
    return `${shortcut} is reserved for ${reservedAction}. Choose another shortcut.`;
  }

  if (unavailableShortcuts.includes(shortcut)) {
    return `${shortcut} is already used by another Tool.`;
  }

  return null;
};
